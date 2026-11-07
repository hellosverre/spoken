/* Phone-number account (SMS code), required: the server answers 401 to everything else.
   The session token sits in localStorage and rides on every API call as Authorization: Bearer. */

const TOKEN_KEY = "spoken-token";
const PHONE_KEY = "spoken-account-phone";
const DEVICE_KEY = "spoken-device";

export function getToken(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; }
}
export function accountPhone(): string {
  try { return getToken() ? localStorage.getItem(PHONE_KEY) ?? "" : ""; } catch { return ""; }
}
/** Header(s) to merge into a request: the account token, if logged in. */
export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** An error from the server with its HTTP status (0 = no contact). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** The store registers this: a 401 on any request means the session is gone → back to Login. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: (() => void) | null) { unauthorizedHandler = fn; }
export function sessionLost() {
  if (!getToken()) return;
  clearSession();
  unauthorizedHandler?.();
}
function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PHONE_KEY);
  } catch { /* ignore */ }
}

function apiBase(): string {
  const api = process.env.NEXT_PUBLIC_SPOKEN_API ?? "";
  return api === "/" ? window.location.origin : api.replace(/\/$/, "");
}

export function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch { return ""; }
}

/** JSON call to the Spoken server with device + token headers and a timeout. Throws Error(message from the server). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const device = deviceId();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    let res: Response;
    try {
      res = await fetch(apiBase() + path, {
        method,
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(device ? { "X-Spoken-Device": device } : {}), ...authHeader() },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      throw new ApiError("Får ikke kontakt med Spoken-serveren.", 0);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    // 401 outside /api/auth/* = expired or revoked session. (A wrong code is a 400, never a 401.)
    if (res.status === 401 && !path.startsWith("/api/auth/")) sessionLost();
    if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const startLogin = (phone: string) => api<{ sent: "sms" | "dev" }>("POST", "/api/auth/start", { phone });

export async function verifyLogin(phone: string, code: string): Promise<void> {
  const r = await api<{ token: string; phone: string }>("POST", "/api/auth/verify", { phone, code, device: deviceId() });
  try {
    localStorage.setItem(TOKEN_KEY, r.token);
    localStorage.setItem(PHONE_KEY, r.phone);
  } catch { /* private mode: the login lasts until reload */ }
}

export async function logoutAccount(): Promise<void> {
  await api("POST", "/api/auth/logout").catch(() => {});
  clearSession();
}
