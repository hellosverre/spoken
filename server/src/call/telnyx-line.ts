// Real phone line: Telnyx Call Control dials out with a bidirectional PCMU media stream.
// Callee audio → local VAD (barge-in) + Scribe; agent text → ElevenLabs TTS → paced 20 ms frames.

import type { ServerWebSocket } from "bun";
import { config } from "../config.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ScribeStream } from "../voice/scribe.ts";
import { transcribeSegment } from "../voice/scribe-batch.ts";
import { tts } from "../voice/tts.ts";
import { alawToUlaw, g711ToPcm16, holdMusic, levelOf, pcmRms, typingSound, ulawRms, ULAW_SILENCE } from "../voice/ulaw.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";

const FRAME = 160; // 20 ms of µ-law at 8 kHz
const LEAD_MS = 120; // how far ahead of real time we send, to ride out jitter
// Call #5: 35 barge-ins, ~10 were laughs/noise. Now 200 ms of loud audio, and partials must be
// real words, not «mm»/«ja».
const BARGE_RMS = Number(process.env.BARGE_RMS ?? 1500);
const BARGE_FRAMES = 10;
const BACKCHANNEL_TEXT = /^(ja|jo|mm+|mhm|hm+|okei|ok|ja ja|aha|å|åh|eh|ehm|nei)[.!,]?$/i;
const VOICED_RMS = Number(process.env.VOICED_RMS ?? 600); // "callee is talking" for the STT timing

// Batch second opinion per segment (STT_BATCH=0 turns it off).
const STT_BATCH = process.env.STT_BATCH !== "0";
// Dev calls only, with the callee's consent: raw callee audio to .cache/calls (gitignored). Delete after use.
const SAVE_AUDIO = process.env.SAVE_CALL_AUDIO === "1";
const AUDIO_DIR = join(import.meta.dir, "../../.cache/calls");
if (SAVE_AUDIO) { try { mkdirSync(AUDIO_DIR, { recursive: true }); } catch { /* no dir */ } }

const lines = new Map<string, TelnyxLine>(); // by callId
const byControlId = new Map<string, TelnyxLine>();
const TYPING = typingSound(4);
const MUSIC = holdMusic(8);

export function lineForCall(callId: string) { return lines.get(callId); }

