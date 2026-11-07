// Persistence: profile, contacts and call SUMMARIES per device (never transcripts or audio).
// Supabase (PostgREST, service role, key in memory only) with an in-memory fallback, so a dead
// network or a missing key never breaks a demo.

import type { CallResult, Contact, FeedbackInput, Profile } from "../../shared/contract.ts";

/** One row of call history (what GET /api/calls returns). */
export interface CallSummary {
  callId: string;
  taskId: string;
  calleeName: string;
  outcome: CallResult["outcome"];
  summary: string;
  details: Record<string, string>;
  durationSec: number;
  at: string; // ISO time
}

export interface Db {
  readonly kind: "supabase" | "memory";
  getProfile(device: string): Promise<Profile | null>;
  putProfile(device: string, p: Profile): Promise<void>;
  listContacts(device: string): Promise<Contact[]>;
  addContact(device: string, c: Omit<Contact, "id">): Promise<Contact>;
  deleteContact(device: string, id: string): Promise<boolean>;
  saveResult(device: string, r: CallResult, calleeName: string): Promise<void>;
  listResults(device: string, limit?: number): Promise<CallSummary[]>;
  saveFeedback(device: string, f: FeedbackInput): Promise<void>;
}

export const isDeviceId = (s: string | null | undefined): s is string =>
  !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// ---------- memory ----------

export class MemoryDb implements Db {
  readonly kind = "memory" as const;
  private profiles = new Map<string, Profile>();
  private contacts = new Map<string, Contact[]>();
  private results = new Map<string, CallSummary[]>();
  /** Feedback kept in memory only as a fallback while Supabase is down (read by tests). */
  readonly feedback: (FeedbackInput & { device: string; at: string })[] = [];

  async getProfile(d: string) { return this.profiles.get(d) ?? null; }
  async putProfile(d: string, p: Profile) { this.profiles.set(d, p); }
  async listContacts(d: string) { return [...(this.contacts.get(d) ?? [])]; }
  async addContact(d: string, c: Omit<Contact, "id">) {
    const row: Contact = { id: crypto.randomUUID(), ...c };
    this.contacts.set(d, [...(this.contacts.get(d) ?? []), row]);
    return row;
  }
  async deleteContact(d: string, id: string) {
    const list = this.contacts.get(d) ?? [];
    this.contacts.set(d, list.filter((c) => c.id !== id));
    return list.some((c) => c.id === id);
  }
  async saveResult(d: string, r: CallResult, calleeName: string) {
    const row: CallSummary = { callId: r.callId, taskId: r.taskId, calleeName, outcome: r.outcome, summary: r.summary, details: r.details, durationSec: r.durationSec, at: new Date().toISOString() };
    this.results.set(d, [row, ...(this.results.get(d) ?? []).filter((x) => x.callId !== r.callId)]);
  }
  async listResults(d: string, limit = 20) { return (this.results.get(d) ?? []).slice(0, limit); }
  async saveFeedback(d: string, f: FeedbackInput) { this.feedback.push({ device: d, ...f, at: new Date().toISOString() }); }
}

// ---------- supabase (PostgREST) ----------

type Fetch = typeof fetch;

export class SupabaseDb implements Db {
  readonly kind = "supabase" as const;
  constructor(private url: string, private key: string, private f: Fetch = fetch) {}

  private async rest(method: string, path: string, body?: unknown, prefer?: string): Promise<any> {
    const res = await this.f(`${this.url}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        "Content-Type": "application/json",
        ...(prefer ? { Prefer: prefer } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split("?")[0]} HTTP ${res.status}: ${text.slice(0, 160)}`);
    return text ? JSON.parse(text) : null;
  }

