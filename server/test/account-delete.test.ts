import { afterAll, describe, expect, test } from "bun:test";
import { FallbackDb, MemoryDb, SupabaseDb } from "../src/db.ts";
import { startServer } from "./helpers.ts";

const s = startServer();
afterAll(() => s.stop());

const profile = { name: "Ola", hearCall: true, personality: "warm", lang: "no" };

describe("DELETE /api/account", () => {
  test("erases profile, contacts, feedback and the login; others stay", async () => {
    const tok = await s.login();
    const other = await s.login();
    await s.send("PUT", "/api/profile", profile, tok);
    await s.send("POST", "/api/contacts", { name: "Melvin", phone: "+4791909007" }, tok);
    await s.send("POST", "/api/contacts", { name: "Beholdes", phone: "+4791909008" }, other);
    await s.send("POST", "/api/feedback", { source: "profile", comment: "hei" }, tok);

    const r = await fetch(s.base + "/api/account", { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } });
    expect(r.status).toBe(204);

    // The token is dead.
    expect((await s.send("GET", "/api/contacts", undefined, tok)).status).toBe(401);
    expect((await s.send("GET", "/api/auth/me", undefined, tok)).status).toBe(401);
    // The other account is untouched.
    const kept = await s.send("GET", "/api/contacts", undefined, other);
    expect(kept.data.map((c: any) => c.name)).toEqual(["Beholdes"]);
  });

  test("the same phone number signs up again with nothing left", async () => {
    const phone = "+4790777001";
    const tok = await s.login(phone);
    await s.send("POST", "/api/contacts", { name: "Gammel", phone: "+4791909007" }, tok);
    expect((await s.send("DELETE", "/api/account", undefined, tok)).status).toBe(204);
    const again = await s.login(phone);
    expect((await s.send("GET", "/api/contacts", undefined, again)).data).toEqual([]);
  });

  test("401 without a token", async () => {
    expect((await s.send("DELETE", "/api/account", undefined, "")).status).toBe(401);
  });
});

describe("db.deleteAccount", () => {
  test("memory: every linked device's data is removed", async () => {
    const m = new MemoryDb();
    const [d1, d2] = [crypto.randomUUID(), crypto.randomUUID()];
    const a = await m.upsertAccount("+4790000001", d1);
    await m.upsertAccount("+4790000001", d2);
    await m.addContact(d1, { name: "A", phone: "+4791909007", kind: "person" });
    await m.addContact(d2, { name: "B", phone: "+4791909008", kind: "person" });
    await m.saveFeedback(d2, { source: "profile", comment: "x" });
    await m.createSession("h".repeat(64), a.id, new Date(Date.now() + 1e6).toISOString());
    await m.deleteAccount(a.id);
    expect(await m.listContacts(d1)).toEqual([]);
    expect(await m.listContacts(d2)).toEqual([]);
    expect(m.feedback).toEqual([]);
    expect(await m.getSession("h".repeat(64))).toBeNull();
  });

  test("supabase: deletes every table, account row last", async () => {
    const id = crypto.randomUUID(), d = crypto.randomUUID();
    const calls: string[] = [];
    const f = (async (url: any, init: any) => {
      const u = String(url).replace("https://x.supabase.co/rest/v1/", "");
      calls.push(`${init.method} ${u}`);
      if (u.startsWith("accounts?id")) return new Response(JSON.stringify([{ primary_device: d }]));
      if (u.startsWith("account_devices?account_id") && init.method === "GET") return new Response(JSON.stringify([{ device_id: d }]));
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await new SupabaseDb("https://x.supabase.co", "k", f).deleteAccount(id);
    const dels = calls.filter((c) => c.startsWith("DELETE")).map((c) => c.split("?")[0]!.replace("DELETE ", ""));
    expect(dels).toEqual(["profiles", "contacts", "call_results", "feedback", "sessions", "account_devices", "accounts"]);
  });

  test("a Supabase failure is reported, not swallowed", async () => {
    const broken = new SupabaseDb("https://x.supabase.co", "k", (async () => { throw new Error("down"); }) as unknown as typeof fetch);
    await expect(new FallbackDb(broken).deleteAccount(crypto.randomUUID())).rejects.toThrow();
  });
});
