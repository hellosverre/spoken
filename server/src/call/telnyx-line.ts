// Real phone line: Telnyx Call Control dials out with a bidirectional PCMU media stream.
// Callee audio → local VAD (barge-in) + Scribe; agent text → ElevenLabs TTS → paced 20 ms frames.

import type { ServerWebSocket } from "bun";
import { config } from "../config.ts";
import { ScribeStream } from "../voice/scribe.ts";
import { tts } from "../voice/tts.ts";
import { alawToUlaw, typingSound, ulawRms, ULAW_SILENCE } from "../voice/ulaw.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";

const FRAME = 160; // 20 ms of µ-law at 8 kHz
const LEAD_MS = 120; // how far ahead of real time we send, to ride out jitter
const BARGE_RMS = Number(process.env.BARGE_RMS ?? 1100);
const BARGE_FRAMES = 5; // 100 ms of loud audio while we talk = barge-in

const lines = new Map<string, TelnyxLine>(); // by callId
const byControlId = new Map<string, TelnyxLine>();
const TYPING = typingSound(4);

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
}

export class TelnyxLine implements CallLine {
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
  private loudFrames = 0;
  private inBatch: Uint8Array[] = [];
  private inboundAlaw = false;

  // latency
  private lastCommitAt = 0;
  private awaitingFirstAudio = false;
  private segId = 0;
  private committedIds = new Map<string, string>();

  constructor(private o: TelnyxLineOpts) {
    lines.set(o.callId, this);
  }

  async start(events: LineEvents) {
    this.ev = events;
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
      void (async () => { try { for await (const _ of tts(t, { voiceId: this.o.voiceId, cache: true })) { /* drain */ } } catch (e) { console.warn("[tts] prefetch failed:", (e as Error).message); } })();
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
        this.ev.calleeSpeech();
        this.ev.calleePartial(`c_${this.segId}`, text);
      },
      committed: (text) => {
        const id = `c_${this.segId++}`;
        this.lastCommitAt = Date.now();
        this.awaitingFirstAudio = true;
        this.committedIds.set(text.trim(), id);
        this.ev.calleeFinal(id, text);
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
        this.maybeConnected();
        break;
      case "media": {
        if (!m.media?.payload) return;
        const raw = new Uint8Array(Buffer.from(m.media.payload, "base64"));
        const buf = this.inboundAlaw ? alawToUlaw(raw) : raw;
        this.localVad(buf);
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

  private localVad(buf: Uint8Array) {
    if (!this.speakResolve) { this.loudFrames = 0; return; }
    if (ulawRms(buf) > BARGE_RMS) {
      if (++this.loudFrames === BARGE_FRAMES) this.ev.calleeSpeech();
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
      }
      if (!f && this.waiting && !this.speakResolve) {
        f = TYPING.subarray(this.typingOff, this.typingOff + FRAME);
        this.typingOff = (this.typingOff + FRAME) % (TYPING.length - FRAME);
      }
      if (!f) break;
      this.sendFrame(f);
      this.sentMs += 20;
    }
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
    const done = new Promise<{ interrupted: boolean }>((resolve) => { this.speakResolve = resolve; });
    const t0 = Date.now();
    let first = true;
    try {
      for await (const chunk of tts(text, { voiceId: this.o.voiceId, signal: abort.signal, cache: kind === "filler" || text.length <= 40 })) {
        if (abort.signal.aborted) break;
        if (first) { first = false; console.log(`[latency] tts first byte: ${Date.now() - t0} ms (${text.length} chars)`); }
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

  startWaitingSound() { this.waiting = true; }
  stopWaitingSound() {
    if (!this.waiting) return;
    this.waiting = false;
    if (!this.speakResolve && this.ws) { try { this.ws.send(JSON.stringify({ event: "clear" })); } catch { /* gone */ } }
  }

  async hangup() {
    if (!this.hungUp && this.controlId) {
      this.hungUp = true;
      try { await telnyx(`/calls/${encodeURIComponent(this.controlId)}/actions/hangup`, {}); }
      catch (e) { console.warn("[telnyx] hangup:", (e as Error).message); }
    }
    this.hungUp = true;
    this.cleanup();
  }

  private cleanup() {
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
