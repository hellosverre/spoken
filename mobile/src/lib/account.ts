/* Optional phone-number account (SMS code). Logged out = the anonymous device, as before.
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
  const device = (await AsyncStorage.getItem(DEVICE_KEY).catch(() => null)) ?? "";
  const r = await api<{ token: string; phone: string }>("POST", "/api/auth/verify", { phone, code, device });
  cache = { token: r.token, phone: r.phone };
  await Promise.all([AsyncStorage.setItem(TOKEN_KEY, r.token), AsyncStorage.setItem(PHONE_KEY, r.phone)]).catch(() => {});
}

export async function logoutAccount(): Promise<void> {
  await api("POST", "/api/auth/logout").catch(() => {});
  cache = { token: "", phone: "" };
  await Promise.all([AsyncStorage.removeItem(TOKEN_KEY), AsyncStorage.removeItem(PHONE_KEY)]).catch(() => {});
}
