// One live call: owns the transcript, the agent loop, approvals, barge-in and the
// safety gates between the LLM and the speaker. Works the same over mock and Telnyx lines.

import type {
  CallResult, CallStatus, LiveCommand, LiveEvent, Outcome, Plan, Profile, TranscriptLine, Word,
} from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { mockSummary } from "../llm/mock.ts";
import type { AgentContext, HistoryItem, LlmProvider, Tone, Usage } from "../llm/types.ts";
import {
  ADDRESS_REFUSAL, CARD_REFUSAL, FNR_REFUSAL, detectSecretAsk, ensureDisclosure, filterOutgoing, isCommitment,
} from "../safety.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CallLine, LineMetric } from "./line.ts";
import { timeHint, timesIn } from "../time.ts";
import { HoldFlow } from "./hold.ts";
import { Segmenter, type Segment } from "./segment.ts";

export const WAIT_PHRASE = "Et øyeblikk…";

/**
 * Per-turn latency for the "Built with ElevenLabs" panel. Proposed for shared/contract.ts
 * (LiveEvent union); emitted with a cast until the lead adds it there.
 */
export interface LatencyEvent {
  type: "latency";
  sttMs: number | null; // callee stopped talking → Scribe committed the transcript
  llmMs: number | null; // LLM request → first token
  ttsMs: number | null; // TTS request for the first sentence → first audio byte (0 = cached)
  totalMs: number; // callee stopped talking (or commit, if unknown) → first agent audio on the line
  models: { stt: string; llm: string; tts: string };
  at: number;
}

interface TurnTiming {
  commitAt: number;
  speechEndAt?: number;
  llmMs: number | null;
  ttsMs: number | null;
  awaitTts: boolean;
  awaitAudio: boolean;
}

// Agent lines that mean "I didn't get that". Two turns of these in a row → change strategy.
const CONFUSED = /(si det en gang til|kan du gjenta|forsto (deg )?ikke|hørte (deg )?ikke|linja er (litt )?dårlig|unnskyld,? hva sa du)/i;
// Short fillers for when a reply is slow (> FILLER_AFTER_MS). Rotated, never the same twice in a row.
const FILLERS = ["Mm, et øyeblikk.", "Ja, la meg se.", "Et lite øyeblikk."];
const FILLER_AFTER_MS = 2500;
// Instant cached backchannel when content is not ready this long after the callee's commit.
// Backchannel only when the reply is clearly slow, at most once every 3 turns, never after a
// question (Sverre, call #5: «mm» after everything sounded robotic).
const BACKCHANNELS = ["Ja.", "Okei.", "Skjønner."];
const BACKCHANNEL_MS = Number(process.env.BACKCHANNEL_MS ?? 1200);
const BACKCHANNEL_EVERY = 3;
// Don't start talking until the callee has been quiet this long (call #5: half-sentences from
// turns that were cancelled because the callee was still talking).
const SPEAK_AFTER_SILENCE_MS = Number(process.env.SPEAK_AFTER_SILENCE_MS ?? 600);
// Speculative LLM on partials: 0 of 62 matched on call #5, so off unless SPECULATE=1.
const SPECULATE = process.env.SPECULATE === "1";
// Callee says only «ja»/«mm» while we're mid-turn: listening noise, not a new turn.
const CALLEE_BACKCHANNEL = /^(ja|jo|mm+|mhm|hm+|okei|ok|ja ja|aha|å|åh|eh|ehm)[.!,]?$/i;
const GOODBYE = /\b(ha det( bra| godt)?|ha en (fin|god|strålende) (dag|kveld|helg))\b/i;
// Unsure words worth waiting ~0.7 s for a batch re-transcription: numbers and real content words.
const FILLER_WORDS = new Set(["det", "den", "jeg", "du", "vi", "de", "ha", "har", "er", "var", "ja", "nei", "og", "en", "et", "så", "bare", "da", "eh", "ehm", "øh", "mm", "hm", "ikke", "kan", "vil", "må", "med", "på", "til", "som", "nå", "jo", "okei", "ok"]);
// Start the LLM on a partial that has been stable this long (speculative turn).
const SPEC_AFTER_MS = Number(process.env.SPEC_AFTER_MS ?? 200);
// Callee text that sounds cut off mid-sentence: wait this long for more before answering.
const HOLD_MS = 450;
// Word confidences arrive ~20 ms after the commit; batch revisions ~0.7 s.
const WORDS_WAIT_MS = 120;
const REVISION_WAIT_MS = Number(process.env.REVISION_WAIT_MS ?? 800);
// Questions and normal sentences are finished even if they end in «det»/«den» («vi har ikke det.»).
const CONNECTOR_END = /\b(og|eller|men|fordi|at|som|hvis|altså|eh|ehm|øh|liksom|til|med|for|om)[.…]?$/i;
function soundsUnfinished(text: string): boolean {
  const t = text.trim();
  if (/\?$/.test(t)) return false;
  if (/(,|…|\.\.\.|-)$/.test(t)) return true;
  if (CONNECTOR_END.test(t)) return true;
  // «Det blir.» / «Det koster.» : a cut-off before the number
  return t.split(/\s+/).length <= 3 && /\b(blir|koster|er|var)[.]?$/i.test(t);
}

interface Spec {
  key: string;
  abort: AbortController;
  tokens: string[];
  done: boolean;
  error?: unknown;
  wake?: () => void;
}

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

// Debug transcript per call (server/logs/<callId>.jsonl, gitignored). CALL_LOG=0 turns it off;
// keep it off for the public demo (CONTRACT: no transcript stored server-side).
const LOG_DIR = join(import.meta.dir, "../../logs");
const CALL_LOG = process.env.CALL_LOG !== "0";
if (CALL_LOG) { try { mkdirSync(LOG_DIR, { recursive: true }); } catch { /* no log dir */ } }

type Listener = (ev: LiveEvent) => void;

interface PendingApproval {
  id: string;
  question: string;
  options: string[];
  kind: "commit" | "address" | "choice" | "stuck";
  timer?: ReturnType<typeof setTimeout>;
}

export interface SessionInit {
  callId: string;
  taskId: string;
  plan: Plan;
  profile: Profile;
  line: CallLine;
  llm: LlmProvider;
  /** Approved for this call only; never put into the LLM context. */
  secrets?: { fnr?: string };
}

