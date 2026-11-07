import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { FallbackDb, MemoryDb, SupabaseDb } from "../src/db.ts";
import "./helpers.ts"; // mock providers

const DEV = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
let server: ReturnType<typeof Bun.serve>;
let base = "";
const mem = new MemoryDb();

beforeAll(() => {
  const app = createApp(undefined, mem);
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  base = `http://localhost:${server.port}`;
});
afterAll(() => server.stop(true));

const send = (body: unknown, headers: Record<string, string> = { "X-Spoken-Device": DEV }) =>
  fetch(base + "/api/feedback", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("POST /api/feedback", () => {
  test("saves a rating with a comment, trimmed", async () => {
    const r = await send({ source: "call", callId: "c_abc", rating: "up", comment: "  Fungerte fint  " }, { "X-Spoken-Device": DEV, "cf-connecting-ip": "10.0.0.1" });
    expect(r.status).toBe(201);
    expect(mem.feedback.at(-1)).toMatchObject({ device: DEV, source: "call", callId: "c_abc", rating: "up", comment: "Fungerte fint" });
  });

  test("a comment alone from Profile is fine", async () => {
    expect((await send({ source: "profile", comment: "Add Swedish" }, { "X-Spoken-Device": DEV, "cf-connecting-ip": "10.0.0.2" })).status).toBe(201);
  });

  test("400 without a device", async () => {
    expect((await send({ source: "call", rating: "up" }, { "cf-connecting-ip": "10.0.0.3" })).status).toBe(400);
  });

  test("400 when empty, bad rating, bad source or too long", async () => {
    const h = { "X-Spoken-Device": DEV, "cf-connecting-ip": "10.0.0.4" };
    expect((await send({ source: "call" }, h)).status).toBe(400);
    expect((await send({ source: "call", comment: "   " }, h)).status).toBe(400);
    expect((await send({ source: "call", rating: "meh" }, h)).status).toBe(400);
    expect((await send({ source: "web", rating: "up" }, h)).status).toBe(400);
    expect((await send({ source: "profile", comment: "x".repeat(1001) }, h)).status).toBe(400);
  });

  test("429 over the per-IP limit", async () => {
    const h = { "X-Spoken-Device": DEV, "cf-connecting-ip": "10.0.0.99" };
    for (let i = 0; i < 20; i++) expect((await send({ source: "profile", comment: `n${i}` }, h)).status).toBe(201);
    expect((await send({ source: "profile", comment: "one too many" }, h)).status).toBe(429);
  });
});

describe("feedback storage", () => {
  test("Supabase row has no transcript fields; outage falls back to memory", async () => {
    const seen: any[] = [];
    const f = (async (url: any, init: any) => { seen.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(null, { status: 201 }); }) as typeof fetch;
    await new SupabaseDb("https://x.supabase.co", "k", f).saveFeedback(DEV, { source: "call", rating: "down", callId: "c_1" });
    expect(seen[0].url).toBe("https://x.supabase.co/rest/v1/feedback");
    expect(seen[0].body).toEqual({ device_id: DEV, call_id: "c_1", rating: "down", comment: null, source: "call" });

    const broken = new SupabaseDb("https://x.supabase.co", "k", (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    const db = new FallbackDb(broken);
    await db.saveFeedback(DEV, { source: "profile", comment: "hei" }); // must not throw
  });
});
