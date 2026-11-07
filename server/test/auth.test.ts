import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { CODE_TTL_MS, MAX_TRIES, SESSION_TTL_MS, createAuth, vonageSms, type SmsSender } from "../src/auth.ts";
import { FallbackDb } from "../src/db.ts";
import { startServer } from "./helpers.ts";
import { config } from "../src/config.ts";

const D1 = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const D2 = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
const PHONE = "+4791234567";

function rig() {
  let t = 1_000_000;
  const sent: { to: string; text: string }[] = [];
  const sms: SmsSender = async (to, text) => { sent.push({ to, text }); return "sms"; };
  const db = new FallbackDb(null);
  const auth = createAuth(db, { sms, now: () => t });
  const code = () => sent.at(-1)!.text.match(/\d{6}/)![0];
  return { db, auth, sent, code, tick: (ms: number) => (t += ms) };
}

describe("OTP", () => {
  test("start → verify → token resolves to the account; text format", async () => {
    const { auth, sent, code } = rig();
    expect(await auth.start("912 34 567", "1.1.1.1")).toEqual({ ok: true, value: { sent: "sms" } });
    expect(sent[0]).toMatchObject({ to: PHONE });
    expect(sent[0]!.text).toMatch(/^Spoken-kode: \d{6}$/);
    const v = await auth.verify(PHONE, code(), D1);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.value.phone).toBe(PHONE);
    const me = await auth.resolve(`Bearer ${v.value.token}`);
    expect(me).toMatchObject({ phone: PHONE, device: D1 });
    expect(await auth.resolve("Bearer " + "x".repeat(43))).toBeNull();
    expect(await auth.resolve(null)).toBeNull();
    await auth.logout(`Bearer ${v.value.token}`);
    expect(await auth.resolve(`Bearer ${v.value.token}`)).toBeNull();
  });

  test("a code works once", async () => {
    const { auth, code } = rig();
    await auth.start(PHONE, "ip");
    const c = code();
    expect((await auth.verify(PHONE, c, D1)).ok).toBe(true);
    expect((await auth.verify(PHONE, c, D1)).ok).toBe(false);
  });

  test("5 wrong codes lock it, even the right one after", async () => {
    const { auth, code } = rig();
    await auth.start(PHONE, "ip");
    const good = code();
    const bad = good === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_TRIES; i++) {
      const r = await auth.verify(PHONE, bad, D1);
      expect(r).toMatchObject({ ok: false, status: 400 });
    }
    expect(await auth.verify(PHONE, bad, D1)).toMatchObject({ ok: false, status: 429 });
    expect((await auth.verify(PHONE, good, D1)).ok).toBe(false);
  });

  test("a code expires after 10 minutes", async () => {
    const { auth, code, tick } = rig();
    await auth.start(PHONE, "ip");
    tick(CODE_TTL_MS + 1);
    expect(await auth.verify(PHONE, code(), D1)).toMatchObject({ ok: false, status: 400 });
  });

  test("rate limits: 3 per phone per 10 min, 10 per IP per hour", async () => {
    const { auth, tick } = rig();
    for (let i = 0; i < 3; i++) expect((await auth.start(PHONE, "ip-a")).ok).toBe(true);
    expect(await auth.start(PHONE, "ip-a")).toMatchObject({ ok: false, status: 429 });
    tick(10 * 60_000 + 1);
    expect((await auth.start(PHONE, "ip-a")).ok).toBe(true);
    const { auth: a2 } = rig();
    for (let i = 0; i < 10; i++) expect((await a2.start(`+47912345${String(10 + i)}`, "ip-b")).ok).toBe(true);
    expect(await a2.start("+4791234599", "ip-b")).toMatchObject({ ok: false, status: 429 });
  });

  test("bad input", async () => {
    const { auth } = rig();
    expect(await auth.start("12", "ip")).toMatchObject({ ok: false, status: 400 });
    expect(await auth.start(undefined, "ip")).toMatchObject({ ok: false, status: 400 });
    await auth.start(PHONE, "ip");
    expect(await auth.verify(PHONE, "123456", "not-a-uuid")).toMatchObject({ ok: false, status: 400 });
  });

  test("session expiry", async () => {
    const { auth, code, tick } = rig();
    await auth.start(PHONE, "ip");
    const v = await auth.verify(PHONE, code(), D1);
    if (!v.ok) throw new Error("verify failed");
    tick(31 * 24 * 3600_000);
    expect(await auth.resolve(`Bearer ${v.value.token}`)).toBeNull();
  });

  test("failing SMS gives 502, no code kept", async () => {
    const db = new FallbackDb(null);
    const auth = createAuth(db, { sms: async () => { throw new Error("nope"); } });
    expect(await auth.start(PHONE, "ip")).toMatchObject({ ok: false, status: 502 });
  });
});

