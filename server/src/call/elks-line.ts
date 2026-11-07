// Real phone line #2: 46elks. We dial with POST /a1/calls and connect the answered call to our
// WebSocket number; 46elks then opens wss://…/elks/media to us and speaks the Realtime Voice
// protocol (JSON, field `t`; G.711 µ-law 8 kHz both ways). Everything above the wire (VAD, Scribe,
// paced TTS playback, barge-in) mirrors telnyx-line.ts so CallSession can't tell the two apart.
//
// Docs: https://46elks.com/docs/realtime-voice, /docs/realtime-voice-messages, /docs/make-call.
//
// Correlation: a WebSocket number has ONE static websocket_url, so the per-call token can't ride
// on the media URL. Instead the socket carries a shared secret (?t=ELKS_WS_SECRET) and the `hello`
// is matched to our call by `callid` (the id POST /calls returned), falling back to the single
// call that is still waiting for its hello. The per-call token guards the whenhangup webhook.

import type { ServerWebSocket } from "bun";
import { timingSafeEqual } from "node:crypto";
import { config } from "../config.ts";
import { ScribeStream } from "../voice/scribe.ts";
import { batchVerdict, meanConf } from "./batch-verdict.ts";
import { peakLevel, SpeakerLevel } from "./loudness.ts";
import { transcribeSegment } from "../voice/scribe-batch.ts";
import { tts } from "../voice/tts.ts";
import { holdMusic, levelOf, pcmRms, g711ToPcm16, typingSound, ulawRms, ULAW_SILENCE } from "../voice/ulaw.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";
import type { Lang } from "../../../shared/contract.ts";

const API = "https://api.46elks.com/a1";
const FRAME = 160; // 20 ms of µ-law at 8 kHz
const LEAD_MS = 120;
const RING_SEC = 40; // `timeout` on POST /calls: how long the callee's phone may ring
const BARGE_RMS = Number(process.env.BARGE_RMS ?? 1500);
const BARGE_FRAMES = 10;
const BACKCHANNEL_TEXT = /^(ja|jo|mm+|mhm|hm+|okei|ok|ja ja|aha|å|åh|eh|ehm|nei)[.!,]?$/i;
const VOICED_RMS = Number(process.env.VOICED_RMS ?? 600);
const LOCAL_COMMIT_MS = Number(process.env.LOCAL_COMMIT_MS ?? 450);
const STT_BATCH = process.env.STT_BATCH !== "0";
const BYE_WAIT_MS = 6000; // after our `bye`, wait this long for 46elks' final `bye` before closing

const lines = new Map<string, ElksLine>(); // by our callId
const TYPING = typingSound(4);
const MUSIC = holdMusic(8);

export function elksLineForCall(callId: string) { return lines.get(callId); }

/** Extra per-call fields on an outgoing 46elks request, for tests to inspect. */
export interface ElksLineOpts {
  callId: string;
  to: string;
  voiceId?: string;
  keyterms: string[];
  lang?: Lang;
  maxSec?: number;
}

