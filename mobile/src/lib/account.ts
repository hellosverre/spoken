/* Phone-number account (SMS code), required: the server answers 401 to everything else.
   The session token is kept in AsyncStorage and sent as Authorization: Bearer on API calls. */
import AsyncStorage from "@react-native-async-storage/async-storage";
// Same server URL as real-call.ts (not imported from it: real-call imports authHeader from here).
const API = (process.env.EXPO_PUBLIC_SPOKEN_API ?? "https://spoken-api.hellosverre.com").replace(/\/$/, "");

const TOKEN_KEY = "spoken-token";
const PHONE_KEY = "spoken-account-phone";
const DEVICE_KEY = "spoken-device";

let cache: { token: string; phone: string } | null = null;

async function load() {
  if (!cache) {
    const [token, phone] = await Promise.all([
      AsyncStorage.getItem(TOKEN_KEY).catch(() => null),
      AsyncStorage.getItem(PHONE_KEY).catch(() => null),
    ]);
    cache = { token: token ?? "", phone: token ? phone ?? "" : "" };
  }
  return cache;
}

/** An error from the server with its HTTP status (0 = no contact). */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The store registers this: a 401 on any request means the session is gone → back to Login. */
let unauthorizedHandler: (() => void) | null = null;
export function onUnauthorized(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}
export async function sessionLost() {
  if (!(await load()).token) return;
  await clearSession();
  unauthorizedHandler?.();
}
async function clearSession() {
  cache = { token: "", phone: "" };
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(PHONE_KEY)]).catch(() => {});
}

export async function hasSession(): Promise<boolean> {
  return !!(await load()).token;
}

export async function accountPhone(): Promise<string> {
  return (await load()).phone;
}

/** Header(s) to merge into a request: the account token, if logged in. */
export async function authHeader(): Promise<Record<string, string>> {
  const { token } = await load();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** JSON call to the Spoken server with device + token headers and a timeout. Throws Error(message from the server). */
export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const device = (await AsyncStorage.getItem(DEVICE_KEY).catch(() => null)) ?? "";
  const headers = {
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(device ? { "X-Spoken-Device": device } : {}),
    ...(await authHeader()),
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    let res: Response;
    try {
      res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
    } catch {
      throw new ApiError("Får ikke kontakt med Spoken-serveren.", 0);
    }
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    // 401 outside /api/auth/* = expired or revoked session. (A wrong code is a 400, never a 401.)
    if (res.status === 401 && !path.startsWith("/api/auth/")) await sessionLost();
    if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export const startLogin = (phone: string) => api<{ sent: "sms" | "dev" }>("POST", "/api/auth/start", { phone });

export async function verifyLogin(phone: string, code: string): Promise<void> {
  const device = (await AsyncStorage.getItem(DEVICE_KEY).catch(() => null)) ?? "";
  const r = await api<{ token: string; phone: string }>("POST", "/api/auth/verify", { phone, code, device });
  cache = { token: r.token, phone: r.phone };
  await Promise.all([AsyncStorage.setItem(TOKEN_KEY, r.token), AsyncStorage.setItem(PHONE_KEY, r.phone)]).catch(() => {});
}

export async function logoutAccount(): Promise<void> {
  await api("POST", "/api/auth/logout").catch(() => {});
  await clearSession();
}
