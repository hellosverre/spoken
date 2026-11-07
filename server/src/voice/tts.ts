// ElevenLabs TTS over HTTP streaming, straight to µ-law 8 kHz for the phone line.
// Short repeated phrases are cached on disk: the free tier only has 10k characters.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.ts";
import { elKey, elKeyFailed, elOnFallback } from "./el-key.ts";
import { forgetPronunciation, pronunciationLocators, type Locator } from "./pronunciation.ts";
import { toSpeakable } from "./speakable.ts";

const CACHE_DIR = join(import.meta.dir, "../../.cache/tts");
try { mkdirSync(CACHE_DIR, { recursive: true }); } catch { /* read-only fs: no cache */ }

// Calm and clear on a phone line: slower than default, steady delivery (Sverre, call #1).
// Single source for the speed: TTS_SPEED (Flash voice_settings.speed). v4 has no speed setting: it gets an audio tag.
export const TTS_SPEED = Number(process.env.TTS_SPEED ?? 0.88);
const TTS_STABILITY = Number(process.env.TTS_STABILITY ?? 0.7);

export const FLASH_MODEL = "eleven_flash_v2_5";
export const V4_MODEL = "eleven_v4_turbo";
/** v4 is steered with an audio tag in the text; it is never part of the transcript the caller shows. */
const v4Tag = () => process.env.TTS_V4_TAG ?? "[calm]";
/** Default model is v4 Turbo; TTS_MODEL=eleven_flash_v2_5 selects Flash. */
const defaultModel = () => process.env.TTS_MODEL || V4_MODEL;
const isV4 = (model: string) => model.startsWith("eleven_v4");

/** Premade voice every key can use. */
const FALLBACK_VOICE = "nPczCjzI2devNBz1zQrb";

const memCache = new Map<string, Uint8Array>();
/** Last text spoken per turn, so the next sentence of the same turn is stitched to it (previous_text). */
const turnTail = new Map<string, string>();

function cacheKey(text: string, voiceId: string, model: string, extra = "") {
  const style = isV4(model) ? `tag=${v4Tag()}` : `speed=${TTS_SPEED}|stab=${TTS_STABILITY}`;
  return new Bun.CryptoHasher("sha1").update(`${model}|${voiceId}|${style}|${extra}|${text}`).digest("hex");
}

export interface TtsOptions {
  voiceId?: string;
  model?: string;
  signal?: AbortSignal;
  /** Cache this phrase (fixed lines, disclosure). */
  cache?: boolean;
  /** Output format; the phone path uses µ-law 8 kHz. */
  format?: "ulaw_8000" | "pcm_16000";
  /** Language spoken (default Norwegian). */
  lang?: string;
  /** Called with the billed character count when a real (uncached) request is made. */
  onBilled?: (chars: number) => void;
  /** Sentences of one agent turn share an id: each is stitched to the previous one for smooth prosody (Flash). */
  turn?: string;
  /** Explicit stitching context (Flash only; v4 ignores it). */
  previousText?: string;
  nextText?: string;
}

/** Yields µ-law chunks as they arrive. Throws on HTTP errors or a 6 s first-byte timeout. */
export async function* tts(text: string, opts: TtsOptions = {}): AsyncGenerator<Uint8Array> {
  let model = opts.model || defaultModel();
  // The free fallback key may not have v4: Flash there.
  if (isV4(model) && elOnFallback()) model = FLASH_MODEL;
  let yielded = false;
  try {
    for await (const c of ttsOnce(text, opts, model)) { yielded = true; yield c; }
  } catch (e) {
    // v4 request failed before any audio: say it with Flash instead. A barge-in abort is not a failure.
    if (isV4(model) && !yielded && !opts.signal?.aborted) {
      console.warn(`[tts] ${model} failed (${(e as Error).message}); falling back to Flash`);
      yield* ttsOnce(text, opts, FLASH_MODEL);
      return;
    }
    throw e;
  }
}

