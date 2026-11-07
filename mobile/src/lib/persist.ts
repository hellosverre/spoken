/* Durable app state: what a restart (or web reload) must put back exactly as it was.
   Pure module (no React Native, no DOM) so it runs under bun test; the store hands it a
   storage (AsyncStorage on the phone, localStorage on the web). Same file shape on both.

   Privacy: the session token lives in its own key (account.ts) and is never in here.
   Transcript lines are only the ones the call screen already shows for the current/last call;
   older calls keep a one-line summary, at most RECENT_MAX. logout() clears the lot. */

import type { FactItem } from "../components/FactStrip";
import type { ReceiptData } from "../components/Receipt";
import type { SavedReal } from "./real-call";

export const PERSIST_VERSION = 1;
/** The version is in the key, so a bump never reads an old shape. */
export const PERSIST_KEY = `spoken-state-v${PERSIST_VERSION}`;
export const PERSIST_DELAY_MS = 300;
export const RECENT_MAX = 20;
/** Everything older than this is stale (the server keeps calls ~30 min; chat is worth a day). */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface StorageLike {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface RecentCall {
  callId: string | null;
  contact: string;
  title: string;
  ok: boolean;
  at: number;
}

/** Loose on purpose: store.ts owns the exact types, this only has to round-trip them as JSON. */
export interface Durable {
  v: number;
  savedAt: number;
  tab: string;
  screen: "home" | "call";
  scenario: string;
  real?: SavedReal;
  thread: unknown[];
  uid: number;
  draft: string;
  /** The server's id for the live or last call. */
  liveCallId: string | null;
  callStartedAt: number | null;
  transcript: unknown[];
  elapsed: string;
  pill: string;
  callEnded: boolean;
  chips: string[];
  holdSince: number | null;
  /** Only a result sheet; an approval is asked again by the server's replay. */
  result: unknown | null;
  receipt: ReceiptData | null;
  facts: FactItem[];
  recent: RecentCall[];
}

/** The slice of the store state that is durable (a structural type, so web's store fits too). */
export interface Source {
  tab: string;
  screen: string;
  scenario: string;
  thread: { kind: string }[];
  draft: string;
  liveCallId: string | null;
  callStartedAt: number | null;
  transcript: unknown[];
  elapsed: string;
  pill: string;
  callEnded: boolean;
  chips: string[];
  holdSince: number | null;
  sheet: { kind: string } | null;
  multi: unknown | null;
}

export interface Extras {
  uid: number;
  real?: SavedReal;
  receipt: ReceiptData | null;
  facts: FactItem[];
  recent: RecentCall[];
  now: number;
}

export function toDurable(s: Source, x: Extras): Durable {
  const inCall = s.screen === "call" && !s.multi;
  return {
    v: PERSIST_VERSION,
    savedAt: x.now,
    tab: s.tab,
    // A multi-call view would start new calls when restored, so it falls back to home.
    screen: inCall ? "call" : "home",
    scenario: s.scenario,
    ...(x.real ? { real: x.real } : {}),
    thread: s.thread.filter((i) => i.kind !== "dots"),
    uid: x.uid,
    draft: s.draft,
    liveCallId: s.liveCallId,
    callStartedAt: s.callStartedAt,
    transcript: s.transcript,
    elapsed: s.elapsed,
    pill: s.pill,
    callEnded: s.callEnded,
    chips: s.chips,
    holdSince: s.holdSince,
    result: s.sheet?.kind === "result" ? s.sheet : null,
    receipt: x.receipt,
    facts: x.facts,
    recent: x.recent.slice(-RECENT_MAX),
  };
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

/** Parse stored JSON; null when it is missing, corrupt, another version or too old. */
export function parseDurable(raw: string | null | undefined, now: number): Durable | null {
  if (!raw) return null;
  let d: Partial<Durable>;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object" || d.v !== PERSIST_VERSION) return null;
  if (typeof d.savedAt !== "number" || now - d.savedAt > MAX_AGE_MS) return null;
  if (!isArr(d.thread) || !isArr(d.transcript) || typeof d.uid !== "number") return null;
  return {
    v: PERSIST_VERSION,
    savedAt: d.savedAt,
    tab: typeof d.tab === "string" ? d.tab : "home",
    screen: d.screen === "call" ? "call" : "home",
    scenario: typeof d.scenario === "string" ? d.scenario : "pizza",
    ...(d.real && typeof d.real.taskId === "string" ? { real: d.real } : {}),
    thread: d.thread,
    uid: d.uid,
    draft: typeof d.draft === "string" ? d.draft : "",
    liveCallId: typeof d.liveCallId === "string" ? d.liveCallId : null,
    callStartedAt: typeof d.callStartedAt === "number" ? d.callStartedAt : null,
    transcript: d.transcript,
    elapsed: typeof d.elapsed === "string" ? d.elapsed : "0:00",
    pill: typeof d.pill === "string" ? d.pill : "ended",
    callEnded: d.callEnded === true,
    chips: isArr(d.chips) ? (d.chips as string[]) : [],
    holdSince: typeof d.holdSince === "number" ? d.holdSince : null,
    result: d.result ?? null,
    receipt: d.receipt ?? null,
    facts: isArr(d.facts) ? (d.facts as FactItem[]) : [],
    recent: isArr(d.recent) ? (d.recent as RecentCall[]).slice(-RECENT_MAX) : [],
  };
}

/**
 * Debounced saver. `schedule(get)` can be called on every state change; one write goes out
 * 300 ms after the first call, always with the newest state (so a typing animation still saves). `flush()` writes now (app
 * going to the background); `clear()` is logout: it cancels pending writes and deletes the key.
 */
export function createPersister(storage: StorageLike, delay = PERSIST_DELAY_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: (() => Durable) | null = null;
  let cleared = 0;

  const write = async () => {
    timer = undefined;
    if (!latest) return;
    const gen = cleared;
    try {
      const raw = JSON.stringify(latest());
      latest = null;
      if (gen === cleared) await storage.setItem(PERSIST_KEY, raw);
    } catch (e) {
      console.warn("spoken: could not save state", e);
    }
  };

  return {
    schedule(get: () => Durable) {
      latest = get;
      if (timer === undefined) timer = setTimeout(write, delay);
    },
    flush: write,
    async load(now = Date.now()): Promise<Durable | null> {
      try {
        const d = parseDurable(await storage.getItem(PERSIST_KEY), now);
        if (!d) await storage.removeItem(PERSIST_KEY); // old version or corrupt: don't keep it
        return d;
      } catch {
        return null;
      }
    },
    async clear() {
      cleared++;
      latest = null;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      try {
        await storage.removeItem(PERSIST_KEY);
      } catch {}
    },
  };
}
