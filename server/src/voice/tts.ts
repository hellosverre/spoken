// ElevenLabs TTS over HTTP streaming, straight to µ-law 8 kHz for the phone line.
// Short repeated phrases are cached on disk: the free tier only has 10k characters.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { elKey, elKeyFailed, elOnFallback } from "./el-key.ts";
import { toSpeakable } from "./speakable.ts";

const CACHE_DIR = join(import.meta.dir, "../../.cache/tts");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* read-only fs: no cache */ }

// Calm and clear on a phone line: slower than default, steady delivery (Sverre, call #1).
const TTS_SPEED = Number(process.env.TTS_SPEED ?? 0.88);
const TTS_STABILITY = Number(process.env.TTS_STABILITY ?? 0.7);

/** Premade voice every key can use. */
const FALLBACK_VOICE = "nPczCjzI2devNBz1zQrb";

const memCache = new Map<string, Uint8Array>();

function cacheKey(text: string, voiceId: string, model: string) {
  return new Bun.CryptoHasher("sha1").update(`${model}|${voiceId}|${TTS_SPEED}|${TTS_STABILITY}|${text}`).digest("hex");
}

export interface TtsOptions {
  voiceId?: string;
  model?: string;
  signal?: AbortSignal;
  /** Cache this phrase (fixed lines, disclosure). */
  cache?: boolean;
  /** Output format; the phone path uses µ-law 8 kHz. */
  format?: "ulaw_8000" | "pcm_16000";
  /** Language spoken (default Norwegian). English text is sent as is, without number spelling. */
  lang?: "no" | "en";
  /** Called with the billed character count when a real (uncached) request is made. */
  onBilled?: (chars: number) => void;
}

/** Yields µ-law chunks as they arrive. Throws on HTTP errors or a 6 s first-byte timeout. */
export async function* tts(text: string, opts: TtsOptions = {}): AsyncGenerator<Uint8Array> {
  const voiceId = opts.voiceId || config.elevenlabs.defaultVoice;
  const model = opts.model || config.elevenlabs.ttsModel;
  const lang = opts.lang ?? "no";
  const speakable = lang === "no" ? toSpeakable(text) : text;
  const format = opts.format ?? "ulaw_8000";
  const key = cacheKey(speakable, voiceId, model) + (format === "ulaw_8000" ? "" : `-${format}`) + (lang === "no" ? "" : `-${lang}`);
  const cached = memCache.get(key) ?? (await readDisk(key));
  if (cached) { memCache.set(key, cached); yield cached; return; }

  if (!elKey()) throw new Error("ELEVENLABS_API_KEY missing");
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(), 6000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, firstByte.signal]) : firstByte.signal;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=${format}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text: speakable,
      model_id: model,
      language_code: lang,
      // A bit slow and clear for phone lines (SPEC).
      voice_settings: { stability: TTS_STABILITY, similarity_boost: 0.75, style: 0, speed: TTS_SPEED },
    }),
    signal,
  });
  if (res.ok) opts.onBilled?.(speakable.length);
  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text();
    if (elKeyFailed(res.status, body)) { yield* tts(text, opts); return; }
    // The free fallback key can't use the library voices added to the main account: say it in Brian.
    if (elOnFallback() && voiceId !== FALLBACK_VOICE && /voice_not_found/i.test(body)) {
      yield* tts(text, { ...opts, voiceId: FALLBACK_VOICE }); return;
    }
    throw new Error(`ElevenLabs TTS HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const reader = res.body!.getReader();
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      clearTimeout(timer);
      if (done) break;
      if (value?.length) { parts.push(value); yield value; }
    }
  } finally {
    clearTimeout(timer);
  }
  if (opts.cache && !opts.signal?.aborted) {
    const all = concat(parts);
    memCache.set(key, all);
    void Bun.write(join(CACHE_DIR, key + ".ulaw"), all).catch(() => {});
  }
}

async function readDisk(key: string): Promise<Uint8Array | undefined> {
  const f = Bun.file(join(CACHE_DIR, key + ".ulaw"));
  if (!(await f.exists())) return undefined;
  return new Uint8Array(await f.arrayBuffer());
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
