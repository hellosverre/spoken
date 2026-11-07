import type { LiveEvent } from "../../shared/contract.ts";
import { createApp } from "../src/app.ts";
import { createAuth, type SmsSender } from "../src/auth.ts";
import { FallbackDb } from "../src/db.ts";
import { config } from "../src/config.ts";
import { resetLimits } from "../src/store.ts";

// Tests always run the keyless mock path, fast.
config.callProvider = "mock";
config.llmProvider = "mock";
config.mockSpeed = 0.02;

process.env.SPOKEN_NO_SMS = "1";
let phoneSeq = 0;

// --- test login ------------------------------------------------------------------------------
// Every /api route needs a session now. Tests log in through the real SMS path (/api/auth/start →
// /verify) with the dev-mode code: apps made by startServer get an injected SmsSender; any other
// app (tests that call createApp() themselves) logs its code to the console in mock mode, which
// the console.log tap below reads. The fetch/WebSocket wrappers then add the session to
// requests against a test server, so older tests that fetch `s.base` directly keep working.
// A request's X-Spoken-Device (or ?device=) becomes the account's device, so data keys stay what
// those tests expect. Send `x-test-anonymous: 1` to go out without a session.
let lastCode = "";
const realLog = console.log;
console.log = (...a: unknown[]) => {
  const m = typeof a[0] === "string" ? a[0].match(/\[auth\] dev mode.*Spoken-kode: (\d{6})/) : null;
  if (m) lastCode = m[1]!;
  else realLog(...a);
};

const realFetch = globalThis.fetch;
const RealWebSocket = globalThis.WebSocket;
const sessions = new Map<string, Promise<string>>(); // `${origin}|${device}` → token
const lastToken = new Map<string, string>(); // origin → newest token (for websockets)

function sessionFor(origin: string, device: string, withDefaultProfile = false): Promise<string> {
  const key = `${origin}|${device}`;
  let p = sessions.get(key);
  if (!p) {
    p = (async () => {
      const phone = `+4790${String(100000 + ++phoneSeq)}`;
      const json = (path: string, body: unknown) => realFetch(origin + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      lastCode = "";
      const s = await json("/api/auth/start", { phone });
      if (!s.ok) throw new Error(`test login: auth/start ${s.status} ${await s.text()}`);
      const v = await json("/api/auth/verify", { phone, code: lastCode, device });
      if (!v.ok) throw new Error(`test login: auth/verify ${v.status} ${await v.text()}`);
      const token = ((await v.json()) as { token: string }).token;
      lastToken.set(origin, token);
      // Old tests expect the demo profile ("Sverre") when they bring no device of their own.
      if (withDefaultProfile) await realFetch(origin + "/api/profile", { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "Sverre", hearCall: true, personality: "warm", lang: "no" }) });
      return token;
    })();
    sessions.set(key, p);
  }
  return p;
}

const defaultDevice = new Map<string, string>(); // origin → device for requests that bring none
const DEVICE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (!local || !url.pathname.startsWith("/api/") || url.pathname.startsWith("/api/auth/") || headers.has("authorization")) return realFetch(input, init);
  if (headers.has("x-test-anonymous")) { headers.delete("x-test-anonymous"); return realFetch(input, { ...init, headers }); }
  const hint = headers.get("x-spoken-device") ?? url.searchParams.get("device");
  const hinted = !!hint && DEVICE_RE.test(hint);
  const device = hinted ? hint!.toLowerCase() : (defaultDevice.get(url.origin) ?? defaultDevice.set(url.origin, crypto.randomUUID()).get(url.origin)!);
  headers.set("authorization", `Bearer ${await sessionFor(url.origin, device, !hinted)}`);
  return realFetch(input, { ...init, headers });
}) as typeof fetch;

globalThis.WebSocket = class extends RealWebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    const u = new URL(String(url));
    const tok = lastToken.get(u.origin.replace("ws", "http"));
    if (tok && u.pathname.startsWith("/api/") && !u.searchParams.has("token")) u.searchParams.set("token", tok);
    super(u.href, protocols as any);
  }
} as typeof WebSocket;

/**
 * Boots the app with an injected SmsSender. post/get log in lazily (one random account) and send the
 * session; `login(phone)` makes another account and returns its token; `send(method, path, body, token)`
 * uses an explicit token ("" = anonymous).
 */
export function startServer() {
  resetLimits();
  const sent: { to: string; text: string }[] = [];
  const sms: SmsSender = async (to, text) => { sent.push({ to, text }); lastCode = text.match(/\d{6}/)![0]; return "dev"; };
  const db = new FallbackDb(null);
  const auth = createAuth(db, { sms });
  const app = createApp(undefined, db, auth);
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  const base = `http://localhost:${server.port}`;
  const send = async (method: string, path: string, body?: unknown, tok?: string) => {
    const headers: Record<string, string> = tok === "" ? { "x-test-anonymous": "1" } : tok ? { Authorization: `Bearer ${tok}` } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: (await r.json().catch(() => null)) as any };
  };
  /** A fresh account (own phone number, own device); returns its session token. */
  const login = (phone?: string) => {
    if (!phone) return sessionFor(base, crypto.randomUUID(), true);
    return (async () => {
      await send("POST", "/api/auth/start", { phone }, "");
      const v = await send("POST", "/api/auth/verify", { phone, code: lastCode, device: crypto.randomUUID() }, "");
      return v.data.token as string;
    })();
  };
  return {
    server, base, db, sent, login, send,
    post: (path: string, body?: unknown) => send("POST", path, body),
    get: (path: string) => send("GET", path),
    stop: () => server.stop(true),
  };
}

/** Opens the live socket; auto-answers approvals with `choose` and resolves on `result`. */
export function watchCall(base: string, callId: string, choose: (q: string) => string = () => "JA") {
  const events: LiveEvent[] = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/calls/${callId}/live`);
  const done = new Promise<LiveEvent[]>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("call did not finish: " + JSON.stringify(events.map((e) => e.type)))), 15_000);
    ws.onmessage = (m) => {
      const ev = JSON.parse(String(m.data)) as LiveEvent;
      events.push(ev);
      if (ev.type === "approval_request") ws.send(JSON.stringify({ type: "approval_response", id: ev.id, choice: choose(ev.question) }));
      if (ev.type === "result") { clearTimeout(t); ws.close(); resolve(events); }
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
  return { ws, events, done };
}