async function telnyx(path: string, body: object): Promise<any> {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.telnyx.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try { detail = JSON.parse(text).errors?.map((e: any) => `${e.title}: ${e.detail ?? ""}`).join("; ") || detail; } catch { /* raw */ }
    throw new Error(`Telnyx ${path} HTTP ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : {};
}

export interface TelnyxLineOpts {
  callId: string;
  to: string;
  voiceId?: string;
  keyterms: string[];
  /** Replay harness: no Telnyx dial/hangup; media is fed through attach()/onMedia(). */
  offline?: boolean;
}

export class TelnyxLine implements CallLine {
  readonly revises = STT_BATCH;
  private ev!: LineEvents;
  private controlId = "";
  private readonly token = crypto.randomUUID().replace(/-/g, "");
  private ws?: ServerWebSocket<any>;
  private scribe?: ScribeStream;
  private answered = false;
  private streaming = false;
  private connectedSent = false;
  private hungUp = false;

  // playback
  private chunks: Uint8Array[] = [];
  private chunkOff = 0;
  private producerDone = true;
  private clockStart = 0;
  private sentMs = 0;
  private ticker?: ReturnType<typeof setInterval>;
  private speakAbort?: AbortController;
  private speakResolve?: (r: { interrupted: boolean }) => void;
  private speakChain: Promise<unknown> = Promise.resolve();
  private waiting = false;
  private typingOff = 0;
  private waitKind: "typing" | "music" = "typing";
  private loudFrames = 0;
  private inBatch: Uint8Array[] = [];
  private inboundAlaw = false;
  private lastVoicedAt = 0;
  private lastPartialAt = 0;
  private lastCommittedNorm = "";
  // Last ~20 s of callee audio, for the batch second opinion on each segment.
  private recent: { at: number; pcm: Int16Array }[] = [];
  private segOnsetAt = 0;
  private audioStartAt = 0;
  private sayFramePending = false;
  private ttsChars = 0;
  private sttSamples = 0;
  private readonly sttFormat = (process.env.STT_INPUT || "pcm_8000") as "ulaw_8000" | "pcm_8000";
  private lastLevel = { callee: 0, agent: 0 };
  private lastLevelVal = { callee: 0, agent: 0 };

  /** ~15 Hz loudness while someone talks; one final 0 when they stop. */
  private emitLevel(who: "callee" | "agent", rms: number) {
    const now = Date.now();
    if (now - this.lastLevel[who] < 66) return;
    const v = Math.round(levelOf(rms) * 100) / 100;
    if (v < 0.04 && this.lastLevelVal[who] < 0.04) return;
    this.lastLevel[who] = now;
    this.lastLevelVal[who] = v;
    this.ev.level?.(who, v < 0.04 ? 0 : v);
  }
  private costReported = false;
  private billed = (n: number) => { this.ttsChars += n; };

  // latency
  private lastCommitAt = 0;
  private awaitingFirstAudio = false;
  private segId = 0;
  private committedIds = new Map<string, string>();

  constructor(private o: TelnyxLineOpts) {
    lines.set(o.callId, this);
  }

  silenceMs() { return this.lastVoicedAt ? Date.now() - this.lastVoicedAt : Infinity; }

  async start(events: LineEvents) {
    this.ev = events;
    if (this.o.offline) {
      this.answered = true;
      this.ev.status("ringing");
      return;
    }
    const { apiKey, connectionId, fromNumber } = config.telnyx;
    if (!apiKey || !connectionId || !fromNumber) throw new Error("TELNYX_API_KEY / TELNYX_CONNECTION_ID / TELNYX_FROM_NUMBER missing");
    const wsBase = config.publicUrl.replace(/^http/, "ws");
    const r = await telnyx("/calls", {
      connection_id: connectionId,
      to: this.o.to,
      from: fromNumber,
      timeout_secs: 40,
      time_limit_secs: config.maxCallSec,
      webhook_url: `${config.publicUrl}/telnyx/webhook`,
      client_state: Buffer.from(this.o.callId).toString("base64"),
      stream_url: `${wsBase}/telnyx/media?call=${this.o.callId}&t=${this.token}`,
      stream_track: "inbound_track",
      stream_bidirectional_mode: "rtp",
      stream_bidirectional_codec: "PCMU",
    });
    this.controlId = r.data?.call_control_id ?? "";
    if (this.controlId) byControlId.set(this.controlId, this);
    console.log(`[telnyx] dialing ${this.o.to.slice(0, -4)}xxxx call ${this.o.callId}`);
  }

  /** Warm the TTS cache while the phone rings, so the disclosure plays instantly. */
  prefetch(texts: string[]) {
    for (const t of texts) {
      void (async () => { try { for await (const _ of tts(t, { voiceId: this.o.voiceId, cache: true, onBilled: this.billed })) { /* drain */ } } catch (e) { console.warn("[tts] prefetch failed:", (e as Error).message); } })();
    }
  }

  // ---------- webhooks ----------

  static handleWebhook(body: any) {
    const data = body?.data;
    const type: string = data?.event_type ?? "";
    const p = data?.payload ?? {};
    let line = byControlId.get(p.call_control_id);
    if (!line && p.client_state) {
      try { line = lines.get(Buffer.from(p.client_state, "base64").toString()); } catch { /* bad state */ }
    }
    if (!line) return;
    if (!line.controlId && p.call_control_id) { line.controlId = p.call_control_id; byControlId.set(line.controlId, line); }
    line.onWebhook(type, p);
  }

  private onWebhook(type: string, p: any) {
    this.ev.debug?.("telnyx", { type, cause: p.hangup_cause, sip: p.sip_hangup_cause, source: p.hangup_source, reason: p.failure_reason });
    console.log(`[telnyx] ${type}${p.hangup_cause ? ` cause=${p.hangup_cause} sip=${p.sip_hangup_cause ?? ""} source=${p.hangup_source ?? "?"}` : ""}${p.failure_reason ? ` reason=${p.failure_reason}` : ""}`);
    switch (type) {
      case "call.initiated": this.ev.status("ringing"); break;
      case "call.answered":
        this.answered = true;
        this.maybeConnected();
        // No media socket = no audio: don't leave someone on a silent line.
        setTimeout(() => {
          if (!this.streaming && !this.hungUp) {
            this.ev.status("failed", "Lydstrømmen kom aldri fram (sjekk PUBLIC_URL / tunnelen).");
            void this.hangup();
          }
        }, 8000);
        break;
      case "streaming.failed": this.ev.status("failed", `Lydstrømmen feilet: ${p.failure_reason ?? "ukjent"}`); break;
      case "call.cost":
        console.log(`[cost] telnyx call ${this.o.callId}: ${p.total_cost ?? "?"} ${p.currency ?? ""} (${p.billed_duration_secs ?? "?"} s billed)`);
        this.ev.debug?.("telnyx_cost", { total: p.total_cost, currency: p.currency, billedSec: p.billed_duration_secs });
        break;
      case "call.hangup": {
        this.hungUp = true;
        if (this.answered) this.ev.ended("callee hung up");
        else {
          const cause = String(p.hangup_cause ?? "");
          const noAnswer = /timeout|no_answer|originator_cancel|user_busy/i.test(cause);
          this.ev.status(noAnswer ? "ended" : "failed", noAnswer ? "Ingen svarte." : `Samtalen ble avvist (${cause}${p.sip_hangup_cause ? `, SIP ${p.sip_hangup_cause}` : ""}).`);
        }
        this.cleanup();
        break;
      }
    }
  }

  private maybeConnected() {
    if (this.answered && this.streaming && !this.connectedSent) {
      this.connectedSent = true;
      this.ev.status("connected");
    }
  }

  // ---------- media websocket ----------

  static authorize(callId: string, token: string): TelnyxLine | undefined {
    const l = lines.get(callId);
    return l && l.token === token ? l : undefined;
  }

  attach(ws: ServerWebSocket<any>) {
    this.ws = ws;
    this.scribe = new ScribeStream({
      partial: (text) => {
        // Scribe can repeat the just-committed text as a partial; that is not new speech.
        const n = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
        if (n && this.lastCommittedNorm.startsWith(n) && Date.now() - this.lastCommitAt < 2000) return;
        this.lastPartialAt = Date.now();

        // Only real, current speech may barge in: late partials of the previous utterance
        // used to cut the agent off right as it started (replay, Sat 7 Nov).
        if (Date.now() - this.lastVoicedAt < 200 && !BACKCHANNEL_TEXT.test(text.trim())) this.ev.calleeSpeech();
        this.ev.calleePartial(`c_${this.segId}`, text);
      },
      committed: (text) => {
        const id = `c_${this.segId++}`;
        this.lastCommitAt = Date.now();
        this.awaitingFirstAudio = true;
        this.committedIds.set(text.trim(), id);
        this.lastCommittedNorm = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
        // Quiet speech can stay under the energy threshold; the last partial is a later bound.
        const speechEndAt = Math.max(this.lastVoicedAt, this.lastPartialAt) || undefined;
        this.ev.calleeFinal(id, text, undefined, { speechEndAt });
        // Window = voice onset → voice end (+ margins), not partial/commit times (both lag).
        const end = (this.lastVoicedAt || Date.now()) + 250;
        this.secondOpinion(id, text, (this.segOnsetAt || end - 4000) - 250, end);
        this.segOnsetAt = 0;
      },
      words: (text, words) => {
        const id = this.committedIds.get(text.trim());
        if (id) this.ev.calleeWords?.(id, text, words);
      },
      error: (msg) => console.error(`[scribe] ${msg}`),
    }, this.o.keyterms);
    this.scribe.connect();
    this.ticker = setInterval(() => this.tick(), 20);
  }

  onMedia(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.event) {
      case "start":
        this.streaming = true;
        this.inboundAlaw = m.start?.media_format?.encoding === "PCMA";
        console.log(`[telnyx] media start ${JSON.stringify(m.start?.media_format ?? {})}`);
        this.ev.debug?.("media_start", { format: m.start?.media_format });
        this.maybeConnected();
        break;
      case "media": {
        if (!m.media?.payload) return;
        const raw = new Uint8Array(Buffer.from(m.media.payload, "base64"));
        const pcm = g711ToPcm16(raw, this.inboundAlaw);
        const rms = pcmRms(pcm);
        if (rms > VOICED_RMS) {
          // Voice onset of the current segment = first voiced frame after the last commit.
          if (!this.segOnsetAt) this.segOnsetAt = Date.now();
          this.lastVoicedAt = Date.now();
        }
        this.localVad(rms);
        this.emitLevel("callee", rms);
        this.sttSamples += pcm.length;
        const now = Date.now();
        this.recent.push({ at: now, pcm });
        if (this.recent.length > 1000) this.recent.shift();
        if (SAVE_AUDIO) {
          if (!this.audioStartAt) this.audioStartAt = now;
          try { appendFileSync(join(AUDIO_DIR, `${this.o.callId}.pcm`), new Uint8Array(pcm.buffer)); } catch { /* best effort */ }
        }
        // Scribe gets linear PCM decoded once from G.711; µ-law mode kept for A/B (STT_INPUT=ulaw_8000).
        const buf = this.sttFormat === "ulaw_8000" ? (this.inboundAlaw ? alawToUlaw(raw) : raw) : new Uint8Array(pcm.buffer);
        this.inBatch.push(buf);
        if (this.inBatch.length >= 2) { // 40 ms per Scribe message
          const total = this.inBatch.reduce((a, b) => a + b.length, 0);
          const out = new Uint8Array(total);
          let o = 0;
          for (const b of this.inBatch) { out.set(b, o); o += b.length; }
          this.inBatch = [];
          this.scribe?.send(out);
        }
        break;
      }
      case "stop": this.cleanup(); break;
      case "error": console.error("[telnyx] media error", JSON.stringify(m.payload ?? m)); break;
    }
  }

  /** Re-transcribe the finished segment with batch Scribe; report it if it differs. */
  private secondOpinion(id: string, realtime: string, from: number, to: number) {
    const frames = this.recent.filter((f) => f.at >= from && f.at <= to);
    if (!frames.length) return;
    const pcm = new Int16Array(frames.reduce((n, f) => n + f.pcm.length, 0));
    let o = 0;
    for (const f of frames) { pcm.set(f.pcm, o); o += f.pcm.length; }
    const seg = { id, startMs: from - this.audioStartAt, endMs: to - this.audioStartAt, realtime };
    if (!STT_BATCH) { this.saveSegment({ ...seg }); return; }
    const t0 = Date.now();
    transcribeSegment(pcm, this.o.keyterms)
      .then((r) => {
        const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
        this.ev.debug?.("stt_batch", { id, realtime, batch: r.text, ms: Date.now() - t0 });
        this.saveSegment({ ...seg, batch: r.text, batchMs: Date.now() - t0 });
        // Only replace realtime when batch looks like the same utterance (guards bad windows).
        const n = (t: string) => norm(t).split(" ").filter(Boolean).length;
        // and must share at least one word ("I Storo." → "Bestill levering" on call #4 was the wrong window).
        const rw = new Set(norm(realtime).split(" "));
        const overlap = norm(r.text).split(" ").some((w) => w && rw.has(w));
        const plausible = overlap && n(r.text) >= Math.max(1, 0.6 * n(realtime)) && n(r.text) <= 1.6 * n(realtime) + 1;
        if (r.text && plausible && norm(r.text) !== norm(realtime)) this.ev.calleeRevised?.(id, r.text, r.words);
      })
      .catch((e) => console.warn("[scribe-batch]", (e as Error).message));
  }

  private saveSegment(s: Record<string, unknown>) {
    if (!SAVE_AUDIO) return;
    try { appendFileSync(join(AUDIO_DIR, `${this.o.callId}.segments.jsonl`), JSON.stringify(s) + "\n"); } catch { /* best effort */ }
  }

  private localVad(rms: number) {
    if (!this.speakResolve) { this.loudFrames = 0; return; }
    if (rms > BARGE_RMS) {
      if (++this.loudFrames === BARGE_FRAMES) { this.ev.debug?.("vad_loud", {}); this.ev.calleeSpeech(); }
    } else this.loudFrames = Math.max(0, this.loudFrames - 1);
  }

  // ---------- playback ----------

  private buffered() {
    let n = -this.chunkOff;
    for (const c of this.chunks) n += c.length;
    return n;
  }

  private takeFrame(): Uint8Array | null {
    const have = this.buffered();
    if (have <= 0 || (have < FRAME && !this.producerDone)) return null;
    const f = new Uint8Array(FRAME).fill(ULAW_SILENCE);
    let o = 0;
    while (o < FRAME && this.chunks.length) {
      const c = this.chunks[0]!;
      const n = Math.min(FRAME - o, c.length - this.chunkOff);
      f.set(c.subarray(this.chunkOff, this.chunkOff + n), o);
      o += n;
      this.chunkOff += n;
      if (this.chunkOff >= c.length) { this.chunks.shift(); this.chunkOff = 0; }
    }
    return f;
  }

  private sendFrame(f: Uint8Array) {
    if (!this.ws || this.hungUp) return;
    try { this.ws.send(JSON.stringify({ event: "media", media: { payload: Buffer.from(f).toString("base64") } })); } catch { /* socket gone */ }
  }

  private tick() {
    const now = Date.now();
    if (!this.clockStart) { this.clockStart = now; this.sentMs = 0; }
    const elapsed = now - this.clockStart;
    if (this.sentMs < elapsed - 40) { this.clockStart = now - this.sentMs; } // underrun: re-anchor
    while (this.sentMs <= now - this.clockStart + LEAD_MS) {
      let f = this.takeFrame();
      if (f && this.awaitingFirstAudio && this.lastCommitAt) {
        this.awaitingFirstAudio = false;
        console.log(`[latency] callee commit → agent audio: ${now - this.lastCommitAt} ms`);
        this.ev.debug?.("latency", { commitToAudioMs: now - this.lastCommitAt });
      }
      if (f && this.sayFramePending) {
        this.sayFramePending = false;
        this.ev.metric?.({ kind: "first_audio", at: now });
      }
      if (!f && this.waiting && !this.speakResolve) {
        const loop = this.waitKind === "music" ? MUSIC : TYPING;
        f = loop.subarray(this.typingOff, this.typingOff + FRAME);
        this.typingOff = (this.typingOff + FRAME) % (loop.length - FRAME);
      }
      if (!f) break;
      if (this.speakResolve) this.emitLevel("agent", ulawRms(f));
      this.sendFrame(f);
      this.sentMs += 20;
    }
    if (!this.speakResolve && this.lastLevelVal.agent >= 0.04) this.emitLevel("agent", 0);
    // Speech finished once everything is sent and has had time to play out.
    if (this.speakResolve && this.producerDone && this.buffered() <= 0 && now - this.clockStart >= this.sentMs) {
      const r = this.speakResolve;
      this.speakResolve = undefined;
      r({ interrupted: false });
    }
  }

  speak(text: string, kind: SpeakKind): Promise<{ interrupted: boolean }> {
    const run = () => this.speakNow(text, kind);
    const p = this.speakChain.then(run, run);
    this.speakChain = p.catch(() => {});
    return p;
  }

  private async speakNow(text: string, kind: SpeakKind): Promise<{ interrupted: boolean }> {
    if (this.hungUp || !this.ws) return { interrupted: true };
    const abort = new AbortController();
    this.speakAbort = abort;
    this.producerDone = false;
    this.sayFramePending = kind === "say";
    const done = new Promise<{ interrupted: boolean }>((resolve) => { this.speakResolve = resolve; });
    const t0 = Date.now();
    let first = true;
    try {
      for await (const chunk of tts(text, { voiceId: this.o.voiceId, signal: abort.signal, cache: kind === "filler" || text.length <= 40, onBilled: this.billed })) {
        if (abort.signal.aborted) break;
        if (first) {
          first = false;
          console.log(`[latency] tts first byte: ${Date.now() - t0} ms (${text.length} chars)`);
          this.ev.debug?.("tts", { firstByteMs: Date.now() - t0, chars: text.length, kind });
          if (kind === "say") this.ev.metric?.({ kind: "tts_first_byte", ms: Date.now() - t0 });
        }
        this.chunks.push(chunk);
      }
    } catch (e) {
      if (!abort.signal.aborted) console.error("[tts]", (e as Error).message);
    } finally {
      this.producerDone = true;
    }
    return done;
  }

  stopSpeaking() {
    this.speakAbort?.abort();
    this.chunks = [];
    this.chunkOff = 0;
    this.producerDone = true;
    if (this.ws) { try { this.ws.send(JSON.stringify({ event: "clear" })); } catch { /* gone */ } }
    const r = this.speakResolve;
    this.speakResolve = undefined;
    r?.({ interrupted: true });
  }

  startWaitingSound(kind: "typing" | "music" = "typing") {
    if (this.waitKind !== kind) this.typingOff = 0;
    this.waitKind = kind;
    this.waiting = true;
  }
  stopWaitingSound() {
    if (!this.waiting) return;
    this.waiting = false;
    if (!this.speakResolve && this.ws) { try { this.ws.send(JSON.stringify({ event: "clear" })); } catch { /* gone */ } }
  }

  async hangup() {
    if (!this.hungUp && this.controlId && !this.o.offline) {
      this.hungUp = true;
      try { await telnyx(`/calls/${encodeURIComponent(this.controlId)}/actions/hangup`, {}); }
      catch (e) { console.warn("[telnyx] hangup:", (e as Error).message); }
    }
    this.hungUp = true;
    this.cleanup();
  }

  private cleanup() {
    if (!this.costReported) {
      this.costReported = true;
      this.ev?.cost?.({ ttsChars: this.ttsChars, sttSec: Math.round(this.sttSamples / 8000) });
    }
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.stopSpeaking();
    this.scribe?.close();
    this.scribe = undefined;
    try { this.ws?.close(); } catch { /* closed */ }
    this.ws = undefined;
    setTimeout(() => { lines.delete(this.o.callId); if (this.controlId) byControlId.delete(this.controlId); }, 60_000);
  }

  onSocketClosed() {
    if (!this.hungUp) console.warn("[telnyx] media socket closed before hangup");
  }
}
