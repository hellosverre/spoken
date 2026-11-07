import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { CallResult } from "../../shared/contract.ts";
import { FallbackDb, MemoryDb, SupabaseDb, connectDb, type Db } from "../src/db.ts";
import { startServer, watchCall } from "./helpers.ts";

const DEV = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const result: CallResult = { callId: "c_1", taskId: "t_1", outcome: "done", summary: "Bestilt: 1 stor pepperoni, 189 kr", details: { pris: "189 kr" }, transcript: [{ who: "agent", text: "hemmelig", at: 1 }], durationSec: 42 };

/** Fake PostgREST: records requests, answers from a tiny table store. */
function fakeRest() {
  const reqs: { method: string; url: string; headers: Record<string, string>; body: any }[] = [];
  const f = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    reqs.push({ method: init?.method ?? "GET", url: String(url), headers: init?.headers ?? {}, body });
    if (String(url).includes("/contacts") && init?.method === "POST") return Response.json([{ id: "11111111-1111-1111-1111-111111111111", name: body.name, phone: body.phone, kind: body.kind }]);
    if (String(url).includes("/call_results") && (init?.method ?? "GET") === "GET") return Response.json([{ call_id: "c_1", task_id: "t_1", callee_name: "Domino's", outcome: "done", summary: "s", details: {}, duration_sec: 42, created_at: "2026-11-07T18:00:00Z" }]);
    if (String(url).includes("/profiles") && (init?.method ?? "GET") === "GET") return Response.json([{ name: "Sverre", phone: null, hear_call: true, personality: "warm", lang: "no", voice_id: null }]);
    return new Response(null, { status: 201 });
  }) as typeof fetch;
  return { f, reqs };
}

describe("SupabaseDb (PostgREST)", () => {
  test("requests carry the service key, upsert on conflict, never the transcript", async () => {
    const { f, reqs } = fakeRest();
    const db = new SupabaseDb("https://x.supabase.co", "svc-key", f);
    await db.saveResult(DEV, result, "Domino's");
    const save = reqs.at(-1)!;
    expect(save.url).toBe("https://x.supabase.co/rest/v1/call_results?on_conflict=call_id");
    expect(save.headers.apikey).toBe("svc-key");
    expect(save.headers.Authorization).toBe("Bearer svc-key");
    expect(save.headers.Prefer).toContain("merge-duplicates");
    expect(save.body).toMatchObject({ call_id: "c_1", device_id: DEV, outcome: "done", duration_sec: 42, callee_name: "Domino's" });
    expect(JSON.stringify(save.body)).not.toContain("hemmelig");
    expect((await db.getProfile(DEV))?.name).toBe("Sverre");
    expect((await db.listResults(DEV))[0]).toMatchObject({ callId: "c_1", calleeName: "Domino's", durationSec: 42 });
    expect((await db.addContact(DEV, { name: "Domino's", phone: "+4722000001", kind: "business" })).id).toBeDefined();
  });
});

describe("FallbackDb", () => {
  test("Supabase down → memory keeps the demo working", async () => {
    const broken: Db = new Proxy({} as Db, { get: (_t, k) => (k === "kind" ? "supabase" : async () => { throw new Error("ECONNRESET"); }) });
    const db = new FallbackDb(broken);
    await db.putProfile(DEV, { name: "Sverre", hearCall: true, personality: "warm", lang: "no" });
    expect((await db.getProfile(DEV))?.name).toBe("Sverre");
    const c = await db.addContact(DEV, { name: "Legen", phone: "+4722000003", kind: "business" });
    expect((await db.listContacts(DEV)).map((x) => x.id)).toContain(c.id);
    await db.saveResult(DEV, result, "X");
    expect((await db.listResults(DEV))[0]!.summary).toBe(result.summary);
  });
});