  async getProfile(d: string): Promise<Profile | null> {
    const rows = await this.rest("GET", `profiles?device_id=eq.${d}&select=*`);
    const r = rows?.[0];
    if (!r) return null;
    return {
      name: r.name ?? "", phone: r.phone ?? undefined, address: r.address ?? undefined, email: r.email ?? undefined,
      allergies: r.allergies ?? undefined, hearCall: r.hear_call, voiceId: r.voice_id ?? undefined, personality: r.personality, lang: r.lang,
    };
  }
  async putProfile(d: string, p: Profile) {
    await this.rest("POST", "profiles?on_conflict=device_id", {
      device_id: d, name: p.name, phone: p.phone ?? null, address: p.address ?? null, email: p.email ?? null, allergies: p.allergies ?? null,
      hear_call: p.hearCall, voice_id: p.voiceId ?? null, personality: p.personality, lang: p.lang, updated_at: new Date().toISOString(),
    }, "resolution=merge-duplicates,return=minimal");
  }
  async listContacts(d: string): Promise<Contact[]> {
    const rows = await this.rest("GET", `contacts?device_id=eq.${d}&select=id,name,phone,kind&order=created_at.asc`);
    return rows ?? [];
  }
  async addContact(d: string, c: Omit<Contact, "id">): Promise<Contact> {
    const rows = await this.rest("POST", "contacts?select=id,name,phone,kind", { device_id: d, ...c }, "return=representation");
    return rows[0];
  }
  async deleteContact(d: string, id: string) {
    if (!isDeviceId(id)) return false;
    const rows = await this.rest("DELETE", `contacts?device_id=eq.${d}&id=eq.${id}&select=id`, undefined, "return=representation");
    return (rows ?? []).length > 0;
  }
  async saveResult(d: string, r: CallResult, calleeName: string) {
    await this.rest("POST", "call_results?on_conflict=call_id", {
      call_id: r.callId, device_id: d, task_id: r.taskId, callee_name: calleeName, outcome: r.outcome,
      summary: r.summary, details: r.details, duration_sec: r.durationSec,
    }, "resolution=merge-duplicates,return=minimal");
  }
  async listResults(d: string, limit = 20): Promise<CallSummary[]> {
    const rows = await this.rest("GET", `call_results?device_id=eq.${d}&select=*&order=created_at.desc&limit=${Math.min(100, limit)}`);
    return (rows ?? []).map((r: any) => ({
      callId: r.call_id, taskId: r.task_id, calleeName: r.callee_name ?? "", outcome: r.outcome, summary: r.summary,
      details: r.details ?? {}, durationSec: r.duration_sec, at: r.created_at,
    }));
  }
  async saveFeedback(d: string, f: FeedbackInput) {
    await this.rest("POST", "feedback", {
      device_id: d, call_id: f.callId ?? null, rating: f.rating ?? null, comment: f.comment ?? null, source: f.source,
    }, "return=minimal");
  }
}

// ---------- fallback wrapper ----------

/**
 * Writes go to memory and Supabase; reads come from Supabase and fall back to memory when it
 * fails. One warning per outage, never the key.
 */
export class FallbackDb implements Db {
  get kind() { return this.primary ? "supabase" as const : "memory" as const; }
  private mem = new MemoryDb();
  private warned = false;
  constructor(private primary: Db | null) {}

  private async tryBoth<T>(what: string, remote: (db: Db) => Promise<T>, local: () => Promise<T>): Promise<T> {
    if (!this.primary) return local();
    try {
      const v = await remote(this.primary);
      this.warned = false;
      return v;
    } catch (e) {
      if (!this.warned) console.warn(`[db] Supabase ${what} failed, using memory: ${(e as Error).message}`);
      this.warned = true;
      return local();
    }
  }

  getProfile(d: string) { return this.tryBoth("getProfile", (db) => db.getProfile(d), () => this.mem.getProfile(d)).then(async (p) => p ?? this.mem.getProfile(d)); }
  async putProfile(d: string, p: Profile) { await this.mem.putProfile(d, p); await this.tryBoth("putProfile", (db) => db.putProfile(d, p), async () => {}); }
  listContacts(d: string) { return this.tryBoth("listContacts", (db) => db.listContacts(d), () => this.mem.listContacts(d)); }
  async addContact(d: string, c: Omit<Contact, "id">) { return this.tryBoth("addContact", (db) => db.addContact(d, c), () => this.mem.addContact(d, c)); }
  async deleteContact(d: string, id: string) {
    const local = await this.mem.deleteContact(d, id);
    return this.tryBoth("deleteContact", (db) => db.deleteContact(d, id), async () => local);
  }
  async saveResult(d: string, r: CallResult, n: string) { await this.mem.saveResult(d, r, n); await this.tryBoth("saveResult", (db) => db.saveResult(d, r, n), async () => {}); }
  listResults(d: string, limit?: number) { return this.tryBoth("listResults", (db) => db.listResults(d, limit), () => this.mem.listResults(d, limit)); }
  saveFeedback(d: string, f: FeedbackInput) {
    // Remote first; memory only when Supabase fails, so a note is never silently lost.
    return this.tryBoth("saveFeedback", (db) => db.saveFeedback(d, f), () => this.mem.saveFeedback(d, f));
  }
}

/**
 * Supabase URL + service-role key from the Management API at startup (SUPABASE_ACCESS_TOKEN).
 * The key stays in this process's memory; nothing is logged but the outcome.
 */
export async function connectDb(f: Fetch = fetch): Promise<FallbackDb> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = process.env.SUPABASE_PROJECT_REF || "txyzvjmfdnrhrprzjmdc";
  if (!token || process.env.SUPABASE === "0") { console.log("[db] memory only (no SUPABASE_ACCESS_TOKEN)"); return new FallbackDb(null); }
  try {
    const res = await f(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Management API HTTP ${res.status}`);
    const keys: any[] = await res.json();
    const key = keys.find((k) => k.name === "service_role")?.api_key ?? keys.find((k) => k.type === "secret")?.api_key;
    if (!key) throw new Error("no service_role key in the response");
    const db = new SupabaseDb(`https://${ref}.supabase.co`, key, f);
    await db.listResults("00000000-0000-0000-0000-000000000000", 1); // reachability + grants
    console.log(`[db] Supabase connected (project ${ref})`);
    return new FallbackDb(db);
  } catch (e) {
    console.warn(`[db] Supabase unavailable, memory only: ${(e as Error).message}`);
    return new FallbackDb(null);
  }
}
