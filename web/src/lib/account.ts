/* Optional phone-number account (SMS code). Logged out = the anonymous device, exactly as before.
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
      throw new Error("Får ikke kontakt med Spoken-serveren.");
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
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
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PHONE_KEY);
  } catch { /* ignore */ }
}
