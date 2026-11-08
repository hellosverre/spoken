// ElevenLabs Scribe v2 Realtime: callee audio (µ-law 8 kHz) in, partial and committed
// transcripts out, in the call's language. VAD commits segments; word logprobs become confidences.

import type { Lang, Word } from "../../../shared/contract.ts";
import { elKey, elKeyFailed } from "./el-key.ts";

export interface ScribeHandlers {
  partial(text: string): void;
  committed(text: string): void;
  words(text: string, words: Word[]): void;
  /** Scribe's own language detection for the committed segment (ISO code, e.g. «no», «en»). Arrives just after committed(). */
  language?(code: string, text: string): void;
  /** Entities Scribe found in a committed segment (needs entity_detection). */
  entities?(text: string, entities: ScribeEntity[]): void;
  error(msg: string): void;
}

/**
 * Scribe word logprobs sit around -0.4…-0.9 even for correct words, so exp() greys out
 * everything. Linear map measured on Norwegian phone audio: -0.4 → 0.84, -1.0 → 0.6, -1.3 → 0.48.
 */
export function logprobToConfidence(lp: number): number {
  return Math.max(0, Math.min(1, 1 + lp / 2.5));
}

export interface ScribeEntity { text: string; entity_type: string; start_char: number; end_char: number }

/**
 * Languages Scribe may detect besides the call's own; en + no always, plus SCRIBE_SECONDARY (csv).
 * Exported for tests.
 */
export function secondaryLanguages(lang: string): string[] {
  const extra = (process.env.SCRIBE_SECONDARY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return [...new Set(["en", "no", ...extra])].filter((l) => l !== lang);
}

export type ScribeFormat = "ulaw_8000" | "pcm_8000" | "pcm_16000";

export class ScribeStream {
  private ws?: WebSocket;
  private queue: string[] = [];
  private open = false;
  private closed = false;
  private retries = 0;
  private sentFirst = false;
  private started = false;
  /** Set when a socket closed before session_started: drop the optional params and retry plain. */
  private plain = false;

  constructor(
    private h: ScribeHandlers,
    private keyterms: string[] = [],
    private previousText = "",
    /** pcm_8000 = 16-bit linear decoded straight from the phone's G.711 (best accuracy). */
    private format: ScribeFormat = (process.env.STT_INPUT as ScribeFormat) || "pcm_8000",
    private lang: Lang = "no",
    /** Extra query params (repeated per array item); a hook for features that need more Scribe options. */
    private extraParams: Record<string, string | string[]> = {},
  ) {}

  /** The call switched language: reconnect with the new language_code (audio queues meanwhile). */
  setLang(lang: Lang) {
    if (lang === this.lang || this.closed) return;
    this.lang = lang;
    const old = this.ws;
    this.ws = undefined;
    this.open = false;
    this.retries = 0;
    this.sentFirst = false;
    this.plain = false;
    if (old) { old.onclose = null; try { old.close(); } catch { /* closed */ } }
    this.connect();
  }

  connect() {
    if (!elKey()) { this.h.error("ELEVENLABS_API_KEY missing"); return; }
    const q = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: this.format,
      commit_strategy: "vad",
      // Short window for fast turns; CallSession holds the turn if the text sounds unfinished.
      vad_silence_threshold_secs: process.env.SCRIBE_SILENCE_SECS ?? "0.5",
      include_timestamps: "true",
    });
    // Norwegian/English keep the explicit code (best accuracy). Other languages, and SCRIBE_AUTO_LANG=1,
    // let Scribe auto-detect.
    if ((this.lang === "no" || this.lang === "en") && process.env.SCRIBE_AUTO_LANG !== "1") q.set("language_code", this.lang);
    for (const k of this.keyterms.slice(0, 20)) q.append("keyterms", k);
    // Language detection is the primary signal for call/langswitch. filter_background_audio is NOT set:
    // it cannot be combined with include_timestamps, which we need for per-word confidences.
    // no_verbatim stays off: «eh» is used for turn-taking.
    if (!this.plain) {
      q.set("include_language_detection", "true");
      for (const l of secondaryLanguages(this.lang)) q.append("secondary_languages", l);
      for (const [k, v] of Object.entries(this.extraParams)) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
      if (this.h.entities) q.set("entity_detection", "all");
    }
    this.started = false;
    // Bun's WebSocket accepts headers, so the key never goes into the URL.
    const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`, {
      headers: { "xi-api-key": elKey() },
    } as any);
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => this.onMessage(String(e.data));
    ws.onerror = () => this.h.error("Scribe socket error");
    ws.onclose = (e) => {
      this.open = false;
      if (this.closed) return;
      if (!this.started && !this.plain) { this.plain = true; console.warn("[scribe] closed before start; retrying without optional params"); }
      if (this.retries++ < 2) {
        console.warn(`[scribe] closed (${e.code} ${e.reason}); reconnecting`);
        this.sentFirst = false;
        setTimeout(() => this.connect(), 300);
      } else this.h.error(`Scribe closed: ${e.code} ${e.reason}`);
    };
  }

  private onMessage(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.message_type) {
      case "session_started": this.retries = 0; this.started = true; break;
      case "partial_transcript": if (m.text) this.h.partial(m.text); break;
      case "committed_transcript": if (m.text?.trim()) this.h.committed(m.text); break;
      case "committed_transcript_entities":
        if (Array.isArray(m.entities)) this.h.entities?.(m.text ?? "", m.entities);
        break;
      case "final_transcript_with_timestamps":
      case "committed_transcript_with_timestamps": {
        if (typeof m.language_code === "string" && m.language_code && m.text?.trim()) this.h.language?.(m.language_code, m.text);
        const words: Word[] = (m.words ?? [])
          .filter((w: any) => w.type !== "spacing" && w.text?.trim())
          .map((w: any) => ({ text: w.text, confidence: typeof w.logprob === "number" ? logprobToConfidence(w.logprob) : 1 }));
        if (m.text?.trim() && words.length) this.h.words(m.text, words);
        break;
      }
      default:
        if (m.error || /error|limit|exceeded/i.test(m.message_type ?? "")) {
          // Auth/quota on the primary key: the next reconnect uses the fallback key.
          if (/auth|quota/i.test(m.message_type ?? "") && elKeyFailed(401, String(m.message_type))) { this.retries = 0; try { this.ws?.close(); } catch { /* closed */ } }
          this.h.error(`${m.message_type}: ${m.error ?? ""}`);
        }
    }
  }

  /** Raw µ-law bytes from the call. */
  /** Encoded audio in the stream's format (µ-law bytes, or little-endian 16-bit PCM). */
  /** commit=true asks Scribe to finalise the segment now (our own VAD saw the speaker stop). */
  send(audio: Uint8Array, commit = false) {
    const msg: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength).toString("base64"),
      commit,
      sample_rate: this.format === "pcm_16000" ? 16000 : 8000,
    };
    if (!this.sentFirst && this.previousText) msg.previous_text = this.previousText.slice(-50) /* API max 50 chars */;
    this.sentFirst = true;
    const s = JSON.stringify(msg);
    if (this.open && this.ws?.readyState === WebSocket.OPEN) this.ws.send(s);
    else if (this.queue.length < 100) this.queue.push(s); // ~2–4 s of audio while connecting
  }

  close() {
    this.closed = true;
    try { this.ws?.close(); } catch { /* already closed */ }
  }
}