describe("connectDb", () => {
  test("gets the key from the Management API and never logs it", async () => {
    const logs: string[] = [];
    const orig = { log: console.log, warn: console.warn, tok: process.env.SUPABASE_ACCESS_TOKEN };
    console.log = (...a) => logs.push(a.join(" "));
    console.warn = (...a) => logs.push(a.join(" "));
    process.env.SUPABASE_ACCESS_TOKEN = "pat";
    try {
      const { f, reqs } = fakeRest();
      const mgmt = (async (url: any, init: any) => String(url).startsWith("https://api.supabase.com/")
        ? Response.json([{ name: "anon", api_key: "anon-key" }, { name: "service_role", api_key: "SERVICE-SECRET-123" }])
        : f(url, init)) as typeof fetch;
      const db = await connectDb(mgmt);
      expect(db.kind).toBe("supabase");
      expect(reqs.at(-1)!.headers.apikey).toBe("SERVICE-SECRET-123");
      const down = await connectDb((async () => new Response("no", { status: 401 })) as typeof fetch);
      expect(down.kind).toBe("memory");
      expect(logs.join("\n")).not.toContain("SERVICE-SECRET-123");
    } finally {
      console.log = orig.log; console.warn = orig.warn; process.env.SUPABASE_ACCESS_TOKEN = orig.tok;
    }
  });
});

describe("routes", () => {
  let s: ReturnType<typeof startServer>;
  beforeAll(() => { s = startServer(); });
  afterAll(() => s.stop());
  const H = { "Content-Type": "application/json", "X-Spoken-Device": DEV };

  test("profile per device", async () => {
    await fetch(`${s.base}/api/profile`, { method: "PUT", headers: H, body: JSON.stringify({ name: "Ingrid", hearCall: false, personality: "short", lang: "no" }) });
    expect(((await (await fetch(`${s.base}/api/profile`, { headers: H })).json()) as any).name).toBe("Ingrid");
    // another account starts from the default profile, untouched
    expect(((await (await fetch(`${s.base}/api/profile`)).json()) as any).name).toBe("Sverre");
    expect((await fetch(`${s.base}/api/profile`, { headers: { "x-test-anonymous": "1" } })).status).toBe(401);
  });

  test("contacts CRUD, numbers validated, device required", async () => {
    expect((await fetch(`${s.base}/api/contacts`, { headers: { "x-test-anonymous": "1" } })).status).toBe(401);
    const bad = await fetch(`${s.base}/api/contacts`, { method: "POST", headers: H, body: JSON.stringify({ name: "Nød", phone: "112" }) });
    expect(bad.status).toBe(400);
    const c: any = await (await fetch(`${s.base}/api/contacts`, { method: "POST", headers: H, body: JSON.stringify({ name: "Legen", phone: "22 00 00 03" }) })).json();
    expect(c).toMatchObject({ name: "Legen", phone: "+4722000003", kind: "business" });
    expect(((await (await fetch(`${s.base}/api/contacts`, { headers: H })).json()) as any[]).length).toBe(1);
    expect((await fetch(`${s.base}/api/contacts/${c.id}`, { method: "DELETE", headers: H })).status).toBe(200);
    expect(((await (await fetch(`${s.base}/api/contacts`, { headers: H })).json()) as any[]).length).toBe(0);
  });

  test("a finished call lands in the device's history as a summary only", async () => {
    await fetch(`${s.base}/api/profile`, { method: "PUT", headers: H, body: JSON.stringify({ name: "Sverre", hearCall: true, personality: "warm", lang: "no" }) });
    const post = async (p: string, b: unknown) => (await fetch(s.base + p, { method: "POST", headers: H, body: JSON.stringify(b) })).json() as any;
    const c = await post("/api/tasks", { text: "Bestill en stor pepperoni fra Domino's Storo til 18:00", lang: "no" });
    const answers: Record<string, string> = {};
    for (const q of c.questions) answers[q.id] = q.options?.[0] ?? "ja";
    await post(`/api/tasks/${c.taskId}/answers`, { answers });
    const call = await post(`/api/tasks/${c.taskId}/call`, { approved: true });
    await watchCall(s.base, call.callId).done;
    await Bun.sleep(50);
    const hist: any[] = await (await fetch(`${s.base}/api/calls?device=${DEV}`)).json() as any[];
    expect(hist[0]).toMatchObject({ callId: call.callId, outcome: "done", calleeName: "Domino's Storo" });
    expect(hist[0].transcript).toBeUndefined();
  }, 20_000);
});
