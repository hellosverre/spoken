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

/** A phone-number account. Its data lives under `primaryDevice`: every linked device reads and writes that key. */
export interface Account {
  id: string;
  phone: string;
  primaryDevice: string;
}
export interface SessionRow extends Account {
  expiresAt: string; // ISO time
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
  /** Find the account for a phone (or create it with `device` as its data key) and link `device` to it. */
  upsertAccount(phone: string, device: string): Promise<Account>;
  /** Sessions are stored by sha256 of the token, never the token. */
  createSession(tokenHash: string, accountId: string, expiresAt: string): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRow | null>;
  deleteSession(tokenHash: string): Promise<void>;
  /** Copy what `from` has (contacts, profile if `to` has none, call history) onto `to`. */
  mergeDevice(from: string, to: string): Promise<void>;
  /** Erase everything about an account: profile, contacts, call history and feedback (on every linked device), links, sessions and the account itself. Throws if it could not be erased. */
  deleteAccount(accountId: string): Promise<void>;
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

  private accounts = new Map<string, Account>(); // by phone
  private links = new Set<string>(); // `${accountId}:${device}`
  private sessions = new Map<string, { accountId: string; expiresAt: string }>();
  /** Take an account made elsewhere (Supabase) so it survives an outage. */
  adopt(a: Account, device: string) { this.accounts.set(a.phone, a); this.links.add(`${a.id}:${device}`); }
  async upsertAccount(phone: string, device: string) {
    const a = this.accounts.get(phone) ?? { id: crypto.randomUUID(), phone, primaryDevice: device };
    this.adopt(a, device);
    return a;
  }
  async createSession(h: string, accountId: string, expiresAt: string) { this.sessions.set(h, { accountId, expiresAt }); }
  async getSession(h: string): Promise<SessionRow | null> {
    const s = this.sessions.get(h);
    const a = s && [...this.accounts.values()].find((x) => x.id === s.accountId);
    return s && a ? { ...a, expiresAt: s.expiresAt } : null;
  }
  async deleteSession(h: string) { this.sessions.delete(h); }
  async deleteAccount(accountId: string) {
    const acct = [...this.accounts.values()].find((a) => a.id === accountId);
    const devices = new Set<string>(acct ? [acct.primaryDevice] : []);
    for (const l of this.links) if (l.startsWith(`${accountId}:`)) { devices.add(l.slice(accountId.length + 1)); this.links.delete(l); }
    for (const d of devices) {
      this.profiles.delete(d); this.contacts.delete(d); this.results.delete(d);
      for (let i = this.feedback.length - 1; i >= 0; i--) if (this.feedback[i]!.device === d) this.feedback.splice(i, 1);
    }
    for (const [h, s] of this.sessions) if (s.accountId === accountId) this.sessions.delete(h);
    if (acct) this.accounts.delete(acct.phone);
  }
  async mergeDevice(from: string, to: string) {
    if (from === to) return;
    const have = new Set((this.contacts.get(to) ?? []).map((c) => c.phone));
    const moved = (this.contacts.get(from) ?? []).filter((c) => !have.has(c.phone));
    this.contacts.set(to, [...(this.contacts.get(to) ?? []), ...moved.map((c) => ({ ...c, id: crypto.randomUUID() }))]);
    const mine = this.profiles.get(from);
    if (mine && !this.profiles.get(to)?.name) this.profiles.set(to, mine);
    const ids = new Set((this.results.get(to) ?? []).map((r) => r.callId));
    this.results.set(to, [...(this.results.get(to) ?? []), ...(this.results.get(from) ?? []).filter((r) => !ids.has(r.callId))].sort((a, b) => b.at.localeCompare(a.at)));
  }
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
      reason: r.reason ?? undefined, reasonText: r.reason_text ?? undefined, reasonMode: r.reason_mode ?? undefined,
    };
  }
  async putProfile(d: string, p: Profile) {
    await this.rest("POST", "profiles?on_conflict=device_id", {
      device_id: d, name: p.name, phone: p.phone ?? null, address: p.address ?? null, email: p.email ?? null, allergies: p.allergies ?? null,
      hear_call: p.hearCall, voice_id: p.voiceId ?? null, personality: p.personality, lang: p.lang,
      reason: p.reason ?? null, reason_text: p.reasonText ?? null, reason_mode: p.reasonMode ?? null, updated_at: new Date().toISOString(),
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

  async upsertAccount(phone: string, device: string): Promise<Account> {
    const q = encodeURIComponent(phone);
    let row = (await this.rest("GET", `accounts?phone=eq.${q}&select=id,phone,primary_device`))?.[0];
    if (!row) {
      row = (await this.rest("POST", "accounts?select=id,phone,primary_device", { phone, primary_device: device }, "return=representation"))[0];
    }
    await this.rest("POST", "account_devices?on_conflict=account_id,device_id", { account_id: row.id, device_id: device }, "resolution=ignore-duplicates,return=minimal");
    return { id: row.id, phone: row.phone, primaryDevice: row.primary_device };
  }
  async createSession(h: string, accountId: string, expiresAt: string) {
    await this.rest("POST", "sessions", { token_hash: h, account_id: accountId, expires_at: expiresAt }, "return=minimal");
  }
  async getSession(h: string): Promise<SessionRow | null> {
    if (!/^[0-9a-f]{64}$/.test(h)) return null;
    const r = (await this.rest("GET", `sessions?token_hash=eq.${h}&select=expires_at,accounts(id,phone,primary_device)`))?.[0];
    if (!r?.accounts) return null;
    return { id: r.accounts.id, phone: r.accounts.phone, primaryDevice: r.accounts.primary_device, expiresAt: r.expires_at };
  }
  async deleteSession(h: string) {
    if (/^[0-9a-f]{64}$/.test(h)) await this.rest("DELETE", `sessions?token_hash=eq.${h}`, undefined, "return=minimal");
  }
  async deleteAccount(accountId: string) {
    if (!isDeviceId(accountId)) throw new Error("bad account id");
    const acct = (await this.rest("GET", `accounts?id=eq.${accountId}&select=primary_device`))?.[0];
    const linked: any[] = (await this.rest("GET", `account_devices?account_id=eq.${accountId}&select=device_id`)) ?? [];
    const devices = [...new Set<string>([...(acct ? [acct.primary_device] : []), ...linked.map((r) => r.device_id)])].filter(isDeviceId);
    if (devices.length) {
      const inList = `in.(${devices.join(",")})`;
      for (const table of ["profiles", "contacts", "call_results", "feedback"]) {
        await this.rest("DELETE", `${table}?device_id=${inList}`, undefined, "return=minimal");
      }
    }
    // Sessions and links first, the account row last (they reference it).
    await this.rest("DELETE", `sessions?account_id=eq.${accountId}`, undefined, "return=minimal");
    await this.rest("DELETE", `account_devices?account_id=eq.${accountId}`, undefined, "return=minimal");
    await this.rest("DELETE", `accounts?id=eq.${accountId}`, undefined, "return=minimal");
  }
  async mergeDevice(from: string, to: string) {
    if (from === to) return;
    const have = new Set((await this.listContacts(to)).map((c) => c.phone));
    for (const c of await this.listContacts(from)) {
      if (!have.has(c.phone)) await this.addContact(to, { name: c.name, phone: c.phone, kind: c.kind });
    }
    const mine = await this.getProfile(from);
    if (mine && !(await this.getProfile(to))?.name) await this.putProfile(to, mine);
    await this.rest("PATCH", `call_results?device_id=eq.${from}`, { device_id: to }, "return=minimal");
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

  // Accounts: Supabase is the source of truth; memory mirrors it so a login survives an outage.
  async upsertAccount(phone: string, device: string) {
    const a = await this.tryBoth("upsertAccount", (db) => db.upsertAccount(phone, device), () => this.mem.upsertAccount(phone, device));
    this.mem.adopt(a, device);
    return a;
  }
  async createSession(h: string, accountId: string, expiresAt: string) {
    await this.mem.createSession(h, accountId, expiresAt);
    await this.tryBoth("createSession", (db) => db.createSession(h, accountId, expiresAt), async () => {});
  }
  async getSession(h: string) {
    const remote = await this.tryBoth("getSession", (db) => db.getSession(h), async () => null);
    return remote ?? this.mem.getSession(h);
  }
  async deleteSession(h: string) {
    await this.mem.deleteSession(h);
    await this.tryBoth("deleteSession", (db) => db.deleteSession(h), async () => {});
  }
  /** Memory first, then Supabase. A Supabase failure is NOT swallowed: we must not say "deleted" when it is not. */
  async deleteAccount(accountId: string) {
    await this.mem.deleteAccount(accountId);
    if (this.primary) await this.primary.deleteAccount(accountId);
  }
  async mergeDevice(from: string, to: string) {
    await this.mem.mergeDevice(from, to);
    await this.tryBoth("mergeDevice", (db) => db.mergeDevice(from, to), async () => {});
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
