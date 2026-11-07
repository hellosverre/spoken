// One ElevenLabs pronunciation dictionary (alias rules) for names Flash/v4 get wrong in Norwegian:
// created through the API when missing, id cached on disk and in memory, passed to TTS as a locator.
// Never blocks anything: until the id is known, TTS simply goes without it.

import { mkdirSync, unlink } from "node:fs";
import { join } from "node:path";
import { elKey } from "./el-key.ts";

export interface Locator { pronunciation_dictionary_id: string; version_id: string }
interface Rule { string_to_replace: string; type: "alias"; alias: string; case_sensitive?: boolean }

const alias = (s: string, a: string, case_sensitive = true): Rule => ({ string_to_replace: s, type: "alias", alias: a, case_sensitive });

/** Norwegian-facing rules; aliases are respellings the Norwegian voice reads right. */
export const RULES: Rule[] = [
  alias("Spoken", "Spouken"),
  alias("Grünerløkka", "Grynerløkka"),
  alias("Grunerløkka", "Grynerløkka"),
  alias("Langhus", "Lang-hus"),
  alias("Ski", "Sji"),
  alias("Vinterbro", "Vinter-bro"),
  alias("KI", "kå i"),
  alias("NAV", "Nav"),
  alias("BankID", "bank i de"),
  alias("OBOS", "Obos"),
  alias("DNB", "de en be"),
  alias("SMS", "ess em ess"),
  alias("AS", "a ess"),
  alias("Majorstuen", "Majorstua"),
];

function hash(s: string): string {
  return new Bun.CryptoHasher("sha1").update(s).digest("hex").slice(0, 8);
}
/** Name carries the rules hash so editing RULES makes a fresh dictionary instead of a stale one. */
export const DICT_NAME = `spoken-no-${hash(JSON.stringify(RULES))}`;

const API = "https://api.elevenlabs.io/v1/pronunciation-dictionaries";
const CACHE_DIR = join(import.meta.dir, "../../.cache");
const CACHE_FILE = join(CACHE_DIR, "pronunciation.json");

let locator: Locator | undefined;
let inflight: Promise<Locator | undefined> | undefined;
let retryAt = 0;

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

async function api(fetchFn: FetchFn, url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetchFn(url, {
    ...init,
    headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return res.json();
}

async function resolve(fetchFn: FetchFn, useDisk: boolean): Promise<Locator> {
  const cached = useDisk ? await Bun.file(CACHE_FILE).json().catch(() => undefined) as { name?: string; id?: string; version_id?: string } | undefined : undefined;
  if (cached?.name === DICT_NAME && cached.id && cached.version_id) return { pronunciation_dictionary_id: cached.id, version_id: cached.version_id };

  const list = await api(fetchFn, `${API}?page_size=100`);
  const found = (list.pronunciation_dictionaries ?? []).find((d: any) => d.name === DICT_NAME && !d.archived_time_unix);
  const made = found
    ? { id: found.id, version_id: found.latest_version_id }
    : await api(fetchFn, `${API}/add-from-rules`, {
        method: "POST",
        body: JSON.stringify({ name: DICT_NAME, description: "Spoken: Norwegian names and abbreviations", rules: RULES }),
      });
  const out: Locator = { pronunciation_dictionary_id: made.id, version_id: made.version_id };
  try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* read-only fs */ }
  if (useDisk) void Bun.write(CACHE_FILE, JSON.stringify({ name: DICT_NAME, id: out.pronunciation_dictionary_id, version_id: out.version_id })).catch(() => {});
  return out;
}

/** Find or create the dictionary. Resolves to undefined (never throws) when ElevenLabs is unreachable. */
export function ensurePronunciation(fetchFn: FetchFn = fetch, useDisk = true): Promise<Locator | undefined> {
  if (locator) return Promise.resolve(locator);
  if (!elKey()) return Promise.resolve(undefined);
  if (inflight) return inflight;
  if (Date.now() < retryAt) return Promise.resolve(undefined);
  inflight = resolve(fetchFn, useDisk)
    .then((l) => { locator = l; return l; })
    .catch((e) => { retryAt = Date.now() + 60_000; console.warn("[pronunciation] dictionary unavailable:", (e as Error).message); return undefined; })
    .finally(() => { inflight = undefined; });
  return inflight;
}

let started = false;
/** Call once at server start: looks the dictionary up (or creates it) in the background; never throws or blocks. */
export function initPronunciation() {
  started = true;
  void ensurePronunciation();
}

/** Locators for a TTS request, synchronously. Retries the lookup in the background (rate-limited) once started. */
export function pronunciationLocators(): Locator[] | undefined {
  if (locator) return [locator];
  if (started) void ensurePronunciation();
  return undefined;
}

/** The dictionary was rejected by TTS (deleted, wrong version): forget it and look again later. */
export function forgetPronunciation() {
  locator = undefined;
  retryAt = Date.now() + 60_000;
  unlink(CACHE_FILE, () => {});
}

export function _resetPronunciationForTest() { locator = undefined; inflight = undefined; retryAt = 0; }
