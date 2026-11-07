// ElevenLabs Scribe v2 Realtime: callee audio (µ-law 8 kHz) in, Norwegian partial and
// committed transcripts out. VAD commits segments; word logprobs become confidences.

import type { Word } from "../../../shared/contract.ts";
import { config } from "../config.ts";

export interface ScribeHandlers {
  partial(text: string): void;
  committed(text: string): void;
  words(text: string, words: Word[]): void;
  error(msg: string): void;
}

/**
 * Scribe word logprobs sit around -0.4…-0.9 even for correct words, so exp() greys out
 * everything. Linear map measured on Norwegian phone audio: -0.4 → 0.84, -1.0 → 0.6, -1.3 → 0.48.
 */
export function logprobToConfidence(lp: number): number {
  return Math.max(0, Math.min(1, 1 + lp / 2.5));
}

export class ScribeStream {
  private ws?: WebSocket;
  private queue: string[] = [];
  private open = false;
  private closed = false;
  private retries = 0;
  private sentFirst = false;

  constructor(private h: ScribeHandlers, private keyterms: string[] = [], private previousText = "") {}

  connect() {
    if (!config.elevenlabs.apiKey) { this.h.error("ELEVENLABS_API_KEY missing"); return; }
    const q = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "ulaw_8000",
      language_code: "no",
      commit_strategy: "vad",
      vad_silence_threshold_secs: process.env.SCRIBE_SILENCE_SECS ?? "0.5",
      include_timestamps: "true",
    });
    for (const k of this.keyterms.slice(0, 20)) q.append("keyterms", k);
    // Bun's WebSocket accepts headers, so the key never goes into the URL.
    const ws = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${q}`, {
      headers: { "xi-api-key": config.elevenlabs.apiKey },
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
      case "session_started": this.retries = 0; break;
      case "partial_transcript": if (m.text) this.h.partial(m.text); break;
      case "committed_transcript": if (m.text?.trim()) this.h.committed(m.text); break;
      case "committed_transcript_with_timestamps": {
        const words: Word[] = (m.words ?? [])
          .filter((w: any) => w.type !== "spacing" && w.text?.trim())
          .map((w: any) => ({ text: w.text, confidence: typeof w.logprob === "number" ? logprobToConfidence(w.logprob) : 1 }));
        if (m.text?.trim() && words.length) this.h.words(m.text, words);
        break;
      }
      default:
        if (m.error || /error|limit|exceeded/i.test(m.message_type ?? "")) this.h.error(`${m.message_type}: ${m.error ?? ""}`);
    }
  }

  /** Raw µ-law bytes from the call. */
  send(ulaw: Uint8Array) {
    const msg: Record<string, unknown> = {
      message_type: "input_audio_chunk",
      audio_base_64: Buffer.from(ulaw).toString("base64"),
      commit: false,
      sample_rate: 8000,
    };
    if (!this.sentFirst && this.previousText) msg.previous_text = this.previousText.slice(0, 500);
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