/** Constant-time compare of the socket secret; an unset secret accepts any (still needs a pending call). */
export function elksSecretOk(given: string | null): boolean {
  const want = config.elks.wsSecret;
  if (!want) return true;
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function elksPost(path: string, form: Record<string, string>): Promise<any> {
  const { apiUser, apiPassword } = config.elks;
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiUser}:${apiPassword}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`46elks ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
  try { return text ? JSON.parse(text) : {}; } catch { return {}; }
}

export class ElksLine implements CallLine {
  readonly revises = STT_BATCH;
  readonly answersFirst = true;
  private ev!: LineEvents;
  private readonly token = crypto.randomUUID().replace(/-/g, "");
  private elksId = ""; // 46elks' call id (POST /calls → id; hello.callid)
  private ws?: ServerWebSocket<any>;
  private scribe?: ScribeStream;
  private lang: Lang;
  private helloSeen = false;
  private ending = false; // we sent bye; waiting for the API's bye
  private hungUp = false; // call is over, nothing more to send
  private byeTimer?: ReturnType<typeof setTimeout>;
  private ringTimer?: ReturnType<typeof setTimeout>;

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

  constructor(private o: ElksLineOpts) {
    this.lang = o.lang ?? "no";
    lines.set(o.callId, this);
  }

  silenceMs() { return this.lastVoicedAt ? Date.now() - this.lastVoicedAt : Infinity; }

  // ---------- dialing ----------

  async start(events: LineEvents) {
    this.ev = events;
    const { apiUser, apiPassword, number, wsNumber } = config.elks;
    if (!apiUser || !apiPassword || !number || !wsNumber) throw new Error("ELKS_API_USER / ELKS_API_PASSWORD / ELKS_NUMBER / ELKS_WS_NUMBER missing");
    const q = `call=${encodeURIComponent(this.o.callId)}&t=${this.token}`;
    const r = await elksPost("/calls", {
      from: number,
      to: this.o.to,
      // When the callee picks up, 46elks bridges the call to the websocket number, whose
      // websocket_url points at /elks/media on this server.
      voice_start: JSON.stringify({ connect: wsNumber }),
      timeout: String(RING_SEC),
      whenhangup: `${config.publicUrl}/elks/whenhangup?${q}`,
    });
    this.elksId = String(r.id ?? "");
    if (r.state === "failed" || r.state === "busy") {
      this.hungUp = true;
      throw new Error(`46elks refused the call (state ${r.state})`);
    }
    this.ev.status("ringing");
    console.log(`[46elks] dialing ${this.o.to.slice(0, -4)}xxxx call ${this.o.callId} (${this.elksId || "no id"})`);
    // No hello and no whenhangup: don't ring forever.
    this.ringTimer = setTimeout(() => {
      if (!this.helloSeen && !this.hungUp) {
        this.ev.status("ended", "Ingen svarte.");
        void this.hangup();
      }
    }, (RING_SEC + 20) * 1000);
  }

  prefetch(texts: string[]) {
    for (const t of texts) {
      void (async () => { try { for await (const _ of tts(t, { voiceId: this.o.voiceId, lang: this.lang, cache: true, onBilled: this.billed })) { /* drain */ } } catch (e) { console.warn("[tts] prefetch failed:", (e as Error).message); } })();
    }
  }

  // ---------- whenhangup webhook (POST /elks/whenhangup?call=…&t=<per-call token>) ----------

  /** form: state, cost (1/10000 of the account currency), duration, id. Returns false if not ours. */
  static handleHangup(callId: string, token: string, form: Record<string, string>): boolean {
    const line = lines.get(callId);
    if (!line || line.token !== token) return false;
    line.onHangupWebhook(form);
    return true;
  }

  private onHangupWebhook(f: Record<string, string>) {
    const cost = Number(f.cost);
    this.ev.debug?.("elks_hangup", { state: f.state, duration: f.duration, cost: Number.isFinite(cost) ? cost / 10000 : undefined });
    console.log(`[cost] 46elks call ${this.o.callId}: ${Number.isFinite(cost) ? (cost / 10000).toFixed(4) : "?"} (account currency, ${f.duration ?? "?"} s, state ${f.state ?? "?"})`);
    if (this.helloSeen) return; // answered calls end through the media socket's bye
    if (this.hungUp) return;
    this.hungUp = true;
    if (f.state === "busy") this.ev.status("ended", "Opptatt.");
    else this.ev.status("ended", "Ingen svarte, eller samtalen ble avvist.");
    this.cleanup();
  }

  // ---------- media websocket ----------

  /**
   * First message on /elks/media must be `hello`. Finds the call it belongs to and returns it
   * (already attached to ws), or undefined if no call is waiting.
   */
  static accept(ws: ServerWebSocket<any>, raw: string): ElksLine | undefined {
    let m: any;
    try { m = JSON.parse(raw); } catch { return undefined; }
    if (m?.t !== "hello") return undefined;
    const waiting = [...lines.values()].filter((l) => !l.ws && !l.hungUp && l.ringTimer !== undefined);
    let line = waiting.find((l) => l.elksId && l.elksId === m.callid);
    let how = "callid";
    if (!line && waiting.length === 1) { line = waiting[0]; how = "only-pending"; }
    if (!line && waiting.length > 1) {
      const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
      line = waiting.find((l) => digits(l.o.to) === digits(m.from) || digits(l.o.to) === digits(m.to));
      how = "number";
    }
    if (!line) return undefined;
    line.onHello(ws, m, how);
    return line;
  }

  private onHello(ws: ServerWebSocket<any>, m: any, how: string) {
    this.ws = ws;
    this.helloSeen = true;
    if (!this.elksId && m.callid) this.elksId = String(m.callid);
    clearTimeout(this.ringTimer);
    console.log(`[46elks] hello for call ${this.o.callId} (matched by ${how})`);
    this.ev.debug?.("media_start", { format: "ulaw_8000", match: how });
    this.attach(ws);
    this.send({ t: "listening", format: "ulaw" });
    this.send({ t: "sending", format: "ulaw" });
    this.ev.status("connected");
  }

  private send(m: object) {
    if (!this.ws) return;
    try { this.ws.send(JSON.stringify(m)); } catch { /* socket gone */ }
  }

  private attach(_ws: ServerWebSocket<any>) {
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
    }, this.o.keyterms, "", undefined, this.lang);
    this.scribe.connect();
    this.ticker = setInterval(() => this.tick(), 20);
  }

  /** Every message after hello. */
  onMedia(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case "audio": {
        if (!m.data) return;
        const mu = new Uint8Array(Buffer.from(m.data, "base64"));
        // 46elks may deliver any chunk size; Scribe and VAD work on 20 ms frames.
        for (let o = 0; o < mu.length; o += FRAME) this.onFrame(mu.subarray(o, Math.min(o + FRAME, mu.length)));
        break;
      }
      case "bye": this.onBye(m); break;
      case "sync": break;
    }
  }

  private onFrame(raw: Uint8Array) {
    const pcm = g711ToPcm16(raw, false);
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
    this.inBatch.push(new Uint8Array(pcm.buffer));
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

  private onBye(m: any) {
    console.log(`[46elks] bye reason=${m.reason ?? "?"} ${m.message ?? ""}`);
    this.ev.debug?.("elks_bye", { reason: m.reason, message: m.message });
    const wasEnding = this.ending;
    this.hungUp = true;
    if (!wasEnding) {
      if (m.reason === "error") this.ev.status("failed", `Samtalen feilet: ${m.message ?? "ukjent feil"}`);
      else this.ev.ended("callee hung up");
    }
    this.cleanup();
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

  private sendFrame(f: Uint8Array) {
    if (!this.ws || this.hungUp || this.ending) return;
    this.send({ t: "audio", data: Buffer.from(f).toString("base64") });
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
    if (this.hungUp || this.ending || !this.ws) return { interrupted: true };
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

  /** Drop what 46elks has buffered: `interrupt` ignores audio until a new `sending`, so re-send it. */
  private clearRemote() {
    if (!this.ws || this.hungUp || this.ending) return;
    this.send({ t: "interrupt" });
    this.send({ t: "sending", format: "ulaw" });
  }

  stopSpeaking() {
    this.speakAbort?.abort();
    this.chunks = [];
    this.chunkOff = 0;
    this.producerDone = true;
    this.clearRemote();
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
    if (!this.speakResolve) this.clearRemote();
  }

  // Realtime Voice has no DTMF message, so sendDtmf is left undefined: the session skips it.

  /** End the call: `bye` lets 46elks finish playing buffered audio, then it hangs up and answers with `bye`. */
  async hangup() {
    clearTimeout(this.ringTimer);
    if (this.ws && !this.ending && !this.hungUp) {
      this.ending = true;
      // Stop our own pacing but keep what 46elks already has; the goodbye line must finish.
      this.send({ t: "bye" });
      this.byeTimer = setTimeout(() => { this.hungUp = true; this.cleanup(); }, BYE_WAIT_MS);
      this.finishAudio();
      return;
    }
    this.hungUp = true;
    this.cleanup();
  }

  private finishAudio() {
    this.reportCost();
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.scribe?.close();
    this.scribe = undefined;
    const r = this.speakResolve;
    this.speakResolve = undefined;
    r?.({ interrupted: true });
  }

  private reportCost() {
    if (this.costReported) return;
    this.costReported = true;
    this.ev?.cost?.({ ttsChars: this.ttsChars, sttSec: Math.round(this.sttSamples / 8000) });
  }

  private cleanup() {
    clearTimeout(this.byeTimer);
    clearTimeout(this.ringTimer);
    this.finishAudio();
    this.stopSpeaking();
    try { this.ws?.close(); } catch { /* closed */ }
    this.ws = undefined;
    setTimeout(() => lines.delete(this.o.callId), 60_000);
  }

  onSocketClosed() {
    if (this.hungUp) return;
    // 46elks dropped the socket without a bye: treat it as the callee hanging up.
    console.warn("[46elks] media socket closed before bye");
    this.hungUp = true;
    if (!this.ending) this.ev.ended("callee hung up");
    this.ws = undefined;
    this.cleanup();
  }
}