let seq = 0;
const nid = (p: string) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;

export class CallSession {
  readonly callId: string;
  readonly taskId: string;
  readonly events: LiveEvent[] = [];
  readonly transcript: TranscriptLine[] = [];
  result?: CallResult;
  status: CallStatus = "dialing";
  /** Latency samples: callee segment committed → agent audio started (ms). */
  readonly latencies: number[] = [];

  private listeners = new Set<Listener>();
  private history: HistoryItem[] = [];
  private tone: Tone = "friendly";
  private simpler = false;
  private speaking = false;
  private turnAbort?: AbortController;
  private turnRunning = false;
  private wantTurn = false;
  private pending?: PendingApproval;
  private approvalCredit = 0;
  private startedAt = 0;
  private connectedAt = 0;
  private ended = false;
  private endTag?: { outcome: Outcome; summary: string };
  private maxTimer?: ReturnType<typeof setTimeout>;
  private lastCalleeAt = 0;
  private waitingNoticeSaid = false;
  private silenceTimer?: ReturnType<typeof setTimeout>;
  private recentTurns: Set<string>[] = []; // normalised sentences of the last 3 agent turns
  private recentConfused: boolean[] = []; // last 4 agent turns: was it a "didn't get that"?
  private confusedRun = 0; // confused turns within that window
  private lastFiller = "";
  private timing?: TurnTiming;
  private spec?: Spec;
  private gate?: { id: string; timer?: ReturnType<typeof setTimeout>; go: () => void };
  private segItems = new Map<string, HistoryItem>(); // callee segment id → its history line
  private lineCost?: { ttsChars: number; sttSec: number };
  private specTimer?: ReturnType<typeof setTimeout>;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private lastBackchannel = "";
  private turnNo = 0;
  private rephrased = false;
  private goalAsks = 0; // agent questions about the goal since the last progress
  private lastProgressAt = 0;
  private messages = new Map<string, string>(); // callee segment id → message for the user
  private lastBackchannelTurn = -99;
  private answeredAtHistory = -1; // history length when the user last answered an approval
  private reasked = 0;
  private usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, requests: 0 };
  private addUsage = (u: Usage) => {
    this.usage.promptTokens += u.promptTokens;
    this.usage.completionTokens += u.completionTokens;
    this.usage.costUsd += u.costUsd ?? 0;
    this.usage.requests++;
  };
  private nudged = 0;

  private hold: HoldFlow;

  constructor(private init: SessionInit) {
    this.callId = init.callId;
    this.taskId = init.taskId;
    this.hold = new HoldFlow({
      userName: init.profile.name,
      say: (t) => this.say(t, "filler"),
      note: (t, level) => this.note(t, level),
      sound: (k) => (k === "off" ? this.init.line.stopWaitingSound() : this.init.line.startWaitingSound(k)),
      giveUp: async (summary) => {
        if (this.pending) { clearTimeout(this.pending.timer); this.pending = undefined; }
        await this.finish("approval timeout", { outcome: "partial", summary });
      },
      debug: (k, d) => this.debug(k, d),
    });
  }

  // ---------- events ----------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Append to the per-call debug log. Never contains fnr (only placeholders reach here). */
  debug(kind: string, data: Record<string, unknown> = {}) {
    if (!CALL_LOG) return;
    try { appendFileSync(join(LOG_DIR, `${this.callId}.jsonl`), JSON.stringify({ t: Date.now(), kind, ...data }) + "\n"); }
    catch { /* logging must never break a call */ }
  }

  /** High-rate events (voice level): to clients only, not replayed to late joiners or logged. */
  private emitLive(ev: LiveEvent) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch { /* listener gone */ }
    }
  }

  private emit(ev: LiveEvent) {
    this.events.push(ev);
    if (!(ev.type === "transcript" && !ev.final)) this.debug("event", { ev });
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.error("[session] listener failed", e); }
    }
  }

  private note(text: string, level: "info" | "warn" = "info") {
    this.emit({ type: "note", text, level, at: Date.now() });
  }

  private setStatus(status: CallStatus) {
    if (this.status === status || this.status === "ended") return;
    this.status = status;
    this.emit({ type: "status", status, at: Date.now() });
  }

  // ---------- lifecycle ----------

  async start() {
    this.startedAt = Date.now();
    this.emit({ type: "status", status: "dialing", at: this.startedAt });
    this.init.line.prefetch?.([ensureDisclosure(this.init.plan.opening, this.init.profile.name), WAIT_PHRASE, CARD_REFUSAL, ...BACKCHANNELS]);
    void this.init.llm.warm?.();
    this.maxTimer = setTimeout(() => this.forceEnd("Maks samtaletid (10 min) nådd."), config.maxCallSec * 1000);
    try {
      await this.init.line.start({
        status: (s, detail) => this.onLineStatus(s, detail),
        calleeSpeech: () => this.onCalleeSpeech(),
        calleePartial: (id, text) => {
          this.emit({ type: "transcript", id, who: "callee", text, final: false, at: Date.now() });
          this.onPartial(text);
        },
        calleeFinal: (id, text, words, meta) => {
          this.timing = { commitAt: Date.now(), speechEndAt: meta?.speechEndAt, llmMs: null, ttsMs: null, awaitTts: false, awaitAudio: false };
          this.onCalleeFinal(id, text, words);
        },
        metric: (m) => this.onMetric(m),
        cost: (c) => { this.lineCost = c; },
        level: (who, rms) => this.emitLive({ type: "level", who, rms, at: Date.now() }),
        calleeWords: (id, text, words) => {
          this.emit({ type: "transcript", id, who: "callee", text, final: true, words, at: Date.now() });
          this.onWords(id, words);
        },
        calleeRevised: (id, text, words) => this.onRevised(id, text, words),
        ended: (reason) => void this.finish(reason),
        debug: (kind, data) => this.debug(kind, data),
      });
    } catch (e) {
      console.error("[session] line start failed:", (e as Error).message);
      this.note(`Kunne ikke ringe: ${(e as Error).message}`, "warn");
      this.setStatus("failed");
      await this.finish("failed", { outcome: "failed", summary: "Samtalen kunne ikke kobles opp." });
    }
  }

  private onLineStatus(s: CallStatus, detail?: string) {
    if (detail) this.note(detail, s === "failed" ? "warn" : "info");
    if (s === "connected" && this.status !== "connected") {
      this.setStatus("connected");
      this.connectedAt = Date.now();
      this.lastProgressAt = this.connectedAt;
      void this.sayOpening();
      return;
    }
    if (s === "ended" || s === "failed") {
      if (s === "failed") this.setStatus("failed");
      void this.finish(detail ?? s);
      return;
    }
    this.setStatus(s);
  }

  private async sayOpening() {
    // The disclosure is generated here, not by the model, and always goes first.
    const opening = ensureDisclosure(this.init.plan.opening, this.init.profile.name);
    await this.say(opening);
  }

  // ---------- callee side ----------

  private onCalleeSpeech() {
    // Barge-in: the callee talks over us → stop audio at once and drop the rest of the turn.
    if (this.speaking) {
      console.log(`[barge-in] callee spoke over the agent; TTS stopped (call ${this.callId})`);
      this.debug("barge_in");
      this.init.line.stopSpeaking();
      this.turnAbort?.abort();
    }
  }

  private onCalleeFinal(id: string, text: string, words?: Word[]) {
    const clean = text.trim();
    if (!clean || this.ended) return;
    this.lastCalleeAt = Date.now();
    this.nudged = 0;
    clearTimeout(this.silenceTimer);
    this.emit({ type: "transcript", id, who: "callee", text: clean, final: true, words, at: this.lastCalleeAt });
    this.transcript.push({ who: "callee", text: clean, at: this.lastCalleeAt });
    // Times are parsed in code and handed to the LLM as facts («⟨tid: 19:00⟩»).
    const hint = timeHint(clean);
    const item: HistoryItem = { role: "callee", text: hint ? `${clean} ${hint}` : clean };
    this.history.push(item);
    this.segItems.set(id, item);
    this.checkMessage(id, clean);
    if ((this.turnRunning || this.speaking) && CALLEE_BACKCHANNEL.test(clean)) {
      this.debug("callee_backchannel_ignored", { text: clean });
      return;
    }
    if (this.speaking) this.onCalleeSpeech();

    if (this.pending) {
      if (this.hold.onCallee(clean)) return;
      // Keep the line warm while the user decides; say it once so they know we're there.
      if (!this.waitingNoticeSaid) {
        this.waitingNoticeSaid = true;
        void this.say(`Et øyeblikk, jeg sjekker med ${this.init.profile.name || "brukeren"}.`, "filler").then(() => {
          if (this.pending) this.init.line.startWaitingSound();
        });
      }
      return;
    }

    const ask = detectSecretAsk(clean);
    if (ask === "card") {
      this.note("Nektet å oppgi kortnummer.", "warn");
      void this.say(CARD_REFUSAL, "say", true);
      return;
    }
    if (ask === "fnr" && !(this.init.plan.willShare.includes("fnr") && this.init.secrets?.fnr)) {
      this.note("Nektet å oppgi fødselsnummer (ikke godkjent for denne samtalen).", "warn");
      void this.say(FNR_REFUSAL, "say", true);
      return;
    }
    if (ask === "address" && !this.init.plan.willShare.includes("address")) {
      void this.requestApproval("Mottakeren spør etter adressen din. Kan jeg oppgi den?", ["JA", "NEI"], "address", ADDRESS_REFUSAL);
      return;
    }
    // Short VAD window: a pause after "Det blir…" must not start our turn.
    clearTimeout(this.holdTimer);
    if (soundsUnfinished(clean)) {
      this.debug("hold_unfinished", { text: clean });
      this.holdTimer = setTimeout(() => { this.holdTimer = undefined; this.requestTurn(); }, HOLD_MS);
      return;
    }
    this.startGate(id);
  }

  // ---------- word confidence ----------

  /**
   * Low-confidence words go to the LLM as a hint (the transcript the user sees is unchanged):
   * "Jeg må snakke med rektor ⟨usikre ord: rektor⟩". If a speculative reply was made without
   * that hint, drop it so the model can reinterpret or ask.
   */
  private onWords(id: string, words: Word[]) {
    const unsure = words.filter((w) => w.confidence < 0.6).map((w) => w.text.replace(/[.,!?]$/, ""));
    const gate = this.gate?.id === id ? this.gate : undefined;
    if (!unsure.length) { gate?.go(); return; }
    const item = this.segItems.get(id);
    if (item && !item.text.includes("⟨")) item.text = `${item.text} ⟨usikre ord: ${unsure.join(", ")}⟩`;
    this.debug("unsure_words", { id, unsure });
    if (this.spec) this.dropSpec("unsure words");
    // Wait for the batch second opinion only if an unsure word matters (a number, a name, a noun);
    // on a real line nearly every segment has some unsure filler word (call #4).
    const matters = unsure.some((w) => /\d/.test(w) || (w.length >= 5 && !FILLER_WORDS.has(w.toLowerCase())));
    if (!gate) return;
    if (!matters) { gate.go(); return; }
    clearTimeout(gate.timer);
    gate.timer = setTimeout(gate.go, REVISION_WAIT_MS);
  }

  /** Batch STT disagreed with realtime: fix the transcript, the result card and what the LLM sees. */
  private onRevised(id: string, text: string, words: Word[]) {
    const clean = text.trim();
    if (!clean || this.ended) return;
    this.emit({ type: "transcript", id, who: "callee", text: clean, final: true, words, at: Date.now() });
    const item = this.segItems.get(id);
    if (item) {
      const line = this.transcript.find((t) => t.who === "callee" && t.text === item.text.replace(/ ⟨usikre ord:.*⟩$/, ""));
      if (line) line.text = clean;
      const unsure = words.filter((w) => w.confidence < 0.6).map((w) => w.text.replace(/[.,!?]$/, ""));
      const hint = timeHint(clean);
      item.text = [clean, hint, unsure.length ? `⟨usikre ord: ${unsure.join(", ")}⟩` : ""].filter(Boolean).join(" ");
    }
    this.debug("stt_revised", { id, text: clean });
    if (this.messages.has(id)) this.checkMessage(id, clean);
    if (this.gate?.id === id) this.gate.go();
  }

  /** Wait briefly for word confidences (and, if unsure, the batch revision) before answering. */
  private startGate(id: string) {
    if (!this.init.line.revises) { this.requestTurn(); return; }
    clearTimeout(this.gate?.timer);
    let fired = false;
    const gate = {
      id,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      go: () => { if (fired) return; fired = true; clearTimeout(gate.timer); if (this.gate === gate) this.gate = undefined; this.requestTurn(); },
    };
    this.gate = gate;
    gate.timer = setTimeout(gate.go, WORDS_WAIT_MS);
  }

  // ---------- speculative turn ----------

  private canSpeculate() {
    return this.status === "connected" && !this.pending && !this.turnRunning && !this.speaking && !this.ended;
  }

  private dropSpec(why: string) {
    if (!this.spec) return;
    this.debug("spec_drop", { why, key: this.spec.key });
    this.spec.abort.abort();
    this.spec = undefined;
  }

  /** A partial that stops changing means the callee probably finished: start thinking now. */
  private lastPartialAt = 0;

  private onPartial(text: string) {
    this.lastPartialAt = Date.now();
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = undefined; } // they kept talking
    const key = norm(text);
    if (this.spec && this.spec.key !== key) this.dropSpec("partial changed");
    clearTimeout(this.specTimer);
    if (!SPECULATE || !this.canSpeculate() || key.length < 2) return;
    this.specTimer = setTimeout(() => {
      if (this.spec || !this.canSpeculate()) return;
      const ctx = this.ctx();
      ctx.history = [...ctx.history, { role: "callee", text: text.trim() }];
      const spec: Spec = { key, abort: new AbortController(), tokens: [], done: false };
      this.spec = spec;
      this.debug("spec_start", { key });
      void (async () => {
        try {
          for await (const tok of this.init.llm.reply(ctx, spec.abort.signal, this.addUsage)) {
            spec.tokens.push(tok);
            spec.wake?.();
          }
        } catch (e) { spec.error = e; }
        finally { spec.done = true; spec.wake?.(); }
      })();
    }, SPEC_AFTER_MS);
  }

  /** The speculative reply, if it was made for exactly what the callee ended up saying. */
  private takeSpec(): Spec | undefined {
    const spec = this.spec;
    this.spec = undefined;
    clearTimeout(this.specTimer);
    if (!spec) return undefined;
    const last = this.history.at(-1);
    if (last?.role === "callee" && norm(last.text) === spec.key) { this.debug("spec_hit", { key: spec.key, tokensReady: spec.tokens.length }); return spec; }
    this.debug("spec_miss", { key: spec.key, final: last?.text });
    spec.abort.abort();
    return undefined;
  }

  private async *specTokens(spec: Spec): AsyncIterable<string> {
    let i = 0;
    while (true) {
      while (i < spec.tokens.length) yield spec.tokens[i++]!;
      if (spec.done) { if (spec.error && !spec.abort.signal.aborted) throw spec.error; return; }
      await new Promise<void>((r) => { spec.wake = r; });
    }
  }

  // ---------- agent turns ----------

  private requestTurn() {
    if (this.ended) return;
    if (this.turnRunning) {
      this.turnAbort?.abort();
      this.wantTurn = true;
      return;
    }
    void this.runTurn(this.takeSpec());
  }

  private ctx(): AgentContext {
    const p = this.init.profile;
    const facts: Record<string, string> = {};
    const share = this.init.plan.willShare;
    if (share.includes("name") && p.name) facts.navn = p.name;
    if (share.includes("phone") && p.phone) facts.telefon = p.phone;
    if (share.includes("email") && p.email) facts["e-post"] = p.email;
    if (share.includes("allergies") && p.allergies) facts.allergies = p.allergies;
    if (share.includes("address") && p.address) facts.adresse = "{{ADDRESS}}"; // resolved at the TTS step
    return {
      goal: this.init.plan.goal,
      calleeName: this.init.plan.callee.name,
      userName: p.name,
      // Only what this call may share AND the profile actually has (fnr comes from the call request).
      willShare: share.filter((k) => k === "fnr" ? !!this.init.secrets?.fnr : k === "birthdate" ? false : k === "name" ? !!p.name : !!p[k as "phone" | "address" | "email" | "allergies"]),
      needsApprovalFor: this.init.plan.needsApprovalFor,
      profileFacts: facts,
      tone: this.tone,
      simpler: this.simpler,
      history: [...this.history],
    };
  }

  private async runTurn(spec?: Spec) {
    this.turnRunning = true;
    this.wantTurn = false;
    const abort = new AbortController();
    this.turnAbort = abort;
    const t0 = this.lastCalleeAt || Date.now();
    let firstAudio = true;
    this.emit({ type: "agent_typing", at: Date.now() });
    const seg = new Segmenter(true);
    const said: string[] = [];
    let stop = false;
    let turnConfused = false;
    let saidBye = false;
    let spokeAnything = false;
    this.debug("turn_start", { history: this.history.at(-1) });
    if (this.lastProgressAt && !this.pending && Date.now() - this.lastProgressAt > config.unproductiveSec * 1000) {
      this.turnRunning = false;
      await this.wrapUp(`Kom ikke videre på ${Math.round(config.unproductiveSec / 60)} min; avsluttet høflig.`);
      return;
    }
    let backchannel = "";
    const turnNo = ++this.turnNo;
    const lastCallee = this.history.at(-1);
    const answeringCallee = lastCallee?.role === "callee";
    const askedQuestion = !!lastCallee && /\?\s*(⟨.*⟩)?$/.test(lastCallee.text);
    const mayBackchannel = answeringCallee && !askedQuestion && turnNo - this.lastBackchannelTurn >= BACKCHANNEL_EVERY;
    // A short cached «Ja.» / «Okei.» / «Skjønner.» only if real content still isn't ready at 1.2 s.
    const backTimer = mayBackchannel ? setTimeout(() => {
      if (spokeAnything || stop || abort.signal.aborted || this.ended || this.pending) return;
      const options = BACKCHANNELS.filter((b) => b !== this.lastBackchannel);
      backchannel = options[turnNo % options.length]!;
      this.lastBackchannel = backchannel;
      this.lastBackchannelTurn = turnNo;
      this.debug("backchannel", { text: backchannel });
      void this.say(backchannel, "filler");
    }, Math.max(0, BACKCHANNEL_MS - (Date.now() - t0))) : undefined;
    // Only fill silence when the reply is genuinely slow.
    const fillerTimer = setTimeout(() => {
      if (spokeAnything || backchannel || stop || abort.signal.aborted || this.ended || this.pending) return;
      const f = FILLERS.find((x) => x !== this.lastFiller) ?? FILLERS[0]!;
      this.lastFiller = f;
      this.debug("filler", { text: f, afterMs: FILLER_AFTER_MS });
      void this.say(f, "filler");
    }, FILLER_AFTER_MS);

    let waited = false;
    const handle = async (s: Segment) => {
      if (stop || abort.signal.aborted) return;
      // Nothing is said until the callee has really stopped (no half-sentences from cancelled turns).
      if (!waited && answeringCallee && (s.kind === "speech" || s.kind === "ask")) {
        waited = true;
        await this.waitForSilence(abort.signal);
        if (stop || abort.signal.aborted) return;
      }
      if (s.kind === "speech") {
        if (backchannel && !spokeAnything) {
          // "Ja," was already said: don't start the real reply with "Ja, …" again.
          const w = backchannel.replace(/[.,]$/, "");
          const stripped = s.text.replace(new RegExp(`^${w}[,!.]?\\s+`, "i"), "");
          if (stripped !== s.text && stripped.trim()) s = { ...s, text: stripped.charAt(0).toUpperCase() + stripped.slice(1) };
        }
        const deintro = this.withoutReintro(s.text);
        if (deintro !== s.text) {
          this.debug("reintro_removed", { original: s.text, kept: deintro });
          if (!deintro) return;
          s = { ...s, text: deintro };
        }
        // Times the agent says must come from the plan, the callee or the user, never invented.
        const bad = timesIn(s.text).filter((t) => !this.allowedTimes().has(t));
        if (bad.length) {
          this.debug("time_blocked", { text: s.text, bad });
          stop = true;
          spokeAnything = true;
          const q = "Hvilket klokkeslett mener du?";
          if (!this.recentTurns.some((r) => r.has(norm(q)))) { said.push(q); await this.say(q, "say", false, abort.signal); }
          return;
        }
        // Asking the shop about the goal again after 2 tries: ask the user instead (call #5 looped 5.5 min).
        if (this.isGoalAsk(s.text)) {
          if (this.goalAsks >= 2) {
            stop = true;
            spokeAnything = true;
            this.goalAsks = 0;
            this.debug("stuck_ask_user", { text: s.text });
            await this.requestApproval(this.stuckQuestion(), ["Godta det de tilbyr", "Prøv noe annet", "Legg på"], "stuck");
            return;
          }
          this.goalAsks++;
        }
        const commitment = isCommitment(s.text);
        if (commitment && this.approvalCredit <= 0) {
          // Safety: the model tried to commit without a yes from the user.
          this.note("Stoppet en forpliktelse som ikke var godkjent; spør deg først.", "warn");
          stop = true;
          await this.requestApproval(`Skal jeg si: «${s.text}»?`, ["JA", "NEI"], "commit");
          return;
        }
        if (commitment) this.approvalCredit--;
        // Never repeat a line from the previous turn; escalate instead of looping on "say again".
        const n = norm(s.text);
        const dup = this.recentTurns.some((t) => t.has(n));
        const confused = CONFUSED.test(s.text);
        if (confused || dup) {
          if (confused && !turnConfused) { turnConfused = true; this.confusedRun = this.recentConfused.slice(-3).filter(Boolean).length + 1; }
          const esc = this.escalation(dup);
          if (esc) {
            this.debug("escalate", { original: s.text, dup, confusedRun: this.confusedRun, replacement: esc.text });
            stop = true;
            spokeAnything = true;
            said.push(esc.text);
            await this.say(esc.text, "say", false, abort.signal);
            if (esc.end) this.endTag = { outcome: "failed", summary: "Forsto ikke mottakeren; avsluttet høflig." };
            return;
          }
          if (dup) { this.debug("skip_duplicate", { text: s.text }); return; }
        }
        spokeAnything = true;
        if (firstAudio && this.timing && !this.timing.awaitAudio) { this.timing.awaitTts = true; this.timing.awaitAudio = true; }
        if (firstAudio) { firstAudio = false; this.latencies.push(Date.now() - t0); }
        said.push(s.text);
        if (GOODBYE.test(s.text)) saidBye = true;
        const r = await this.say(s.text, "say", false, abort.signal);
        if (r.interrupted) stop = true;
        // After a goodbye nothing more is said: the rest of the reply is dropped and we hang up.
        if (saidBye) stop = true;
      } else if (s.kind === "ask") {
        stop = true;
        // The model asking again right after the user answered, with nothing new from the
        // callee in between, would loop the JA card. Treat it as already answered.
        const calleeSince = this.history.slice(Math.max(0, this.answeredAtHistory)).some((h) => h.role === "callee");
        if (this.answeredAtHistory >= 0 && !calleeSince) {
          this.debug("suppressed_reask", { question: s.question });
          if (this.reasked++ < 1) { this.wantTurn = true; this.history.push({ role: "user", text: "[instruks] Du har allerede fått svar på dette. Gi beskjed til mottakeren nå." }); }
          return;
        }
        await this.requestApproval(this.withContext(s.question), s.options, /^(ja|nei)$/i.test(s.options[0] ?? "") ? "commit" : "choice");
      } else if (s.kind === "note") {
        this.note(s.text);
      } else if (s.kind === "end") {
        const outcome = (["done", "partial", "failed", "refused", "no_answer"].includes(s.outcome) ? s.outcome : "partial") as Outcome;
        this.endTag = { outcome, summary: s.summary };
        stop = true;
      }
    };

    try {
      const llmStart = Date.now();
      const timing = this.timing;
      if (spec) abort.signal.addEventListener("abort", () => spec.abort.abort(), { once: true });
      const source = spec ? this.specTokens(spec) : this.init.llm.reply(this.ctx(), abort.signal, this.addUsage);
      for await (const tok of source) {
        if (abort.signal.aborted || stop) break;
        if (timing && timing.llmMs === null && tok.trim()) timing.llmMs = Date.now() - llmStart;
        for (const s of seg.push(tok)) await handle(s);
      }
      if (!abort.signal.aborted && !stop) for (const s of seg.end()) await handle(s);
    } catch (e) {
      if (!abort.signal.aborted) {
        console.error("[session] LLM failed:", (e as Error).message);
        this.note("KI-en svarte ikke i tide.", "warn");
        if (!spokeAnything) {
          const f = FILLERS.find((x) => x !== this.lastFiller) ?? FILLERS[0]!;
          this.lastFiller = f;
          await this.say(f, "filler");
        }
      }
    } finally {
      clearTimeout(fillerTimer);
      clearTimeout(backTimer);
      this.turnRunning = false;
      if (said.length) {
        this.recentTurns = [...this.recentTurns, new Set(said.map(norm))].slice(-3);
        this.recentConfused = [...this.recentConfused, turnConfused].slice(-4);
        this.confusedRun = this.recentConfused.filter(Boolean).length;
      }
      this.debug("turn_end", { said, confusedRun: this.confusedRun, aborted: abort.signal.aborted });
      // The model said goodbye but forgot [[END]]: hang up anyway (call #5 kept talking after «Ha det!»).
      if (saidBye && !this.endTag && !this.pending) {
        this.debug("goodbye_without_end", { said });
        await this.finish("agent said goodbye");
      } else if (this.endTag && !abort.signal.aborted) {
        await this.finish("agent ended");
      } else if (this.wantTurn && !this.pending) {
        void this.runTurn();
      }
    }
  }

  /**
   * What to say instead of a "say again" / repeated line, counted over the last 4 turns.
   * 1st: allowed as is. 2nd: rephrase the errand as a yes/no question. 3rd: end politely.
   */
  private escalation(dup: boolean): { text: string; end?: boolean } | null {
    const name = this.init.profile.name || "brukeren";
    if (this.confusedRun >= 3) {
      return { text: `Beklager, jeg hører deg dessverre ikke godt nok. ${name} tar kontakt på en annen måte. Ha det bra!`, end: true };
    }
    // Don't re-introduce ourselves (the callee complained on call #5); once per call.
    const rephrase = `Kort sagt: jeg vil gjerne ${this.init.plan.goal}. Går det, ja eller nei?`;
    if (this.confusedRun === 2 || dup) {
      if (this.rephrased || this.recentTurns.some((t) => t.has(norm(rephrase)))) {
        return { text: `Beklager, jeg hører deg dessverre ikke godt nok. ${name} tar kontakt på en annen måte. Ha det bra!`, end: true };
      }
      if (this.confusedRun === 2) this.note("Mottakeren er vanskelig å forstå; jeg prøver å spørre enklere.", "warn");
      this.rephrased = true;
      return { text: rephrase };
    }
    return null;
  }

  /** Speak through the safety filter; records the line in the transcript. */
  private async say(text: string, kind: "say" | "filler" = "say", canned = false, signal?: AbortSignal) {
    if (this.ended) return { interrupted: true };
    const f = filterOutgoing(text, {
      willShare: this.init.plan.willShare,
      fnr: this.init.secrets?.fnr,
      address: this.init.profile.address,
    });
    if (f.blocked) this.note(f.blocked, "warn");
    if (!f.text) return { interrupted: false };
    // What the user sees never contains the fnr itself.
    const shown = text.replaceAll("{{FNR}}", "[fødselsnummer]").replaceAll("{{ADDRESS}}", this.init.profile.address ?? "[adresse]");
    const shownSafe = text.includes("{{") && f.text !== FNR_REFUSAL ? shown : f.text;
    const id = nid("a");
    const at = Date.now();
    this.emit({ type: "transcript", id, who: "agent", text: shownSafe, final: false, at });
    this.speaking = true;
    let r = { interrupted: false };
    try {
      if (signal?.aborted) return { interrupted: true };
      r = await this.init.line.speak(f.text, kind);
    } catch (e) {
      console.error("[session] speak failed:", (e as Error).message);
      this.note("Talen feilet; prøver videre.", "warn");
    } finally {
      this.speaking = false;
    }
    this.emit({ type: "transcript", id, who: "agent", text: shownSafe, final: true, at: Date.now() });
    this.armSilenceNudge();
    this.transcript.push({ who: "agent", text: shownSafe, at });
    if (kind === "say" || canned) this.history.push({ role: "agent", text });
    return r;
  }

  /**
   * An approval card must say what is being approved. If the model's question has no
   * numbers (price, time) but the callee just said some, show the callee's words too.
   */
  private withContext(question: string): string {
    const lastCallee = [...this.history].reverse().find((h) => h.role === "callee")?.text ?? "";
    if (/\d/.test(question) || !/\d/.test(lastCallee)) return question;
    return `${question} (${this.init.plan.callee.name || "Mottakeren"}: «${lastCallee}»)`;
  }

  /**
   * The disclosure is said once, by code. After that the agent never re-introduces itself or
   * repeats «på vegne av {name}» unless the callee asks who is calling (call #5: callee complained).
   */
  private progress() {
    this.lastProgressAt = Date.now();
    this.goalAsks = 0;
  }

  /** A question to the callee about the errand itself («Har dere en stor pepperoni …?»). */
  private isGoalAsk(text: string): boolean {
    if (!/\?\s*$/.test(text)) return false;
    const keys = this.init.plan.goal.toLowerCase().match(/[\p{L}]{5,}/gu)?.filter((w) => !["bestille", "klokka", "gjerne"].includes(w)) ?? [];
    const t = text.toLowerCase();
    return keys.some((k) => t.includes(k));
  }

  /** Approval card text when the call is going in circles: what the callee has offered. */
  private stuckQuestion(): string {
    const said = this.history.filter((h) => h.role === "callee").slice(-2).map((h) => h.text.replace(/\s*⟨.*?⟩/g, ""));
    const who = this.init.plan.callee.name || "Mottakeren";
    const quote = said.join(" ").slice(-200);
    return `Vi kommer ikke videre. ${who} sier: «${quote}» Hva vil du?`;
  }

  /** Polite end as partial (unproductive call or the user chose to hang up). */
  private async wrapUp(summary: string) {
    if (this.ended) return;
    this.debug("wrap_up", { summary });
    this.note(summary, "warn");
    const name = this.init.profile.name || "brukeren";
    await this.say(`Takk for hjelpen så langt. Jeg gir beskjed til ${name}, så tar vi kontakt igjen. Ha det bra!`, "filler");
    await this.finish("wrap up", { outcome: "partial", summary });
  }

  /** «Si til Sverre at …» → a note for the user and a line in the result. */
  private checkMessage(id: string, text: string) {
    const name = this.init.profile.name;
    const re = new RegExp(`(?:si (?:til|fra til) (?:${name || "han"}|han|henne|ham)|hils (?:til )?(?:${name || "han"}|han|henne)|gi (?:${name || "han"}|han|henne) beskjed|gi beskjed til (?:${name || "han"}|han|henne)|(?:legg igjen|ta imot) (?:en )?(?:beskjed|melding)|melding til (?:${name || "han"}|han|henne))\\s*(?:at|om|:)?\\s*(.*)$`, "i");
    const m = text.match(re);
    if (!m) return;
    const msg = (m[1] || text).replace(/^["«»“”]+|["«»“”]+$/g, "").trim() || text;
    const had = this.messages.has(id);
    this.messages.set(id, msg);
    this.note(`Beskjed til ${name || "deg"}${had ? " (rettet)" : ""}: «${msg}»`, "info");
  }

  private allowedTimes(): Set<string> {
    const set = new Set(timesIn(this.init.plan.goal));
    for (const h of this.history) if (h.role !== "agent") for (const t of timesIn(h.text.replace(/⟨.*?⟩/g, ""))) set.add(t);
    return set;
  }

  withoutReintro(text: string): string {
    const name = this.init.profile.name;
    const lastCallee = [...this.history].reverse().find((h) => h.role === "callee")?.text ?? "";
    if (/hvem (er (du|det)|ringer)|på vegne av hvem|er du (en )?(robot|maskin|ki|menneske)|hva heter du|hvem snakker jeg med/i.test(lastCallee)) return text;
    let t = text;
    // Greetings after the opening.
    t = t.replace(/^(hei( igjen| der)?|hallo( igjen)?)[!,.]\s*/i, "");
    // Self-introductions.
    if (/KI-assistent|det er spoken|jeg heter spoken|jeg er (en )?(KI|AI|robot)/i.test(t)) {
      t = t.replace(/[^.!?]*(KI-assistent|det er spoken|jeg heter spoken|jeg er (en )?(KI|AI|robot))[^.!?]*[.!?]?\s*/gi, "");
    }
    const errandSaid = this.history.some((h) => h.role === "agent" && h !== this.history[0] && /jeg ringer|vil gjerne/i.test(h.text));
    if (name && errandSaid) {
      // «Jeg ringer på vegne av Sverre og vil gjerne X» → «Jeg vil gjerne X»; drop stray «på vegne av Sverre».
      t = t.replace(new RegExp(`jeg ringer (på vegne av ${name} )?(og|for å)\\s+(vil gjerne\\s+)?`, "i"), "Jeg vil gjerne ");
      t = t.replace(new RegExp(`,?\\s*på vegne av ${name}`, "gi"), "");
    }
    t = t.replace(/\s{2,}/g, " ").trim();
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
  }

  private onMetric(m: LineMetric) {
    const t = this.timing;
    if (!t) return;
    if (m.kind === "tts_first_byte" && t.awaitTts) { t.ttsMs = m.ms; t.awaitTts = false; return; }
    if (m.kind === "first_audio" && t.awaitAudio) {
      const from = t.speechEndAt && t.speechEndAt <= t.commitAt ? t.speechEndAt : t.commitAt;
      const ev: LatencyEvent = {
        type: "latency",
        sttMs: t.speechEndAt && t.speechEndAt <= t.commitAt ? t.commitAt - t.speechEndAt : null,
        llmMs: t.llmMs,
        ttsMs: t.ttsMs,
        totalMs: m.at - from,
        models: {
          stt: config.callProvider === "telnyx" ? "scribe_v2_realtime" : "mock",
          llm: this.init.llm.model ? `${this.init.llm.name}:${this.init.llm.model}` : this.init.llm.name,
          tts: config.callProvider === "telnyx" ? config.elevenlabs.ttsModel : "mock",
        },
        at: Date.now(),
      };
      this.timing = undefined;
      this.emit(ev as unknown as LiveEvent);
    }
  }

  /** If the callee says nothing for 8 s after we spoke, check the line once. */
  /** Resolves once the callee has been quiet SPEAK_AFTER_SILENCE_MS (max 3 s), or on abort. */
  private async waitForSilence(signal: AbortSignal) {
    const start = Date.now();
    while (!signal.aborted && !this.ended && Date.now() - start < 3000) {
      const quiet = this.init.line.silenceMs?.() ?? Infinity;
      if (quiet >= SPEAK_AFTER_SILENCE_MS) return;
      await Bun.sleep(Math.min(60, SPEAK_AFTER_SILENCE_MS - quiet));
    }
  }

  private armSilenceNudge() {
    clearTimeout(this.silenceTimer);
    if (this.ended || this.pending || this.nudged >= 2) return;
    const since = Date.now();
    this.silenceTimer = setTimeout(() => {
      if (this.ended || this.pending || this.speaking || this.turnRunning || this.lastCalleeAt > since) return;
      // Only after real silence: no voice energy for 8 s (call #5 nudged while the callee talked).
      const quiet = this.init.line.silenceMs?.() ?? Infinity;
      if (quiet < 8000 || this.lastPartialAt > since) { this.armSilenceNudge(); return; }
      this.nudged++;
      void this.say(this.nudged === 1 ? "Hallo, hører du meg?" : "Jeg hører deg dessverre ikke. Jeg prøver igjen senere. Ha det!", "filler").then(() => {
        if (this.nudged >= 2 && !this.ended) void this.finish("silence", { outcome: "failed", summary: "Hørte ingenting fra mottakeren." });
      });
    }, 8000);
  }

  private async requestApproval(question: string, options: string[], kind: PendingApproval["kind"], spoken = WAIT_PHRASE) {
    if (this.pending || this.ended) return;
    const id = nid("ap");
    this.pending = { id, question, options, kind };
    this.progress();
    this.waitingNoticeSaid = false;
    this.emit({ type: "approval_request", id, question, options, at: Date.now() });
    this.hold.arm(); // 30 s: ask the callee to hold; 2 min: offer a callback
    await this.say(spoken, "filler");
    if (this.pending?.id === id) this.init.line.startWaitingSound();
  }

  private answer(id: string, choice: string) {
    const p = this.pending;
    if (!p || p.id !== id) return;
    clearTimeout(p.timer);
    this.pending = undefined;
    this.init.line.stopWaitingSound();
    if (this.speaking) this.init.line.stopSpeaking(); // cut «Et øyeblikk…» if it is still playing
    this.reasked = 0;
    const yes = /^(ja|yes|ok)$/i.test(choice.trim());
    const no = /^(nei|no)$/i.test(choice.trim());
    if (p.kind === "address") {
      if (yes) this.init.plan.willShare.push("address");
      this.history.push({ role: "user", text: yes ? "[godkjent] Du kan oppgi adressen: {{ADDRESS}}" : "[avslått] Ikke oppgi adressen." });
    } else if (p.kind === "stuck") {
      if (/godta/i.test(choice)) this.approvalCredit = 1;
      this.history.push({ role: "user", text: /godta/i.test(choice)
        ? `[godkjent] Brukeren godtar det butikken tilbyr (${p.question}). Bekreft det kort.`
        : `[svar] ${choice}. Ikke gjenta det samme spørsmålet; prøv en annen løsning eller avslutt høflig.` });
    } else if (yes) {
      this.approvalCredit = 1;
      this.history.push({ role: "user", text: `[godkjent] ${p.question}` });
    } else if (no) {
      this.history.push({ role: "user", text: `[avslått] ${p.question}` });
    } else {
      this.history.push({ role: "user", text: `[svar] ${choice}` });
    }
    this.answeredAtHistory = this.history.length;
    this.progress();
    if (p.kind === "stuck" && /legg på/i.test(choice)) {
      void this.hold.resume().then(() => this.wrapUp("Brukeren valgte å legge på."));
      return;
    }
    // If the callee was asked to hold, thank them first («Takk for at du ventet!»), then go on.
    void this.hold.resume().then(() => this.requestTurn());
  }

  // ---------- client commands ----------

  command(cmd: LiveCommand) {
    if (this.ended) return;
    switch (cmd.type) {
      case "approval_response":
        this.answer(cmd.id, cmd.choice);
        break;
      case "instruction": {
        const text = cmd.text.trim().slice(0, 500);
        if (!text) return;
        this.history.push({ role: "user", text: `[instruks] ${text}` });
        this.progress();
        this.note(`Instruks sendt: ${text}`);
        if (!this.pending && !this.speaking) this.requestTurn();
        else if (!this.pending) this.wantTurn = true;
        break;
      }
      case "say_simpler":
        this.simpler = true;
        this.history.push({ role: "user", text: "[enklere] Si det forrige enklere." });
        if (!this.pending) this.requestTurn();
        break;
      case "tone":
        this.tone = cmd.tone;
        this.note(`Tone: ${{ friendly: "vennlig", firm: "bestemt", hurry: "rask" }[cmd.tone]}`);
        break;
      case "hangup":
        void this.userHangup();
        break;
    }
  }

  private async userHangup() {
    this.turnAbort?.abort();
    this.hold.cancel();
    if (this.pending) { clearTimeout(this.pending.timer); this.pending = undefined; this.init.line.stopWaitingSound(); }
    if (this.status === "connected") {
      if (this.speaking) this.init.line.stopSpeaking();
      await Promise.race([this.say("Jeg må dessverre avslutte nå. Takk, ha det bra!", "filler"), Bun.sleep(5000)]);
    }
    await this.finish("user hangup", { outcome: "partial", summary: "Avsluttet av deg." });
  }

  private async forceEnd(reason: string) {
    this.note(reason, "warn");
    await this.userHangup();
  }

  // ---------- end ----------

  async finish(reason: string, tag?: { outcome: Outcome; summary: string }) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.maxTimer);
    this.hold.cancel();
    clearTimeout(this.holdTimer);
    clearTimeout(this.gate?.timer);
    this.dropSpec("call ended");
    clearTimeout(this.silenceTimer);
    this.turnAbort?.abort();
    if (this.pending) clearTimeout(this.pending.timer);
    this.init.line.stopWaitingSound();
    try { await this.init.line.hangup(); } catch (e) { console.error("[session] hangup failed:", (e as Error).message); }

    const ctx = this.ctx();
    let s = mockSummary(ctx);
    if (this.connectedAt) {
      try {
        s = await Promise.race([this.init.llm.summarize(ctx, this.addUsage), Bun.sleep(8000).then(() => mockSummary(ctx))]);
      } catch { /* mock summary stays */ }
    }
    const tagIn = tag ?? this.endTag;
    let outcome: Outcome = tagIn?.outcome ?? s.outcome;
    if (!this.connectedAt) outcome = this.status === "failed" ? "failed" : "no_answer";
    const summary = !this.connectedAt
      ? (outcome === "no_answer" ? "Ingen svarte." : "Samtalen kunne ikke kobles opp.")
      : tag ? tag.summary : (s.summary || tagIn?.summary || "Samtalen er ferdig.");
    this.result = {
      callId: this.callId,
      taskId: this.taskId,
      outcome,
      summary,
      details: this.messages.size ? { ...s.details, beskjed: [...this.messages.values()].join(" / ") } : s.details,
      transcript: [...this.transcript],
      durationSec: this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) : 0,
    };
    if (this.latencies.length) {
      const avg = Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length);
      console.log(`[latency] call ${this.callId}: avg ${avg} ms over ${this.latencies.length} turns (${this.latencies.join(", ")})`);
    }
    console.log(`[session] ${this.callId} ended (${reason}): ${outcome}`);
    this.debug("ended", { reason, outcome, latencies: this.latencies, usage: this.usage });
    // One cost line per call. Telnyx reports its own price later as [cost] telnyx … (call.cost webhook).
    console.log(`[cost] call ${this.callId}: LLM $${this.usage.costUsd.toFixed(5)} (${this.usage.requests} req, ${this.usage.promptTokens} in / ${this.usage.completionTokens} out)` +
      (this.lineCost ? `, TTS ${this.lineCost.ttsChars} chars, STT ${this.lineCost.sttSec} s` : ""));
    this.debug("cost", { llm: this.usage, line: this.lineCost });
    this.status = "ended";
    this.emit({ type: "status", status: "ended", at: Date.now() });
    this.emit({ type: "result", result: this.result });
  }

  get isEnded() { return this.ended; }
}