describe("devices", () => {
  test("a second device joins the account and its rows merge into the account's data", async () => {
    const { db, auth, code } = rig();
    await db.addContact(D1, { name: "Pizza", phone: "+4722000001", kind: "business" });
    await auth.start(PHONE, "ip");
    const a = await auth.verify(PHONE, code(), D1);
    // The second phone had its own contact (one duplicate) before logging in.
    await db.addContact(D2, { name: "Pizza igjen", phone: "+4722000001", kind: "business" });
    await db.addContact(D2, { name: "Legen", phone: "+4722000002", kind: "business" });
    await auth.start(PHONE, "ip");
    const b = await auth.verify(PHONE, code(), D2);
    if (!a.ok || !b.ok) throw new Error("login failed");
    expect(b.value.device).toBe(D1); // same data key
    expect((await db.listContacts(D1)).map((c) => c.phone).sort()).toEqual(["+4722000001", "+4722000002"]);
  });
});

describe("Vonage SMS sender", () => {
  test("mock mode / missing keys: logs, sends nothing", async () => {
    const old = [process.env.VONAGE_API_KEY, process.env.VONAGE_API_SECRET];
    delete process.env.VONAGE_API_KEY; delete process.env.VONAGE_API_SECRET;
    let called = false;
    const log = console.log; console.log = () => {};
    const r = await vonageSms((async () => { called = true; return new Response(); }) as typeof fetch)(PHONE, "Spoken-kode: 123456");
    console.log = log;
    expect(r).toBe("dev");
    expect(called).toBe(false);
    [process.env.VONAGE_API_KEY, process.env.VONAGE_API_SECRET] = old as [string, string];
  });

  test("with keys: form body to rest.nexmo.com, status 0 = sent", async () => {
    const saved = [process.env.VONAGE_API_KEY, process.env.VONAGE_API_SECRET, config.callProvider] as const;
    process.env.VONAGE_API_KEY = "k"; process.env.VONAGE_API_SECRET = "s"; config.callProvider = "vonage" as typeof config.callProvider;
    let seen: { url: string; body: string } | null = null;
    const ok = (async (url: any, init: any) => { seen = { url: String(url), body: String(init.body) }; return Response.json({ messages: [{ status: "0" }] }); }) as typeof fetch;
    expect(await vonageSms(ok)(PHONE, "Spoken-kode: 123456")).toBe("sms");
    const p = new URLSearchParams(seen!.body);
    expect(seen!.url).toBe("https://rest.nexmo.com/sms/json");
    expect(Object.fromEntries(p)).toMatchObject({ api_key: "k", from: "Spoken", to: "4791234567", text: "Spoken-kode: 123456" });
    const bad = (async () => Response.json({ messages: [{ status: "4", "error-text": "Bad Credentials" }] })) as typeof fetch;
    const warn = console.warn; console.warn = () => {};
    await expect(vonageSms(bad)(PHONE, "x")).rejects.toThrow();
    console.warn = warn;
    [process.env.VONAGE_API_KEY, process.env.VONAGE_API_SECRET, config.callProvider] = saved as any;
    if (saved[0] === undefined) delete process.env.VONAGE_API_KEY;
    if (saved[1] === undefined) delete process.env.VONAGE_API_SECRET;
  });
});