/** Request body and URL for a model: Flash = text-to-speech/stream, v4 = text-to-dialogue/stream. Exported for tests. */
export function buildRequest(speakable: string, o: {
  model: string; voiceId: string; lang: string; format: string;
  previousText?: string; nextText?: string; locators?: Locator[];
}): { url: string; body: Record<string, unknown> } {
  if (isV4(o.model)) {
    const tag = v4Tag();
    return {
      url: `https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=${o.format}`,
      body: {
        inputs: [{ text: tag ? `${tag} ${speakable}` : speakable, voice_id: o.voiceId }],
        model_id: o.model,
        language_code: o.lang,
        ...(o.locators ? { pronunciation_dictionary_locators: o.locators } : {}),
      },
    };
  }
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${o.voiceId}/stream?output_format=${o.format}`,
    body: {
      text: speakable,
      model_id: o.model,
      language_code: o.lang,
      // Slow and clear for phone lines (SPEC). Style 0 and no speaker boost keep latency down.
      voice_settings: { stability: TTS_STABILITY, similarity_boost: 0.75, style: 0, use_speaker_boost: false, speed: TTS_SPEED },
      ...(o.previousText ? { previous_text: o.previousText } : {}),
      ...(o.nextText ? { next_text: o.nextText } : {}),
      ...(o.locators ? { pronunciation_dictionary_locators: o.locators } : {}),
    },
  };
}

async function* ttsOnce(text: string, opts: TtsOptions, model: string): AsyncGenerator<Uint8Array> {
  const voiceId = opts.voiceId || config.elevenlabs.defaultVoice;
  const lang = opts.lang ?? "no";
  const speakable = toSpeakable(text, lang);
  const format = opts.format ?? "ulaw_8000";
  const v4 = isV4(model);
  const previousText = v4 ? undefined : (opts.previousText ?? (opts.turn ? turnTail.get(opts.turn) : undefined))?.slice(-200);
  const nextText = v4 ? undefined : opts.nextText?.slice(0, 200);
  const locators = lang === "no" ? pronunciationLocators() : undefined;
  const stitch = previousText || nextText ? `${previousText ?? ""}\u0000${nextText ?? ""}` : "";
  const key = cacheKey(speakable, voiceId, model, (locators ? "pls" : "") + stitch) + (format === "ulaw_8000" ? "" : `-${format}`) + (lang === "no" ? "" : `-${lang}`);
  if (opts.turn) {
    if (turnTail.size > 200) turnTail.clear();
    turnTail.set(opts.turn, speakable);
  }
  const cached = memCache.get(key) ?? (await readDisk(key));
  if (cached) { memCache.set(key, cached); yield cached; return; }

  if (!elKey()) throw new Error("ELEVENLABS_API_KEY missing");
  const firstByte = new AbortController();
  const timer = setTimeout(() => firstByte.abort(), 6000);
  const signal = opts.signal ? AbortSignal.any([opts.signal, firstByte.signal]) : firstByte.signal;
  const req = buildRequest(speakable, { model, voiceId, lang, format, previousText, nextText, locators });
  const res = await fetch(req.url, {
    method: "POST",
    headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
    body: JSON.stringify(req.body),
    signal,
  });
  if (res.ok) opts.onBilled?.(speakable.length);
  if (!res.ok) {
    clearTimeout(timer);
    const body = await res.text();
    if (elKeyFailed(res.status, body)) { yield* ttsOnce(text, opts, isV4(model) ? FLASH_MODEL : model); return; }
    // The free fallback key can't use the library voices added to the main account: say it in Brian.
    if (elOnFallback() && voiceId !== FALLBACK_VOICE && /voice_not_found/i.test(body)) {
      yield* ttsOnce(text, { ...opts, voiceId: FALLBACK_VOICE }, model); return;
    }
    // A dictionary that was deleted or has a stale version must not take speech down with it.
    if (locators && /pronunciation/i.test(body)) { forgetPronunciation(); yield* ttsOnce(text, opts, model); return; }
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
