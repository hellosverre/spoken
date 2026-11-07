// Real phone line #3: Vonage Voice API. We dial with POST /v1/calls (JWT, inline NCCO) whose
// `connect` action opens a WebSocket to /vonage/media on this server. After a first JSON text
// message (`websocket:connected`) both directions are binary frames: 16-bit LE PCM, 16 kHz,
// 20 ms = 640 bytes. Our pipeline is µ-law 8 kHz, so inbound is downsampled to 8 kHz PCM
// (Scribe pcm_8000, VAD, batch STT) and outbound µ-law frames are decoded and upsampled to 16 kHz.
// Everything above the wire mirrors telnyx-line.ts / elks-line.ts.
//
// Docs: https://developer.vonage.com/en/voice/voice-api/concepts/websockets,
// /en/api/voice (POST /v1/calls, PUT /v1/calls/{uuid}), /en/getting-started/concepts/authentication.

import type { ServerWebSocket } from "bun";
import { createSign } from "node:crypto";
import { config } from "../config.ts";
import { ScribeStream } from "../voice/scribe.ts";
import { batchVerdict, meanConf } from "./batch-verdict.ts";
import { peakLevel, SpeakerLevel } from "./loudness.ts";
import { transcribeSegment } from "../voice/scribe-batch.ts";
import { tts } from "../voice/tts.ts";
import { holdMusic, levelOf, pcmRms, typingSound, ulawRms, ulawToLinear, ULAW_SILENCE } from "../voice/ulaw.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";
import type { Lang } from "../../../shared/contract.ts";

const API = "https://api.nexmo.com/v1";
const FRAME = 160; // 20 ms of µ-law at 8 kHz (our internal playback queue)
const LEAD_MS = 120;
const RING_SEC = 40;
const BARGE_RMS = Number(process.env.BARGE_RMS ?? 1500);
const BARGE_FRAMES = 10;
const BACKCHANNEL_TEXT = /^(ja|jo|mm+|mhm|hm+|okei|ok|ja ja|aha|å|åh|eh|ehm|nei)[.!,]?$/i;
const VOICED_RMS = Number(process.env.VOICED_RMS ?? 600);
const LOCAL_COMMIT_MS = Number(process.env.LOCAL_COMMIT_MS ?? 450);
const STT_BATCH = process.env.STT_BATCH !== "0";

const lines = new Map<string, VonageLine>(); // by our callId
const TYPING = typingSound(4);
const MUSIC = holdMusic(8);

export function vonageLineForCall(callId: string) { return lines.get(callId); }

export interface VonageLineOpts {
  callId: string;
  to: string;
  voiceId?: string;
  keyterms: string[];
  lang?: Lang;
  maxSec?: number;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** RS256 JWT for the Voice API (claims: application_id, iat, jti, exp). Key may have literal "\n". */
export function vonageJwt(appId: string, privateKey: string, ttlSec = 300): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ application_id: appId, iat: now, nbf: now - 5, exp: now + ttlSec, jti: crypto.randomUUID() }));
  const sig = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey.replace(/\\n/g, "\n"));
  return `${head}.${body}.${b64url(sig)}`;
}

