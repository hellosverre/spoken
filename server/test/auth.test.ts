import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { CODE_TTL_MS, MAX_TRIES, createAuth, vonageSms, type SmsSender } from "../src/auth.ts";
import { FallbackDb } from "../src/db.ts";
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
  test("Bearer token makes another device see the account's contacts; anonymous still works", async () => {
    const db = new FallbackDb(null);
    const { auth, code } = (() => { const r = rig(); return { auth: createAuth(db, { sms: async (_t, text) => { r.sent.push({ to: "", text }); return "sms"; } }), code: r.code }; })();
    const app = createApp(undefined, db, auth);
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
    const base = `http://localhost:${server.port}`;
    const call = async (path: string, init: RequestInit & { dev?: string; token?: string } = {}) => {
      const r = await fetch(base + path, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.dev ? { "X-Spoken-Device": init.dev } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      });
      return { status: r.status, data: (await r.json()) as any };
    };
    try {
      expect((await call("/api/auth/me")).status).toBe(401);
      expect((await call("/api/auth/start", { method: "POST", body: JSON.stringify({ phone: PHONE }) })).status).toBe(200);
      const v = await call("/api/auth/verify", { method: "POST", body: JSON.stringify({ phone: PHONE, code: code(), device: D1 }) });
      expect(v.status).toBe(200);
      const token = v.data.token as string;
      await call("/api/contacts", { method: "POST", dev: D1, body: JSON.stringify({ name: "Pizza", phone: "+4722000001" }) });
      // Device 2 anonymous: sees nothing. With the token: sees device 1's contact.
      expect((await call("/api/contacts", { dev: D2 })).data).toEqual([]);
      const seen = await call("/api/contacts", { dev: D2, token });
      expect(seen.data.map((c: any) => c.name)).toEqual(["Pizza"]);
      expect((await call("/api/auth/me", { token })).data).toEqual({ phone: PHONE });
      await call("/api/auth/logout", { method: "POST", token });
      expect((await call("/api/contacts", { dev: D2, token })).data).toEqual([]);
    } finally {
      server.stop(true);
    }
  });
});