describe("HTTP", () => {
  test("login is required for every /api route except auth; open routes stay open", async () => {
    const s = startServer();
    try {
      const anon = (method: string, path: string, body?: unknown) => s.send(method, path, body, "");
      const routes: [string, string][] = [
        ["GET", "/api/profile"], ["PUT", "/api/profile"], ["GET", "/api/contacts"], ["POST", "/api/contacts"], ["DELETE", "/api/contacts/x"],
        ["GET", "/api/calls"], ["GET", "/api/calls/c_x"], ["POST", "/api/calls/c_x/hangup"], ["POST", "/api/tasks"], ["POST", "/api/tasks/t_x/answers"],
        ["POST", "/api/tasks/t_x/call"], ["POST", "/api/compare"], ["GET", "/api/compare/x"], ["POST", "/api/feedback"], ["GET", "/api/voices"],
        ["POST", "/api/voices/design"], ["GET", "/api/incoming"], ["GET", "/api/calls/c_x/audio"], ["GET", "/api/calls/c_x/live"],
      ];
      for (const [m, p] of routes) {
        const r = await anon(m, p, m === "POST" || m === "PUT" ? {} : undefined);
        expect([m, p, r.status, r.data]).toEqual([m, p, 401, { error: "login required" }]);
      }
      // junk token, wrong scheme
      expect((await s.send("GET", "/api/profile", undefined, "x".repeat(43))).status).toBe(401);
      expect((await fetch(`${s.base}/api/profile?token=${"y".repeat(43)}`, { headers: { "x-test-anonymous": "1" } })).status).toBe(401);
      // open
      expect((await fetch(`${s.base}/health`)).status).toBe(200);
      expect((await anon("GET", "/api/auth/me")).status).toBe(401); // auth's own answer, not the gate's
      expect((await fetch(`${s.base}/vonage/answer`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status).not.toBe(401);
      // and with a session the same routes work
      expect((await s.get("/api/profile")).status).toBe(200);
      expect((await s.get("/api/voices")).status).toBe(200);
    } finally { s.stop(); }
  });

  test("an expired session gets 401", async () => {
    let t = 1_000_000;
    const db = new FallbackDb(null);
    let text = "";
    const auth = createAuth(db, { sms: async (_to, tx) => { text = tx; return "dev"; }, now: () => t });
    await auth.start(PHONE, "ip");
    const v = await auth.verify(PHONE, text.match(/\d{6}/)![0], D1);
    if (!v.ok) throw new Error("verify");
    expect(await auth.resolve(`Bearer ${v.value.token}`)).not.toBeNull();
    t += SESSION_TTL_MS + 1;
    expect(await auth.resolve(`Bearer ${v.value.token}`)).toBeNull();
    // and over HTTP: the app built on an auth whose clock has moved on
    const app = createApp(undefined, db, auth);
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
    try {
      const r = await fetch(`http://localhost:${server.port}/api/profile`, { headers: { Authorization: `Bearer ${v.value.token}` } });
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "login required" });
    } finally { server.stop(true); }
  });

  test("two accounts never see each other's data; logout kills the session", async () => {
    const s = startServer();
    try {
      const a = await s.login("+4791000001");
      const b = await s.login("+4791000002");
      expect(a).not.toBe(b);
      const asA = (m: string, p: string, body?: unknown) => s.send(m, p, body, a);
      const asB = (m: string, p: string, body?: unknown) => s.send(m, p, body, b);
      expect((await asA("POST", "/api/contacts", { name: "Pizza", phone: "+4722000001" })).status).toBe(201);
      expect((await asA("PUT", "/api/profile", { name: "Anna", hearCall: true, personality: "warm", lang: "no" })).status).toBe(200);
      expect((await asA("POST", "/api/feedback", { source: "profile", comment: "hei" })).status).toBe(201);
      expect((await asB("GET", "/api/contacts")).data).toEqual([]);
      expect((await asB("GET", "/api/profile")).data.name).toBe("");
      expect((await asA("GET", "/api/profile")).data.name).toBe("Anna");
      expect((await asA("GET", "/api/contacts")).data.map((c: any) => c.name)).toEqual(["Pizza"]);
      // B cannot delete A's contact, nor use A's task
      const id = (await asA("GET", "/api/contacts")).data[0].id;
      expect((await asB("DELETE", `/api/contacts/${id}`)).status).toBe(404);
      const task = await asA("POST", "/api/tasks", { text: "Bestill pizza hos Pizzabakeren", lang: "no", phone: "22000001" });
      expect(task.status).toBe(200);
      expect((await asB("POST", `/api/tasks/${task.data.taskId}/answers`, { answers: {} })).status).toBe(404);
      // X-Spoken-Device is only a hint: claiming A's device does not give B A's data
      const spoof = await fetch(`${s.base}/api/contacts`, { headers: { Authorization: `Bearer ${b}`, "X-Spoken-Device": (await s.db.getSession(await sha(a)))!.primaryDevice } });
      expect(await spoof.json()).toEqual([]);
      // logout
      expect((await asA("POST", "/api/auth/logout")).status).toBe(200);
      expect((await asA("GET", "/api/contacts")).status).toBe(401);
      expect((await asB("GET", "/api/contacts")).status).toBe(200);
    } finally { s.stop(); }
  });

  test("a websocket takes the session as ?token=", async () => {
    const s = startServer();
    try {
      const token = await s.login("+4791000003");
      const anon = await fetch(`${s.base}/api/calls/c_none/live`, { headers: { "x-test-anonymous": "1" } });
      expect(anon.status).toBe(401);
      const authed = await fetch(`${s.base}/api/calls/c_none/live?token=${token}`);
      expect(authed.status).toBe(404); // past the gate: just an unknown call
    } finally { s.stop(); }
  });
});

async function sha(token: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}