async function vonage(method: "POST" | "PUT", path: string, body: object): Promise<any> {
  const { applicationId, privateKey } = config.vonage;
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${vonageJwt(applicationId, privateKey)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Vonage ${method} ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

/** Vonage wants E.164 without the leading «+». */
const digits = (n: string) => n.replace(/^\+|^00/, "").replace(/\D/g, "");

/** 16 kHz s16le → 8 kHz Int16 (average of each pair: cheap low-pass, enough for a phone line). */
export function down16to8(buf: Uint8Array): Int16Array {
  const n = Math.floor(buf.length / 4);
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = (v.getInt16(i * 4, true) + v.getInt16(i * 4 + 2, true)) >> 1;
  return out;
}

/** µ-law 8 kHz → s16le 16 kHz (linear interpolation); `prev` carries the last sample across frames. */
export function ulawToPcm16k(mu: Uint8Array, prev: { v: number }): Uint8Array {
  const out = new Uint8Array(mu.length * 4);
  const v = new DataView(out.buffer);
  let p = prev.v;
  for (let i = 0; i < mu.length; i++) {
    const cur = ulawToLinear(mu[i]!);
    v.setInt16(i * 4, (p + cur) >> 1, true);
    v.setInt16(i * 4 + 2, cur, true);
    p = cur;
  }
  prev.v = p;
  return out;
}

export class VonageLine implements CallLine {
  readonly revises = STT_BATCH;
  readonly answersFirst = true;
  private ev!: LineEvents;
  private readonly token = crypto.randomUUID().replace(/-/g, "");
  private uuid = ""; // Vonage call uuid (POST /v1/calls → uuid)
  private ws?: ServerWebSocket<any>;
  private scribe?: ScribeStream;
  private lang: Lang;
  private answered = false;
  private streaming = false;
  private connectedSent = false;
  private hungUp = false;
  private ringTimer?: ReturnType<typeof setTimeout>;
  private upPrev = { v: 0 };

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
  private rtConf = new Map<string, number>();
  private lastVoicedAt = 0;
  private lastPartialAt = 0;
  private voicedSinceCommit = false;
  private lastCommittedNorm = "";
  private recent: { at: number; pcm: Int16Array; rms: number }[] = [];
  private speaker = new SpeakerLevel();
  private lastLoudAt = 0;
  private segOnsetAt = 0;
  private sayFramePending = false;
  private ttsChars = 0;
  private sttSamples = 0;
  private lastLevel = { callee: 0, agent: 0 };
  private lastLevelVal = { callee: 0, agent: 0 };
  private costReported = false;
  private billed = (n: number) => { this.ttsChars += n; };
  private lastCommitAt = 0;
  private awaitingFirstAudio = false;
  private segId = 0;
  private committedIds = new Map<string, string>();

  constructor(private o: VonageLineOpts) {
    this.lang = o.lang ?? "no";
    lines.set(o.callId, this);
  }

  silenceMs() { return this.lastVoicedAt ? Date.now() - this.lastVoicedAt : Infinity; }

  // ---------- dialing ----------

  async start(events: LineEvents) {
    this.ev = events;
    const { applicationId, privateKey, number } = config.vonage;
    if (!applicationId || !privateKey || !number) throw new Error("VONAGE_APPLICATION_ID / VONAGE_PRIVATE_KEY / VONAGE_NUMBER missing");
    const wsBase = config.publicUrl.replace(/^http/, "ws");
    const r = await vonage("POST", "/calls", {
      to: [{ type: "phone", number: digits(this.o.to) }],
      from: { type: "phone", number: digits(number) },
      ncco: [{
        action: "connect",
        endpoint: [{
          type: "websocket",
          uri: `${wsBase}/vonage/media?call=${encodeURIComponent(this.o.callId)}&t=${this.token}`,
          "content-type": "audio/l16;rate=16000",
          headers: { callId: this.o.callId },
        }],
      }],
      event_url: [`${config.publicUrl}/vonage/event?call=${encodeURIComponent(this.o.callId)}&t=${this.token}`],
      event_method: "POST",
      ringing_timer: RING_SEC,
      length_timer: Math.min(config.maxCallSec, this.o.maxSec ?? config.maxCallSec),
    });
    this.uuid = String(r.uuid ?? "");
    this.ev.status("ringing");
    console.log(`[vonage] dialing ${this.o.to.slice(0, -4)}xxxx call ${this.o.callId} (${this.uuid || "no uuid"})`);
    // Events are the primary signal; this only catches a lost webhook.
    this.ringTimer = setTimeout(() => {
      if (!this.answered && !this.hungUp) {
        this.ev.status("ended", "Ingen svarte.");
        void this.hangup();
      }
    }, (RING_SEC + 25) * 1000);
  }

  prefetch(texts: string[]) {
    for (const t of texts) {
      void (async () => { try { for await (const _ of tts(t, { voiceId: this.o.voiceId, lang: this.lang, cache: true, onBilled: this.billed })) { /* drain */ } } catch (e) { console.warn("[tts] prefetch failed:", (e as Error).message); } })();
    }
  }

  // ---------- event webhook (POST /vonage/event?call=…&t=<per-call token>, JSON) ----------

  static handleEvent(callId: string, token: string, body: any): boolean {
    const line = lines.get(callId);
    if (!line || line.token !== token) return false;
    line.onEvent(body ?? {});
    return true;
  }

  private onEvent(p: any) {
    const status = String(p.status ?? "");
    if (!this.uuid && p.uuid) this.uuid = String(p.uuid);
    this.ev.debug?.("vonage", { status, reason: p.reason, detail: p.detail, duration: p.duration, price: p.price });
    console.log(`[vonage] ${status}${p.reason ? ` reason=${p.reason}` : ""}${p.detail ? ` detail=${p.detail}` : ""}`);
    switch (status) {
      case "ringing": case "started": break;
      case "answered":
        this.answered = true;
        clearTimeout(this.ringTimer);
        this.maybeConnected();
        // No media socket = no audio: don't leave someone on a silent line.
        setTimeout(() => {
          if (!this.streaming && !this.hungUp) {
            this.ev.status("failed", "Lydstrømmen kom aldri fram (sjekk PUBLIC_URL / tunnelen).");
            void this.hangup();
          }
        }, 8000);
        break;
      case "machine": this.ev.voicemail?.(); break;
      case "completed":
        if (p.price !== undefined) console.log(`[cost] vonage call ${this.o.callId}: €${p.price} (${p.duration ?? "?"} s, rate ${p.rate ?? "?"})`);
        if (this.hungUp) break;
        this.hungUp = true;
        if (this.answered) this.ev.ended("callee hung up");
        else this.ev.status("ended", "Ingen svarte.");
        this.cleanup();
        break;
      case "busy": case "failed": case "rejected": case "timeout": case "unanswered": case "cancelled": {
        if (this.hungUp) break;
        this.hungUp = true;
        if (this.answered) this.ev.ended("callee hung up");
        else if (status === "failed") this.ev.status("failed", `Samtalen feilet (${p.reason ?? p.detail ?? "ukjent"}).`);
        else if (status === "rejected") this.ev.status("failed", "Samtalen ble avvist.");
        else this.ev.status("ended", status === "busy" ? "Opptatt." : "Ingen svarte.");
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

  static authorize(callId: string, token: string): VonageLine | undefined {
    const l = lines.get(callId);
    return l && l.token === token ? l : undefined;
  }

  attach(ws: ServerWebSocket<any>) {
    this.ws = ws;
    this.scribe = new ScribeStream({
      partial: (text) => {
        const n = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
        if (n && this.lastCommittedNorm.startsWith(n) && Date.now() - this.lastCommitAt < 2000) return;
        this.lastPartialAt = Date.now();
        if (Date.now() - this.lastLoudAt < 200 && !BACKCHANNEL_TEXT.test(text.trim())) this.ev.calleeSpeech();
        this.ev.calleePartial(`c_${this.segId}`, text);
      },
      committed: (text) => {
        const id = `c_${this.segId++}`;
        this.lastCommitAt = Date.now();
        this.awaitingFirstAudio = true;
        this.committedIds.set(text.trim(), id);
        this.voicedSinceCommit = false;
        this.lastCommittedNorm = text.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
        const end = (this.lastVoicedAt || Date.now()) + 250;
        const from = (this.segOnsetAt || end - 4000) - 250;
        this.segOnsetAt = 0;
        const peak = peakLevel(this.recent.filter((f) => f.at >= from && f.at <= end).map((f) => f.rms));
        if (this.speaker.isBackground(peak)) {
          this.committedIds.delete(text.trim());
          this.ev.debug?.("background_speech", { id, text, peak: Math.round(peak), speaker: Math.round(this.speaker.level) });
          return;
        }
        const faint = this.speaker.isFaint(peak);
        if (faint) this.ev.debug?.("faint_speech", { id, text, peak: Math.round(peak), speaker: Math.round(this.speaker.level) });
        else if (!this.speakResolve) this.speaker.accept(peak);
        const speechEndAt = Math.max(this.lastVoicedAt, this.lastPartialAt) || undefined;
        this.ev.calleeFinal(id, text, undefined, { speechEndAt, faint });
        this.secondOpinion(id, text, from, end, peak);
      },
      words: (text, words) => {
        const id = this.committedIds.get(text.trim());
        if (id) { const c = meanConf(words); if (c !== undefined) this.rtConf.set(id, c); this.ev.calleeWords?.(id, text, words); }
      },
      error: (msg) => console.error(`[scribe] ${msg}`),
    }, this.o.keyterms, "", "pcm_8000", this.lang);
    this.scribe.connect();
    this.ticker = setInterval(() => this.tick(), 20);
  }

  /** Text = JSON control (websocket:connected …); binary = 20 ms of s16le 16 kHz. */
  onMedia(msg: string | Buffer | Uint8Array) {
    if (typeof msg === "string") {
      let m: any;
      try { m = JSON.parse(msg); } catch { return; }
      if (m.event === "websocket:connected") {
        this.streaming = true;
        console.log(`[vonage] media start ${m["content-type"] ?? ""}`);
        this.ev.debug?.("media_start", { format: m["content-type"] });
        this.maybeConnected();
      }
      return;
    }
    const raw = msg instanceof Uint8Array ? msg : new Uint8Array(msg);
    if (!this.streaming) { this.streaming = true; this.maybeConnected(); } // audio before the JSON hello
    if (raw.length < 4) return;
    this.onFrame(down16to8(raw));
  }

  private onFrame(pcm: Int16Array) {
    const rms = pcmRms(pcm);
    if (rms > VOICED_RMS) {
      this.voicedSinceCommit = true;
      if (!this.segOnsetAt) this.segOnsetAt = Date.now();
      this.lastVoicedAt = Date.now();
      if (rms > this.speaker.floor()) this.lastLoudAt = this.lastVoicedAt;
    }
    this.localVad(rms);
    this.emitLevel("callee", rms);
    this.sttSamples += pcm.length;
    this.recent.push({ at: Date.now(), pcm, rms });
    if (this.recent.length > 1000) this.recent.shift();
    this.inBatch.push(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
    if (this.inBatch.length >= 2) { // 40 ms per Scribe message
      const out = new Uint8Array(this.inBatch.reduce((a, b) => a + b.length, 0));
      let o = 0;
      for (const b of this.inBatch) { out.set(b, o); o += b.length; }
      this.inBatch = [];
      const commitNow = LOCAL_COMMIT_MS > 0 && this.voicedSinceCommit && Date.now() - this.lastVoicedAt >= LOCAL_COMMIT_MS;
      if (commitNow) { this.voicedSinceCommit = false; this.ev.debug?.("local_commit", {}); }
      this.scribe?.send(out, commitNow);
    }
  }

  private emitLevel(who: "callee" | "agent", rms: number) {
    const now = Date.now();
    if (now - this.lastLevel[who] < 66) return;
    const v = Math.round(levelOf(rms) * 100) / 100;
    if (v < 0.04 && this.lastLevelVal[who] < 0.04) return;
    this.lastLevel[who] = now;
    this.lastLevelVal[who] = v;
    this.ev.level?.(who, v < 0.04 ? 0 : v);
  }

  private secondOpinion(id: string, realtime: string, from: number, to: number, peak: number) {
    const frames = this.recent.filter((f) => f.at >= from && f.at <= to);
    if (!frames.length) { this.ev.calleeBatchDone?.(id); return; }
    const pcm = new Int16Array(frames.reduce((n, f) => n + f.pcm.length, 0));
    let o = 0;
    for (const f of frames) { pcm.set(f.pcm, o); o += f.pcm.length; }
    if (!STT_BATCH) { this.ev.calleeBatchDone?.(id); return; }
    const t0 = Date.now();
    transcribeSegment(pcm, this.o.keyterms, undefined, this.lang)
      .then((r) => {
        const rtConf = this.rtConf.get(id);
        const batchConf = meanConf(r.words);
        const round = (n?: number) => n === undefined ? undefined : Math.round(n * 100) / 100;
        this.ev.debug?.("stt_batch", { id, realtime, batch: r.text, rtConf: round(rtConf), batchConf: round(batchConf), ms: Date.now() - t0, peak: Math.round(peak) });
        const v = batchVerdict(realtime, r.text, rtConf, batchConf);
        if (v === "noise") this.ev.calleeNoise?.(id);
        else if (v === "revise") this.ev.calleeRevised?.(id, r.text, r.words);
        else this.ev.calleeBatchDone?.(id);
      })
      .catch((e) => { console.warn("[scribe-batch]", (e as Error).message); this.ev.calleeBatchDone?.(id); });
  }

  private localVad(rms: number) {
    if (!this.speakResolve) { this.loudFrames = 0; return; }
    if (rms > Math.max(BARGE_RMS, this.speaker.floor())) {
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

  /** One 20 ms µ-law frame → one 640-byte binary message. */
  private sendFrame(f: Uint8Array) {
    if (!this.ws || this.hungUp) return;
    try { this.ws.send(ulawToPcm16k(f, this.upPrev)); } catch { /* socket gone */ }
  }

  private tick() {
    const now = Date.now();
    if (!this.clockStart) { this.clockStart = now; this.sentMs = 0; }
    const elapsed = now - this.clockStart;
    if (this.sentMs < elapsed - 40) { this.clockStart = now - this.sentMs; }
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
      for await (const chunk of tts(text, { voiceId: this.o.voiceId, lang: this.lang, signal: abort.signal, cache: kind === "filler" || text.length <= 40, onBilled: this.billed })) {
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

  setLang(lang: Lang) {
    this.lang = lang;
    this.scribe?.setLang(lang);
  }

  speechLeftMs() {
    if (!this.speakResolve) return 0;
    if (!this.producerDone) return Infinity;
    return this.buffered() / 8 + Math.max(0, this.sentMs - (Date.now() - this.clockStart));
  }

  /** Barge-in: drop our queue. Only ~LEAD_MS is already with Vonage, so no remote clear is needed. */
  stopSpeaking() {
    this.speakAbort?.abort();
    this.chunks = [];
    this.chunkOff = 0;
    this.producerDone = true;
    const r = this.speakResolve;
    this.speakResolve = undefined;
    r?.({ interrupted: true });
  }

  startWaitingSound(kind: "typing" | "music" = "typing") {
    if (this.waitKind !== kind) this.typingOff = 0;
    this.waitKind = kind;
    this.waiting = true;
  }
  stopWaitingSound() { this.waiting = false; }

  // DTMF over the media socket isn't part of the Voice API websocket; sendDtmf stays undefined.

  async hangup() {
    clearTimeout(this.ringTimer);
    if (!this.hungUp && this.uuid) {
      this.hungUp = true;
      try { await vonage("PUT", `/calls/${encodeURIComponent(this.uuid)}`, { action: "hangup" }); }
      catch (e) { console.warn("[vonage] hangup:", (e as Error).message); }
    }
    this.hungUp = true;
    this.cleanup();
  }

  private cleanup() {
    clearTimeout(this.ringTimer);
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
    setTimeout(() => lines.delete(this.o.callId), 60_000);
  }

  onSocketClosed() {
    if (!this.hungUp) console.warn("[vonage] media socket closed before the call ended");
  }
}
