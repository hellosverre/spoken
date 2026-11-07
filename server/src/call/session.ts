// One live call: owns the transcript, the agent loop, approvals, barge-in and the
// safety gates between the LLM and the speaker. Works the same over mock and Telnyx lines.

import type {
  CallResult, CallStatus, Lang, LiveCommand, LiveEvent, Outcome, Plan, Profile, TranscriptLine, Word,
} from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { mockSummary } from "../llm/mock.ts";
import type { AgentContext, HistoryItem, LlmProvider, Tone, Usage } from "../llm/types.ts";
import {
  detectSecretAsk, ensureDisclosure, filterOutgoing, isCommitment, isDoneClaim,
} from "../safety.ts";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CallLine, LineMetric } from "./line.ts";
import { timeHint, timesIn, withoutTimes } from "../time.ts";
import { isNumberish, numberHint } from "./numbers.ts";
import { HoldFlow } from "./hold.ts";
import { LINES, langFromText } from "./lines.ts";
import { uiText } from "./ui-text.ts";
import { asksWhoTheyAre, endsSentence, errandParts, isEcho, isFillerOnly, isMeta, parseErrand, restatesErrand, shortenErrand, stripFillerPrefix, type Errand } from "./style.ts";
import { Segmenter, type Segment } from "./segment.ts";
import { asksUserWhereCallee, fixCardOptions, priceWarning } from "./approval.ts";

export const WAIT_PHRASE = LINES.no.wait;

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

/** A quiet voice: maybe the callee, maybe someone near them (c_73b6b5529e9b). */
const FAINT_HINT = "⟨svak stemme⟩";
// Agent lines that mean "I didn't get that". Two turns of these in a row → change strategy.
const CONFUSED = /(si det en gang til|kan du gjenta|forsto (deg )?ikke|hørte (deg )?ikke|linja er (litt )?dårlig|unnskyld,? hva sa du|say that again|could you repeat|can you repeat|didn't (quite )?(catch|hear|understand)|the line is (a bit )?bad|sorry,? what did you say)/i;
// Short fillers for when a reply is slow (> FILLER_AFTER_MS). Rotated, never the same twice in a row.
// Never «Et øyeblikk» again and again (call #8): short, different, at most 2 per call.
// The lines themselves are in lines.ts, per call language.
const MAX_FILLERS = 2;
// Extras the plan didn't cover: the user decides, not the agent (call #8: «Ingen drikke»).
const EXTRAS_Q = /\b(drikke|brus|cola|tillegg|ekstra|dressing|saus|dip|bunn|størrelse|dessert|salat|hvitløk|ost|topping|glutenfri|levering|drinks?|soda|coke|extras?|sauce|crust|size|salad|garlic|cheese|toppings?|gluten[- ]free|delivery)\b/i;
const FILLER_AFTER_MS = 2500;
// Instant cached backchannel when content is not ready this long after the callee's commit.
// Backchannel only when the reply is clearly slow, at most once every 3 turns, never after a
// question (Sverre, call #5: «mm» after everything sounded robotic).
// First backchannel of a call if the reply isn't ready at 1.2 s; later ones only past 2 s.

const BACKCHANNEL_LATER_MS = 2000;
const BACKCHANNEL_EVERY = 3;
// Don't start talking until the callee has been quiet this long (call #5: half-sentences from
// turns that were cancelled because the callee was still talking).
// Adaptive end of turn: people answer questions fast, but a statement («Flott.») is often
// followed by more («Hvilket navn …?»), so wait a little longer after statements.
// Sverre's test: «Okay? … jeg er et lite barn» got two replies at 300/550 ms. A bit slower, and
// one- or two-word lines («Okay?», «Ja, men») wait like statements: more usually follows.
const SPEAK_AFTER_QUESTION_MS = Number(process.env.SPEAK_AFTER_QUESTION_MS ?? 500);
const SPEAK_AFTER_SILENCE_MS = Number(process.env.SPEAK_AFTER_SILENCE_MS ?? 800);
// A one- or two-word line waits this long for the rest of the sentence before we answer.
const HOLD_SHORT_MS = Number(process.env.HOLD_SHORT_MS ?? 700);
// Opening. In Norway the person answering speaks first («Domino's, du snakker med Vil»); our
// disclosure used to start on connect and get cut by that greeting (c_28dd2d9a6285).
// Wait for the greeting to end (GREETING_GAP_MS of quiet), or GREETING_WAIT_MS if nobody speaks,
// never longer than GREETING_MAX_MS. The disclosure itself can't be interrupted: they must hear it.
// Lines heard over the disclosure below this mean confidence are taken as echo.
const OPENING_ECHO_CONF = Number(process.env.OPENING_ECHO_CONF ?? 0.6);
const GREETING_WAIT_MS = Number(process.env.GREETING_WAIT_MS ?? 3000);
const GREETING_GAP_MS = Number(process.env.GREETING_GAP_MS ?? 600);
const GREETING_MAX_MS = Number(process.env.GREETING_MAX_MS ?? 8000);
// After the disclosure: give them a moment to answer («ja?», «nei takk») before stating the errand.
const AFTER_OPENING_MS = Number(process.env.AFTER_OPENING_MS ?? 2000);
// Speculative LLM on partials: 0 of 62 matched on call #5, so off unless SPECULATE=1.
const SPECULATE = process.env.SPECULATE === "1";
// Callee says only «ja»/«mm» while we're mid-turn: listening noise, not a new turn.
const CALLEE_BACKCHANNEL = /^(ja|jo|mm+|mhm|hm+|okei|ok|okay|ja ja|aha|å|åh|eh|ehm|yes|yeah|yep|uh[- ]huh|right|um|uh)[.!,]?$/i;
const GOODBYE = /\b(ha det( bra| godt)?|ha en (fin|god|strålende) (dag|kveld|helg)|goodbye|bye|have a (nice|good|great) (day|evening|weekend))\b/i;
// Unsure words worth waiting ~0.7 s for a batch re-transcription: numbers and real content words.
// Words where a mishearing changes the meaning: numbers, negations, names. Only these make us
// wait for the batch second opinion; everything else is answered from realtime and corrected silently.
const WHO_ARE_YOU = /(hvem (er (du|det)|ringer|snakker jeg med)|hvor ringer du fra|hvor (kom|kommer) du fra|hva (er (dette|det her)|slags (samtale|tjeneste))|er du (en )?(robot|maskin|ki|data|menneske|ekte)|who (is this|are you|am i (speaking|talking) (to|with))|where are you calling from|what is this( about| call)?|are you (an? )?(robot|machine|ai|bot|human|real person))/i;
const NUMBER_WORDS = /^(null|en|ett|én|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|elleve|tolv|tretten|fjorten|femten|seksten|sytten|atten|nitten|tjue\p{L}*|tretti\p{L}*|førti\p{L}*|femti\p{L}*|hundre\p{L}*|tusen|halv|kvart|kroner|kr)$/iu;
const NEGATIONS = /^(ikke|ikkje|ekte|ingen|inga|ingenting|aldri|nei|nope|verken)$/i;
export function isContentWord(raw: string, sentenceStart = false): boolean {
  const w = raw.replace(/[.,!?«»"]/g, "");
  if (!w) return false;
  if (/\d/.test(w) || NUMBER_WORDS.test(w) || NEGATIONS.test(w)) return true;
  return !sentenceStart && /^\p{Lu}/u.test(w) && w.length >= 3; // a name mid-sentence
}
const COMMIT_VERBS = /^(bestill|bekreft|book|godta|avbestill|kanseller|betal|reserver|legg|takk|gjerne|bare|klokka|henting)/;
const FILLER_WORDS = new Set(["det", "den", "jeg", "du", "vi", "de", "ha", "har", "er", "var", "ja", "nei", "og", "en", "et", "så", "bare", "da", "eh", "ehm", "øh", "mm", "hm", "ikke", "kan", "vil", "må", "med", "på", "til", "som", "nå", "jo", "okei", "ok"]);
// Start the LLM on a partial that has been stable this long (speculative turn).
const SPEC_AFTER_MS = Number(process.env.SPEC_AFTER_MS ?? 200);
// Callee text that sounds cut off mid-sentence: wait this long for more before answering.
const HOLD_MS = 450;
// Word confidences arrive ~20 ms after the commit; batch revisions ~0.7 s.
const WORDS_WAIT_MS = 250; // call #6: confidences came 130 ms after the commit
const REVISION_WAIT_MS = Number(process.env.REVISION_WAIT_MS ?? 800);
// Think while the batch second opinion runs; only the speaking waits for it (c_cc7521a0c46d:
// median reply 2.4 s, of which 0.8 s was this wait before the LLM even started). OVERLAP_BATCH=0 = old way.
const OVERLAP_BATCH = process.env.OVERLAP_BATCH !== "0";
// When speech waits for the batch check. «numbers» (default): only for an unsure number, price or
// time, since those end up on approval cards. Other fixes arrive afterwards: the transcript is
// patched and the LLM sees the corrected line next turn. «content» = the old rule (any unsure
// noun or name, ~0.8 s on most lines), «off» = never wait.
const BATCH_HOLD = (process.env.BATCH_HOLD ?? "numbers") as "numbers" | "content" | "off";
// The callee «talked over» us but said nothing real (noise, «mm»): say the cut sentence again.
const BARGE_RESUME_MS = Number(process.env.BARGE_RESUME_MS ?? 1500);
const PLAIN_NO = /^(nei|nei takk|nei,? (takk|det vil jeg ikke|det går ikke)|no|no thanks|no,? thank you)[.!]?$/i;
const REFUSAL_HINT = "⟨svar på om de vil snakke med en KI⟩";
/** Talk this close to the end of our line doesn't cut it. */
const BARGE_TAIL_MS = Number(process.env.BARGE_TAIL_MS ?? 400);
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

/** One agent turn = one transcript line, however many clauses it is spoken in. */
interface TurnLine { id: string; at: number; parts: string[] }

interface Spec {
  key: string;
  abort: AbortController;
  tokens: string[];
  done: boolean;
  error?: unknown;
  wake?: () => void;
}

/** Word-overlap similarity 0..1 of two normalised strings. */
function similar(a: string, b: string): number {
  const A = new Set(a.split(" ").filter((w) => w.length > 2)), B = new Set(b.split(" ").filter((w) => w.length > 2));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
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
  /** Per-call limit in seconds (≤ MAX_CALL_SEC). */
  maxSec?: number;
  /** What the user typed: times in it («halv sju») may be said even if the plan dropped them. */
  taskText?: string;
  /** Approved for this call only; never put into the LLM context. */
  secrets?: { fnr?: string };
  /** Compare legs only ask (price, time): «done» needs no approved deal. */
  infoOnly?: boolean;
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
  /** Language spoken on the phone (Plan.callLang); the user can switch it mid-call. */
  private lang: Lang;
  private get L() { return LINES[this.lang]; }
  /** What the app shows the user, in the app language. */
  private get U() { return uiText(this.init.profile.lang); }
  private simpler = false;
  private speaking = false;
  private turnAbort?: AbortController;
  private turnRunning = false;
  private wantTurn = false;
  private pending?: PendingApproval;
  private approvalCredit = 0;
  private startedAt = 0;
  private connectedAt = 0;
  private openingPending = false; // from connect until the disclosure has been said
  private openingSpeaking = false; // the disclosure is playing: no barge-in
  // Segments heard while the disclosure played. Unsure ones are our own voice echoing back
  // (c_252ff0f258ce: «Nei, jeg...» 0.55, «Jeg kan ikke det.» 0.27 → hung up as «refused»).
  private overOpening = new Set<string>();
  private refusalChecked = false;
  private lastGreeting = "";
  private ended = false;
  private endTag?: { outcome: Outcome; summary: string };
  private voicemail = false;
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
  private repeats = new Map<string, number>(); // agent lines said again, by normalised text
  private turnSpoke = false; // the running turn has started speaking
  private errand: Errand;
  private errandStated = false;
  private backchannels = 0;
  private fillers = 0;
  private waitLines = 0; // how many approval-wait lines were said this call
  private lastApprovalAt = 0;
  private answered: { q: string; choice: string }[] = []; // approval questions the user answered
  private approvedCommit = false;
  private approvedItems: string[] = []; // normalised texts of approved commitments
  private confirmedByCallee = false;
  private goalAsks = 0; // agent questions about the goal since the last progress
  private lastProgressAt = 0;
  private messages = new Map<string, string>(); // callee segment id → message for the user
  private lastBackchannelTurn = -99;
  private answeredAtHistory = -1; // history length when the user last answered an approval
  private reasked = 0;
  private usage = { promptTokens: 0, completionTokens: 0, costUsd: 0, requests: 0 };
  private cachedTokens = 0;
  private lastLlmAt = 0;
  private warmTimer?: ReturnType<typeof setInterval>;
  private addUsage = (u: Usage) => {
    this.cachedTokens += u.cachedTokens ?? 0;
    this.lastLlmAt = Date.now();
    this.usage.promptTokens += u.promptTokens;
    this.usage.completionTokens += u.completionTokens;
    this.usage.costUsd += u.costUsd ?? 0;
    this.usage.requests++;
  };
  private nudged = 0;
  /** Speech waits for the batch second opinion on this callee segment (the LLM already runs). */
  private speakHold?: { id: string; done: Promise<void>; release: () => void };
  /** The reply the callee cut off, if they turn out to have said nothing. */
  private cutLine?: { text: string; at: number; resumed?: boolean };
  private cutTimer?: ReturnType<typeof setTimeout>;

  private hold: HoldFlow;

  constructor(private init: SessionInit) {
    this.callId = init.callId;
    this.taskId = init.taskId;
    this.errand = parseErrand(init.plan.goal, init.profile.name);
    this.lang = init.plan.callLang ?? "no";
    this.hold = new HoldFlow({
      userName: init.profile.name,
      lines: () => this.L.hold,
      notes: () => this.U.hold,
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
    this.init.line.prefetch?.([this.opening(), this.L.wait, this.L.card, ...this.L.backchannels]);
    void this.init.llm.warm?.();
    // Keep the LLM's TLS connection warm while the call is up (no request for 20 s → ping).
    this.warmTimer = setInterval(() => {
      if (!this.ended && Date.now() - this.lastLlmAt > 20_000) void this.init.llm.warm?.();
    }, 20_000);
    const maxSec = Math.min(config.maxCallSec, this.init.maxSec ?? config.maxCallSec);
    this.maxTimer = setTimeout(() => this.forceEnd(this.U.summary.maxTime(maxSec >= 60 ? `${Math.round(maxSec / 60)} min` : `${maxSec} s`)), maxSec * 1000);
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
          this.onCalleeFinal(id, text, words, meta?.faint);
        },
        metric: (m) => this.onMetric(m),
        cost: (c) => { this.lineCost = c; },
        level: (who, rms) => this.emitLive({ type: "level", who, rms, at: Date.now() }),
        calleeWords: (id, text, words) => {
          this.emit({ type: "transcript", id, who: "callee", text, final: true, words, at: Date.now() });
          this.onWords(id, words);
        },
        calleeRevised: (id, text, words) => this.onRevised(id, text, words),
        calleeNoise: (id) => this.onNoise(id),
        calleeBatchDone: (id) => this.releaseSpeech(id),
        voicemail: () => this.onVoicemail(),
        ended: (reason) => void this.finish(reason),
        debug: (kind, data) => this.debug(kind, data),
      });
    } catch (e) {
      console.error("[session] line start failed:", (e as Error).message);
      this.note(this.U.note.cantCall((e as Error).message), "warn");
      this.setStatus("failed");
      await this.finish("failed", { outcome: "failed", summary: this.U.summary.notConnected });
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

  private opening() {
    // The plan's opening is kept only if it is in the call's language; the disclosure is rebuilt.
    const other = this.lang === "en" ? /KI-assistent/i : /AI assistant/i;
    const op = this.init.plan.opening;
    return ensureDisclosure(other.test(op) ? "" : op, this.init.profile.name, this.lang);
  }

  /** Telnyx (or the model) says a machine answered: hang up without leaving a message. */
  private onVoicemail() {
    if (this.ended || this.voicemail) return;
    // A machine verdict after a real exchange is a false positive (long business greeting): ignore it.
    if (this.errandStated) {
      this.debug("voicemail_ignored", {});
      return;
    }
    this.voicemail = true;
    this.debug("voicemail", {});
    this.note(this.voicemailText(), "info");
    void this.finish("voicemail", { outcome: "no_answer", summary: this.voicemailText() });
  }

  private voicemailText() {
    return this.init.profile.lang === "en" ? "Nobody answered (voicemail). Try again later?" : "Ingen svarte (telefonsvarer). Prøv igjen senere?";
  }

  private async sayOpening() {
    // The disclosure is generated here, not by the model, and always goes first.
    const opening = this.opening();
    const line = this.init.line;
    if (!line.answersFirst) { await this.say(opening); return; }
    this.openingPending = true;
    const greeted = await this.waitForGreeting();
    if (this.ended) return;
    this.debug("opening_start", { greeted, waitedMs: Date.now() - this.connectedAt });
    this.openingSpeaking = true;
    try { await this.say(opening); } finally { this.openingSpeaking = false; this.openingPending = false; }
    if (this.ended) return;
    // They spoke over the disclosure («nei», «hvem er det?»): answer that now.
    if (this.overOpening.size) { this.requestTurn(); return; }
    // Otherwise give them a moment, then state the errand ourselves.
    const at = this.lastCalleeAt;
    setTimeout(() => {
      if (this.ended || this.lastCalleeAt !== at || this.turnRunning || this.speaking || this.pending) return;
      if ((line.silenceMs?.() ?? Infinity) < 300) return; // they're talking; their final will start the turn
      this.debug("after_opening_silence", {});
      this.requestTurn();
    }, AFTER_OPENING_MS);
  }

  /** Resolves when the callee's greeting is over (true), or nobody greeted in time (false). */
  private waitForGreeting(): Promise<boolean> {
    const start = Date.now();
    return new Promise((resolve) => {
      const tick = setInterval(() => {
        const waited = Date.now() - start;
        const quiet = this.init.line.silenceMs?.() ?? Infinity;
        const greeted = this.lastCalleeAt >= start;
        // «Hei, dette er …» stops mid-sentence: give them twice the gap to finish it.
        const gap = greeted && soundsUnfinished(this.lastGreeting) ? 2 * GREETING_GAP_MS : GREETING_GAP_MS;
        const done = this.ended
          || (greeted && quiet >= gap)
          || (!greeted && waited >= GREETING_WAIT_MS && quiet >= GREETING_GAP_MS)
          || waited >= GREETING_MAX_MS;
        if (done) { clearInterval(tick); resolve(greeted); }
      }, 50);
    });
  }

  // ---------- callee side ----------

  private onCalleeSpeech() {
    if (this.openingSpeaking) return; // the disclosure always plays to the end
    // Barge-in: the callee talks over us → stop audio at once and drop the rest of the turn.
    // Loud at the very end of our line (c_13c78747ac98): the line was said; let it finish.
    if (this.speaking && (this.init.line.speechLeftMs?.() ?? Infinity) < BARGE_TAIL_MS) {
      this.debug("barge_in_at_end");
      return;
    }
    if (this.speaking) {
      console.log(`[barge-in] callee spoke over the agent; TTS stopped (call ${this.callId})`);
      this.debug("barge_in");
      this.init.line.stopSpeaking();
      this.turnAbort?.abort();
    }
  }

  private faintIds = new Set<string>();

  private onCalleeFinal(id: string, text: string, words?: Word[], faint = false) {
    const clean = text.trim();
    if (!clean || this.ended) return;
    this.lastCalleeAt = Date.now();
    this.nudged = 0;
    clearTimeout(this.silenceTimer);
    this.emit({ type: "transcript", id, who: "callee", text: clean, final: true, words, at: this.lastCalleeAt });
    this.transcript.push({ who: "callee", text: clean, at: this.lastCalleeAt });
    // Times are parsed in code and handed to the LLM as facts («⟨tid: 19:00⟩»).
    const hint = timeHint(clean);
    if (faint) this.faintIds.add(id);
    // A bare «Nei» right after «Du kan gjerne si nei til å snakke med meg» is the answer to that.
    const prevAgent = [...this.history].reverse().find((h) => h.role === "agent")?.text ?? "";
    const refusal = /\b(si nei til å snakke med meg|say no to talking to me)\b/i.test(prevAgent) && PLAIN_NO.test(clean) ? REFUSAL_HINT : "";
    const item: HistoryItem = { role: "callee", text: [clean, hint, refusal, faint ? FAINT_HINT : ""].filter(Boolean).join(" ") };
    this.history.push(item);
    this.segItems.set(id, item);
    this.checkMessage(id, clean);
    // Greeting, or talk over the disclosure: it's in the history; sayOpening decides what's next.
    if (this.openingPending) {
      if (this.openingSpeaking) this.overOpening.add(id);
      else this.lastGreeting = clean;
      this.debug("held_for_opening", { text: clean, speaking: this.openingSpeaking });
      return;
    }
    if ((this.turnRunning || this.speaking) && CALLEE_BACKCHANNEL.test(clean)) {
      this.debug("callee_backchannel_ignored", { text: clean });
      return;
    }
    // «Mm.» right after it cut us off: not a new turn, finish the sentence.
    if (this.cutLine && !this.cutLine.resumed && Date.now() - this.cutLine.at < 5000 && CALLEE_BACKCHANNEL.test(clean)) {
      this.debug("callee_backchannel_after_cut", { text: clean });
      this.history.pop(); // not part of the conversation
      this.scheduleResume(200);
      return;
    }
    if (this.speakHold && this.speakHold.id !== id) this.speakHold.release();
    if (this.speaking) this.onCalleeSpeech();

    if (this.pending) {
      // We already said one wait line; stay quiet until the user answers or the hold flow (30 s) takes over.
      this.hold.onCallee(clean);
      return;
    }

    // After the user approved the deal, a clear yes from the callee is what makes the result «done».
    if (this.approvedCommit && !/\?|\b(ikke|nei|feil|galt|stemmer ikke|not|no|wrong|can'?t|cannot)\b/i.test(clean) &&
        /\b(ja|jo|greit|fint|supert|perfekt|flott|notert|klar|i orden|det går|skal bli|ordner|yes|yeah|sure|great|lovely|perfect|done|noted|ready|all set|will do|sounds good|no problem)\b/i.test(clean)) {
      this.confirmedByCallee = true;
    }

    // A plain «Nei» to our own question about the errand or price: the user decides what next
    // (call #9 ended with «jeg hører deg dessverre ikke» after a clear «Nei» about the price).
    const lastAgent = [...this.history].reverse().find((h) => h.role === "agent")?.text ?? "";
    if (/^(nei|nei takk|nei,? (det|den) (går|kan|blir) (vi )?ikke|det går (dessverre )?ikke|det kan vi (dessverre )?ikke|nei,? dessverre)[.!]?$/i.test(clean) &&
        /\?\s*$/.test(lastAgent) && (this.isGoalAsk(lastAgent) || /\b(kr|kroner|koster|pris|mulig|går det)\b/i.test(lastAgent))) {
      this.debug("callee_no_to_user", { text: clean, question: lastAgent });
      void this.requestApproval(`${this.init.plan.callee.name || "De"} sa «${clean}» til: «${lastAgent}» Hva vil du?`, ["Prøv noe annet", "Legg på"], "stuck");
      return;
    }

    // Questions about extras the plan doesn't cover → ask the user (Nei / Ja / write), don't decide.
    const extra = clean.match(EXTRAS_Q)?.[1];
    if (extra && /\?|^(hva|vil|skal|ønsker|trenger)\b/i.test(clean) && !new RegExp(extra, "i").test(this.init.plan.goal)) {
      this.debug("extras_to_user", { text: clean });
      void this.requestApproval(`${this.init.plan.callee.name || "De"} spør: «${clean.replace(/\s*⟨.*?⟩/g, "")}»`, ["Nei", "Ja", "Skriv svar"], "choice");
      return;
    }

    // «Hvem er du? / Hvor ringer du fra?»: a fixed, natural answer instead of whatever the model says.
    if (WHO_ARE_YOU.test(clean)) {
      const name = this.init.profile.name || this.L.user;
      const line = this.L.whoAreYou(name, this.init.plan.goal);
      if (!this.recentTurns.some((t) => t.has(norm(line)))) {
        this.debug("who_are_you", { text: clean });
        this.recentTurns = [...this.recentTurns, new Set([norm(line)])].slice(-3);
        void this.say(line, "say", true);
        return;
      }
    }
    const ask = detectSecretAsk(clean);
    if (ask === "card") {
      this.note(this.U.note.refusedCard, "warn");
      void this.say(this.L.card, "say", true);
      return;
    }
    if (ask === "fnr" && !(this.init.plan.willShare.includes("fnr") && this.init.secrets?.fnr)) {
      this.note(this.U.note.refusedFnr, "warn");
      void this.say(this.L.fnr, "say", true);
      return;
    }
    if (ask === "address" && !this.init.plan.willShare.includes("address")) {
      if (/\b(hent|pick ?up|collect)/i.test(this.init.plan.goal)) { void this.say(this.L.pickupNoAddress, "say", true); return; }
      void this.requestApproval("Mottakeren spør etter adressen din. Kan jeg oppgi den?", ["JA", "NEI"], "address", this.L.address);
      return;
    }
    // The running turn hasn't said anything yet: drop it and answer this line too
    // (c_13c78747ac98 answered the disclosure and ignored the «Nei.» that came 30 ms earlier).
    clearTimeout(this.holdTimer);
    if (this.turnRunning && !this.turnSpoke) {
      this.debug("turn_restart_on_new_line", { text: clean });
      this.requestTurn();
      return;
    }
    // Short VAD window: a pause after "Det blir…" must not start our turn.
    if (soundsUnfinished(clean)) {
      this.debug("hold_unfinished", { text: clean });
      this.holdTimer = setTimeout(() => { this.holdTimer = undefined; if (this.segItems.has(id)) this.requestTurn(); }, HOLD_MS);
      return;
    }
    // «Okay?» / «Ja, men» on its own: give the callee a moment to go on before we answer.
    // Only on a line that measures voice (real calls); scripted test lines report Infinity.
    if (clean.replace(/\s*⟨.*?⟩/g, "").trim().split(/\s+/).length <= 2 && Number.isFinite(this.init.line.silenceMs?.() ?? Infinity)) {
      this.debug("hold_short", { text: clean });
      const id0 = id;
      // Batch may call it noise meanwhile («Okei.» in c_13c78747ac98): then there is nothing to answer.
      this.holdTimer = setTimeout(() => { this.holdTimer = undefined; if (this.segItems.has(id0)) this.startGate(id0); }, HOLD_SHORT_MS);
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
    if (this.overOpening.has(id) && words.length && words.reduce((a, w) => a + w.confidence, 0) / words.length < OPENING_ECHO_CONF) {
      this.debug("opening_echo", { id });
      this.onNoise(id);
      return;
    }
    const unsure = words.filter((w) => w.confidence < 0.6).map((w) => w.text.replace(/[.,!?]$/, ""));
    const numHint = numberHint(words);
    const gate = this.gate?.id === id ? this.gate : undefined;
    if (!unsure.length && !numHint) { gate?.go(); return; }
    const item = this.segItems.get(id);
    if (item && !/⟨(usikre ord|uklart tall)/.test(item.text)) {
      item.text = [item.text, numHint, unsure.length ? `⟨usikre ord: ${unsure.join(", ")}⟩` : ""].filter(Boolean).join(" ");
    }
    this.debug("unsure_words", { id, unsure, numHint: numHint || undefined });
    if (this.spec) this.dropSpec("unsure words");
    // Wait for the batch second opinion only if an unsure word matters (a number, a name, a noun);
    // on a real line nearly every segment has some unsure filler word (call #4).
    const matters = BATCH_HOLD === "off" ? false
      : BATCH_HOLD === "content" ? !!numHint || unsure.some((w) => isContentWord(w))
      : !!numHint || unsure.some((w) => isNumberish(w));
    if (!gate) return;
    if (!matters) { gate.go(); return; }
    clearTimeout(gate.timer);
    if (OVERLAP_BATCH) {
      this.holdSpeech(id);
      gate.go();
      return;
    }
    gate.timer = setTimeout(gate.go, REVISION_WAIT_MS);
  }

  /** Batch STT disagreed with realtime: fix the transcript, the result card and what the LLM sees. */
  private onRevised(id: string, text: string, words: Word[]) {
    const clean = text.trim();
    if (!clean || this.ended) return;
    this.emit({ type: "transcript", id, who: "callee", text: clean, final: true, words, at: Date.now() });
    const item = this.segItems.get(id);
    const before = item?.text.replace(/\s*⟨.*?⟩/g, "") ?? "";
    if (item) {
      const line = this.transcript.find((t) => t.who === "callee" && t.text === before);
      if (line) line.text = clean;
      const unsure = words.filter((w) => w.confidence < 0.6).map((w) => w.text.replace(/[.,!?]$/, ""));
      const hint = timeHint(clean);
      item.text = [clean, hint, numberHint(words), unsure.length ? `⟨usikre ord: ${unsure.join(", ")}⟩` : "", this.faintIds.has(id) ? FAINT_HINT : ""].filter(Boolean).join(" ");
    }
    this.debug("stt_revised", { id, text: clean });
    // Batch changed the line we're answering and nothing has been said yet: answer the corrected text.
    if (this.turnRunning && !this.turnSpoke && item && this.history.at(-1) === item && !this.pending && this.contentChanged(before, clean)) {
      this.debug("turn_restart_on_revision", { id });
      this.requestTurn();
    }
    if (this.messages.has(id)) this.checkMessage(id, clean);
    if (this.gate?.id === id) this.gate.go();
    this.releaseSpeech(id);
  }

  /** Batch STT heard only noise: the line never happened. Take it back out and don't answer it. */
  private onNoise(id: string) {
    const item = this.segItems.get(id);
    if (!item || this.ended) return;
    const before = item.text.replace(/\s*⟨.*?⟩/g, "");
    const answering = this.turnRunning && !this.turnSpoke && this.history.at(-1) === item;
    const i = this.history.indexOf(item);
    if (i >= 0) this.history.splice(i, 1);
    const t = this.transcript.findIndex((l) => l.who === "callee" && l.text === before);
    if (t >= 0) this.transcript.splice(t, 1);
    this.segItems.delete(id);
    this.overOpening.delete(id);
    this.emit({ type: "transcript", id, who: "callee", text: "", final: true, at: Date.now() });
    this.debug("stt_noise", { id, text: before });
    if (this.gate?.id === id) { clearTimeout(this.gate.timer); this.gate = undefined; }
    if (this.spec) this.dropSpec("noise");
    if (answering) { this.turnAbort?.abort(); this.wantTurn = false; }
    this.releaseSpeech(id);
    // The «barge-in» was this noise: finish what we were saying.
    if (this.cutLine && Date.now() - this.cutLine.at < 5000) this.scheduleResume(300);
  }

  /** The agent may think now, but must not speak until batch STT has checked segment `id`. */
  private holdSpeech(id: string) {
    this.speakHold?.release();
    let release!: () => void;
    const done = new Promise<void>((r) => { release = r; });
    const hold = { id, done, release: () => { clearTimeout(timer); if (this.speakHold === hold) this.speakHold = undefined; release(); } };
    const timer = setTimeout(hold.release, REVISION_WAIT_MS);
    this.speakHold = hold;
  }

  private releaseSpeech(id: string) {
    if (this.speakHold?.id === id) this.speakHold.release();
  }

  /** Waits for a pending batch check (max REVISION_WAIT_MS), or the turn's abort. */
  private async waitSpeakHold(signal: AbortSignal) {
    const h = this.speakHold;
    if (!h) return;
    const t0 = Date.now();
    await Promise.race([h.done, new Promise<void>((r) => signal.addEventListener("abort", () => r(), { once: true }))]);
    this.debug("speak_hold", { id: h.id, waitedMs: Date.now() - t0 });
  }

  /** Re-say the cut-off reply if the callee stays quiet (their «barge-in» was noise or «mm»). */
  private scheduleResume(ms: number) {
    clearTimeout(this.cutTimer);
    const cut = this.cutLine;
    if (!cut || cut.resumed) return;
    this.cutTimer = setTimeout(() => {
      if (this.cutLine !== cut || cut.resumed || this.ended || this.pending || this.turnRunning || this.speaking) return;
      const last = this.history.at(-1);
      // They said something real since: that gets its own answer.
      if (this.lastCalleeAt > cut.at && last?.role === "callee" && !CALLEE_BACKCHANNEL.test(last.text.replace(/\s*⟨.*?⟩/g, "").trim())) return;
      if ((this.init.line.silenceMs?.() ?? Infinity) < 500) { this.scheduleResume(400); return; }
      cut.resumed = true;
      this.debug("barge_in_resumed", { text: cut.text });
      void this.say(cut.text, "say");
    }, ms);
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
    return this.status === "connected" && !this.openingPending && !this.pending && !this.turnRunning && !this.speaking && !this.ended;
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
      lang: this.lang,
      uiLang: this.init.profile.lang,
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
    let interrupted = false;
    this.debug("turn_start", { history: this.history.at(-1) });
    if (this.lastProgressAt && !this.pending && Date.now() - this.lastProgressAt > config.unproductiveSec * 1000) {
      this.turnRunning = false;
      await this.wrapUp(this.U.summary.stuck(Math.round(config.unproductiveSec / 60)));
      return;
    }
    let backchannel = "";
    const turnNo = ++this.turnNo;
    const lastCallee = this.history.at(-1);
    const answeringCallee = lastCallee?.role === "callee";
    const askedQuestion = !!lastCallee && /\?\s*(⟨.*⟩)?$/.test(lastCallee.text);
    const mayBackchannel = config.backchannelMs > 0 && answeringCallee && !askedQuestion && turnNo - this.lastBackchannelTurn >= BACKCHANNEL_EVERY;
    const backAfter = this.backchannels === 0 ? config.backchannelMs : BACKCHANNEL_LATER_MS;
    // A short cached «Ja.» / «Okei.» / «Skjønner.» only if real content still isn't ready at 1.2 s.
    const backTimer = mayBackchannel ? setTimeout(() => {
      if (spokeAnything || stop || abort.signal.aborted || this.ended || this.pending) return;
      const options = this.L.backchannels.filter((b) => b !== this.lastBackchannel);
      backchannel = options[turnNo % options.length]!;
      this.lastBackchannel = backchannel;
      this.lastBackchannelTurn = turnNo;
      this.backchannels++;
      this.debug("backchannel", { text: backchannel });
      void this.say(backchannel, "filler");
    }, Math.max(0, backAfter - (Date.now() - t0))) : undefined;
    // Only fill silence when the reply is genuinely slow.
    const fillerTimer = setTimeout(() => {
      if (spokeAnything || backchannel || stop || abort.signal.aborted || this.ended || this.pending || this.fillers >= MAX_FILLERS) return;
      this.fillers++;
      const f = this.L.fillers.find((x) => x !== this.lastFiller) ?? this.L.fillers[0]!;
      this.lastFiller = f;
      this.debug("filler", { text: f, afterMs: FILLER_AFTER_MS });
      void this.say(f, "filler");
    }, FILLER_AFTER_MS);

    const turnLine: TurnLine = { id: nid("a"), at: Date.now(), parts: [] };
    let waited = false;
    let sentences = 0;
    let rawText = "";
    let speechCapped = false; // one sentence per turn; two when answering a direct question
    let askedInTurn = false;
    this.turnSpoke = false;
    const handle = async (s: Segment) => {
      if (stop || abort.signal.aborted) return;
      // Nothing is said until the callee has really stopped (no half-sentences from cancelled turns).
      if (!waited && answeringCallee && (s.kind === "speech" || s.kind === "ask" || s.kind === "dtmf")) {
        waited = true;
        await this.waitForSilence(abort.signal);
        if (stop || abort.signal.aborted) return;
        await this.waitSpeakHold(abort.signal);
        if (stop || abort.signal.aborted) return;
      }
      if (s.kind === "speech") {
        if (backchannel && !spokeAnything) {
          // "Ja," was already said: don't start the real reply with "Ja, …" again.
          const w = backchannel.replace(/[.,]$/, "");
          const stripped = s.text.replace(new RegExp(`^${w}[,!.]?\\s+`, "i"), "");
          if (stripped !== s.text && stripped.trim()) s = { ...s, text: stripped.charAt(0).toUpperCase() + stripped.slice(1) };
        }
        // Style rules (call #8): no meta talk, no echoing the callee, no «done» claims before the
        // callee confirmed, the full order only once, and short turns.
        const lastCalleeText = [...this.history].reverse().find((h) => h.role === "callee")?.text.replace(/\s*⟨.*?⟩/g, "") ?? "";
        if (isMeta(s.text) || isEcho(s.text, lastCalleeText) || asksWhoTheyAre(s.text)) { this.debug("style_dropped", { text: s.text }); return; }
        // Interjection-only lines go (unless it is the goodbye); «Skjønner, da …» → «Da …».
        if (isFillerOnly(s.text) && !GOODBYE.test(s.text)) { this.debug("filler_dropped", { text: s.text }); return; }
        if (stripFillerPrefix(s.text) !== s.text) s = { ...s, text: stripFillerPrefix(s.text) };
        // Never drop the second half of a sentence already started («Jeg ringer for Petter,» was
        // left hanging in c_cc7521a0c46d): finish it.
        const midSentence = /,\s*$/.test(turnLine.parts.at(-1) ?? "");
        if (this.errandStated && !midSentence && restatesErrand(s.text, this.errand, lastCalleeText)) { this.debug("errand_restatement_dropped", { text: s.text }); return; }
        if (isDoneClaim(s.text) && !this.confirmedByCallee) { this.debug("done_claim_dropped", { text: s.text }); return; }
        // Capped turns may still ask one question (call c_ba0df20d dropped «Hva koster den?»).
        const isQuestion = /\?\s*$/.test(s.text);
        if (speechCapped && !(isQuestion && !askedInTurn)) { this.debug("turn_capped", { text: s.text }); return; }
        if (this.errandStated && errandParts(s.text, this.errand) >= 2) {
          const short = shortenErrand(s.text, this.errand, lastCalleeText);
          this.debug("errand_shortened", { original: s.text, short });
          if (!short || short.split(/\s+/).length < 2) return;
          s = { ...s, text: short };
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
          // c_73b6b5529e9b: the made-up time was blocked every turn and the agent went silent.
          // Say the sentence without the time instead.
          const rest = withoutTimes(s.text);
          this.debug("time_blocked", { text: s.text, bad, rest });
          if (rest.split(/\s+/).length >= 3) s = { ...s, text: rest };
          else {
            stop = true;
            spokeAnything = true;
            const q = "Hvilket klokkeslett mener du?";
            if (!this.recentTurns.some((r) => r.has(norm(q)))) { said.push(q); await this.say(q, "say", false, abort.signal, turnLine); }
            return;
          }
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
        if (commitment && (this.approvalCredit <= 0 || !this.coveredByApproval(s.text))) {
          // Safety: the model tried to commit without a yes from the user for exactly this.
          this.note(this.U.note.stoppedCommit, "warn");
          stop = true;
          await this.requestApproval(`Kan jeg si ja til dette: «${s.text.replace(/[.!]$/, "")}»?`, ["JA", "NEI"], "commit");
          return;
        }
        if (commitment) this.approvalCredit--;
        // Never repeat a line from the previous turn; escalate instead of looping on "say again".
        const n = norm(s.text);
        const dup = this.recentTurns.some((t) => t.has(n));
        const confused = CONFUSED.test(s.text);
        if (confused || dup) {
          if (confused && !turnConfused) { turnConfused = true; this.confusedRun = this.recentConfused.slice(-3).filter(Boolean).length + 1; }
          // A repeated line alone never escalates (call c_ba0df20d hung up on a repeated price
          // question); only real confusion does. The repeat is allowed once, then skipped.
          const esc = this.escalation(dup && this.confusedRun >= 2);
          if (esc) {
            this.debug("escalate", { original: s.text, dup, confusedRun: this.confusedRun, replacement: esc.text });
            stop = true;
            spokeAnything = true;
            said.push(esc.text);
            await this.say(esc.text, "say", false, abort.signal, turnLine);
            if (esc.end) this.endTag = { outcome: "failed", summary: this.U.summary.misunderstood };
            return;
          }
          if (dup && !confused) {
            // Nothing from the callee since we said it: saying it again only talks over them.
            if (!this.calleeSince(n)) { this.debug("skip_duplicate", { text: s.text, why: "no callee line since" }); return; }
            // Asking the same thing once more is normal on a bad line; a third time is a loop.
            const times = (this.repeats.get(n) ?? 0) + 1;
            this.repeats.set(n, times);
            if (times > 1) { this.debug("skip_duplicate", { text: s.text }); return; }
            this.debug("allow_repeat", { text: s.text });
          }
        }
        spokeAnything = true;
        this.turnSpoke = true;
        if (firstAudio && this.timing && !this.timing.awaitAudio) { this.timing.awaitTts = true; this.timing.awaitAudio = true; }
        if (firstAudio) { firstAudio = false; this.latencies.push(Date.now() - t0); }
        said.push(s.text);
        if (errandParts(s.text, this.errand) >= 2 || restatesErrand(s.text, this.errand, "")) this.errandStated = true;
        // «Flott!» / «Ja.» don't count as the turn's sentence.
        if (endsSentence(s.text) && s.text.split(/\s+/).length >= 3 && ++sentences >= (askedQuestion ? 2 : 1)) speechCapped = true;
        if (isQuestion) { askedInTurn = true; speechCapped = true; }
        if (GOODBYE.test(s.text)) saidBye = true;
        const r = await this.say(s.text, "say", false, abort.signal, turnLine);
        if (r.interrupted) { stop = true; interrupted = true; }
        // After a goodbye nothing more is said: the rest of the reply is dropped and we hang up.
        if (saidBye) stop = true;
      } else if (s.kind === "ask") {
        stop = true;
        // The model asking again right after the user answered, with nothing new from the
        // callee in between, would loop the JA card. Treat it as already answered.
        const calleeSince = this.history.slice(Math.max(0, this.answeredAtHistory)).some((h) => h.role === "callee");
        // Same question as one the user already answered (call #8 asked «274 kroner?» 5×): reuse the answer.
        const askQ = norm(s.question);
        const prior = this.answered.find((a) => similar(a.q, askQ) >= 0.6);
        if (prior) {
          this.debug("suppressed_reask_similar", { question: s.question, prior: prior.choice });
          if (/^(ja|yes|ok|godta)/i.test(prior.choice)) this.approvalCredit = 1;
          if (this.reasked++ < 1) {
            this.wantTurn = true;
            this.history.push({ role: "user", text: `[instruks] ${this.init.profile.name || "Brukeren"} har allerede svart «${prior.choice}» på dette. Ikke spør igjen; svar mottakeren kort nå.` });
          }
          return;
        }
        if (this.answeredAtHistory >= 0 && !calleeSince) {
          this.debug("suppressed_reask", { question: s.question });
          if (this.reasked++ < 1) { this.wantTurn = true; this.history.push({ role: "user", text: "[instruks] Du har allerede fått svar på dette. Gi beskjed til mottakeren nå." }); }
          return;
        }
        // We know who we called: never ask the user which restaurant or address it is.
        if (asksUserWhereCallee(s.question)) {
          this.debug("ask_where_callee_dropped", { question: s.question });
          if (this.reasked++ < 1) {
            this.wantTurn = true;
            this.history.push({ role: "user", text: `[instruks] Du har ringt ${this.init.plan.callee.name}. Hentingen er hos dem, der du ringer nå. Ikke spør brukeren om det; si det kort til mottakeren.` });
          }
          return;
        }
        const options = fixCardOptions(s.question, s.options);
        if (options.join("|") !== s.options.join("|")) this.debug("card_options_fixed", { question: s.question, from: s.options, to: options });
        const agentLines = this.history.filter((h) => h.role === "agent").map((h) => h.text);
        const question = priceWarning(s.question, agentLines) + this.withContext(s.question);
        await this.requestApproval(question, options, /^(ja|nei)$/i.test(options[0] ?? "") ? "commit" : "choice");
      } else if (s.kind === "dtmf") {
        // Phone menu: press the key, then wait for the next prompt (the history line tells the model).
        spokeAnything = true;
        stop = true;
        this.debug("dtmf", { digits: s.digits });
        this.note(this.U.note.dtmf(s.digits));
        this.history.push({ role: "system", text: `Du trykket ${s.digits} på telefonen. Ikke si noe; vent på neste beskjed fra menyen.` });
        try { await this.init.line.sendDtmf?.(s.digits); }
        catch (e) { this.note(this.U.note.dtmfFailed(s.digits, (e as Error).message), "warn"); }
      } else if (s.kind === "note") {
        this.note(s.text);
      } else if (s.kind === "end") {
        const outcome = (["done", "partial", "failed", "refused", "no_answer"].includes(s.outcome) ? s.outcome : "partial") as Outcome;
        // Never hang up on a refusal we only half heard: ask once.
        const lastCallee = [...this.history].reverse().find((h) => h.role === "callee")?.text ?? "";
        if (outcome === "refused" && !this.refusalChecked && /⟨usikre ord/.test(lastCallee)) {
          this.refusalChecked = true;
          this.debug("refusal_unsure", { lastCallee });
          stop = true;
          spokeAnything = true;
          await this.say(this.L.refusalUnsure, "say", false, abort.signal, turnLine);
          return;
        }
        if (outcome === "no_answer" && !this.errandStated) {
          // The model heard a voicemail greeting: same result as line-level detection.
          this.voicemail = true;
          this.endTag = { outcome, summary: this.voicemailText() };
        } else this.endTag = { outcome, summary: s.summary };
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
        rawText += tok;
        for (const s of seg.push(tok)) await handle(s);
      }
      if (!abort.signal.aborted && !stop) for (const s of seg.end()) await handle(s);
      this.debug("llm_text", { text: rawText });
    } catch (e) {
      if (!abort.signal.aborted) {
        console.error("[session] LLM failed:", (e as Error).message);
        this.note(this.U.note.llmSlow, "warn");
        if (!spokeAnything) {
          const f = this.L.fillers.find((x) => x !== this.lastFiller) ?? this.L.fillers[0]!;
          this.lastFiller = f;
          await this.say(f, "filler");
        }
      }
    } finally {
      clearTimeout(fillerTimer);
      if (turnLine.parts.length) {
        const full = turnLine.parts.join(" ");
        this.emit({ type: "transcript", id: turnLine.id, who: "agent", text: full, final: true, at: Date.now() });
        this.transcript.push({ who: "agent", text: full, at: turnLine.at });
      }
      clearTimeout(backTimer);
      this.turnRunning = false;
      if (said.length) {
        this.recentTurns = [...this.recentTurns, new Set(said.map(norm))].slice(-3);
        this.recentConfused = [...this.recentConfused, turnConfused].slice(-4);
        this.confusedRun = this.recentConfused.filter(Boolean).length;
      }
      this.debug("turn_end", { said, confusedRun: this.confusedRun, aborted: abort.signal.aborted });
      // Cut off mid-reply: keep the whole reply in case the callee said nothing real.
      // Only what the filters let through: the reply must start with what was actually said.
      const reply = rawText.replace(/\s+/g, " ").trim();
      const spoken = norm(said.join(" "));
      if (interrupted && reply && spoken && !/\[\[/.test(rawText) && norm(reply).startsWith(spoken) && endsSentence(reply) && !saidBye) {
        this.cutLine = { text: reply, at: Date.now() };
        this.scheduleResume(BARGE_RESUME_MS);
      } else if (said.length) this.cutLine = undefined;
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

  /** Did the callee (or the user) say anything since our last line that normalizes to `n`? */
  private calleeSince(n: string): boolean {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const h = this.history[i]!;
      if (h.role === "callee" || h.role === "user") return true;
      if (h.role === "agent" && norm(h.text) === n) return false;
    }
    return true;
  }

  /**
   * What to say instead of a "say again" / repeated line, counted over the last 4 turns.
   * 1st: allowed as is. 2nd: rephrase the errand as a yes/no question. 3rd: end politely.
   */
  private escalation(dup: boolean): { text: string; end?: boolean } | null {
    const name = this.init.profile.name || this.L.user;
    if (this.confusedRun >= 3) return { text: this.L.misunderstood(name), end: true };
    // Don't re-introduce ourselves (the callee complained on call #5); once per call.
    const rephrase = this.L.rephrase;
    if (this.confusedRun === 2 || dup) {
      if (this.rephrased || this.recentTurns.some((t) => t.has(norm(rephrase)))) {
        return { text: this.L.misunderstood(name), end: true };
      }
      if (this.confusedRun === 2) this.note(this.U.note.hardToUnderstand, "warn");
      this.rephrased = true;
      return { text: rephrase };
    }
    return null;
  }

  /** Speak through the safety filter; records the line in the transcript. */
  /**
   * Speak through the safety filter. With `group`, all clauses of one agent turn share one
   * transcript id (the UI shows one bubble that grows); the turn's final line is emitted by runTurn.
   */
  private async say(text: string, kind: "say" | "filler" = "say", canned = false, signal?: AbortSignal, group?: TurnLine) {
    if (this.ended) return { interrupted: true };
    const f = filterOutgoing(text, {
      willShare: this.init.plan.willShare,
      fnr: this.init.secrets?.fnr,
      address: this.init.profile.address,
      lang: this.lang,
      uiLang: this.init.profile.lang,
    });
    if (f.blocked) this.note(f.blocked, "warn");
    if (!f.text) return { interrupted: false };
    // What the user sees never contains the fnr itself.
    const shown = text.replaceAll("{{FNR}}", "[fødselsnummer]").replaceAll("{{ADDRESS}}", this.init.profile.address ?? "[adresse]");
    const shownSafe = text.includes("{{") && f.text !== this.L.fnr ? shown : f.text;
    const id = group?.id ?? nid("a");
    const at = group?.at ?? Date.now();
    if (group) group.parts.push(shownSafe);
    this.emit({ type: "transcript", id, who: "agent", text: group ? group.parts.join(" ") : shownSafe, final: false, at });
    this.speaking = true;
    let r = { interrupted: false };
    try {
      if (signal?.aborted) return { interrupted: true };
      r = await this.init.line.speak(f.text, kind);
    } catch (e) {
      console.error("[session] speak failed:", (e as Error).message);
      this.note(this.U.note.ttsFailed, "warn");
    } finally {
      this.speaking = false;
    }
    if (!group) {
      this.emit({ type: "transcript", id, who: "agent", text: shownSafe, final: true, at: Date.now() });
      this.transcript.push({ who: "agent", text: shownSafe, at });
    }
    this.armSilenceNudge();
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
  /**
   * A commitment sentence is covered only if an approved card was about the same thing: the
   * sentence names nothing (pronoun: «da bekrefter jeg den») or its content words appear in an
   * approved card.
   */
  private coveredByApproval(text: string): boolean {
    const words = norm(text).split(" ").filter((w) => w.length >= 4 && !COMMIT_VERBS.test(w) && !FILLER_WORDS.has(w));
    if (!words.length) return this.approvedItems.length > 0;
    return this.approvedItems.some((q) => words.filter((w) => q.includes(w.slice(0, 5))).length >= Math.ceil(words.length * 0.5));
  }

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
    await this.say(this.L.wrapUp(this.init.profile.name || this.L.user), "filler");
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
    this.note(this.U.note.message(name || this.U.note.you, had, msg), "info");
  }

  /** Did the correction change a number, a negation or a name? */
  private contentChanged(a: string, b: string): boolean {
    const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean));
    const A = words(a), B = words(b);
    const diff = [...A].filter((w) => !B.has(w)).concat([...B].filter((w) => !A.has(w)));
    const orig = (a + " " + b).split(/\s+/);
    return diff.some((w) => isContentWord(w) || orig.some((o) => o.replace(/[.,!?]/g, "").toLowerCase() === w && isContentWord(o)));
  }

  private allowedTimes(): Set<string> {
    // c_5b26344610cc: «… til henting klokken halv sju» was blocked; the time was only in the task.
    const set = new Set([...timesIn(this.init.plan.goal), ...timesIn(this.init.taskText ?? "")]);
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
    if (t === text) return text; // untouched: keep the model's casing («…pizza, så jeg …»)
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
          stt: config.callProvider !== "mock" ? "scribe_v2_realtime" : "mock",
          llm: this.init.llm.model ? `${this.init.llm.name}:${this.init.llm.model}` : this.init.llm.name,
          tts: config.callProvider !== "mock" ? config.elevenlabs.ttsModel : "mock",
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
    const last = [...this.history].reverse().find((h) => h.role === "callee")?.text.replace(/\s*⟨.*?⟩/g, "") ?? "";
    const short = last.trim().split(/\s+/).length <= 2;
    const need = /\?\s*$/.test(last) && !short ? SPEAK_AFTER_QUESTION_MS : SPEAK_AFTER_SILENCE_MS;
    while (!signal.aborted && !this.ended && Date.now() - start < 3000) {
      const quiet = this.init.line.silenceMs?.() ?? Infinity;
      if (quiet >= need) return;
      await Bun.sleep(Math.min(40, need - quiet));
    }
  }

  private armSilenceNudge() {
    clearTimeout(this.silenceTimer);
    if (this.ended || this.pending || this.nudged >= 2) return;
    const since = Date.now();
    this.silenceTimer = setTimeout(() => {
      if (this.ended || this.pending || this.speaking || this.turnRunning || this.lastCalleeAt > since) return;
      if (Date.now() - this.lastApprovalAt < 30_000) { this.armSilenceNudge(); return; } // we are the ones waiting
      // Only after real silence: no voice energy for 8 s (call #5 nudged while the callee talked).
      const quiet = this.init.line.silenceMs?.() ?? Infinity;
      if (quiet < 8000 || this.lastPartialAt > since) { this.armSilenceNudge(); return; }
      this.nudged++;
      void this.say(this.nudged === 1 ? this.L.hello : this.L.cantHear, "filler").then(() => {
        if (this.nudged >= 2 && !this.ended) void this.finish("silence", { outcome: "failed", summary: this.U.summary.heardNothing });
      });
    }, 8000);
  }

  private async requestApproval(rawQuestion: string, options: string[], kind: PendingApproval["kind"], spoken?: string) {
    if (this.pending || this.ended) return;
    // Internal LLM hints («⟨tid: 18:00⟩», «⟨usikre ord: …⟩») never reach the user's card.
    const question = rawQuestion.replace(/\s*⟨[^⟩]*⟩/g, "").replace(/\s+»/g, "»").trim();
    // One natural wait line per call, a shorter one the second time, then silence (+ typing sound).
    const name = this.init.profile.name || this.L.user;
    if (spoken === undefined) {
      spoken = this.L.checking(name)[this.waitLines] ?? "";
      this.waitLines++;
    }
    this.lastApprovalAt = Date.now();
    const id = nid("ap");
    this.pending = { id, question, options, kind };
    this.progress();
    this.waitingNoticeSaid = false;
    this.emit({ type: "approval_request", id, question, options, at: Date.now() });
    this.hold.arm(); // 30 s: ask the callee to hold; 2 min: offer a callback
    if (spoken) await this.say(spoken, "filler");
    if (this.pending?.id === id) this.init.line.startWaitingSound();
  }

  private answer(id: string, choice: string) {
    const p = this.pending;
    if (!p || p.id !== id) return;
    if (/^skriv( svar)?$/i.test(choice.trim())) {
      this.note(this.U.note.writeAnswer);
      return; // card stays open; the next instruction is the answer
    }
    this.answered.push({ q: norm(p.question), choice });
    clearTimeout(p.timer);
    this.pending = undefined;
    this.init.line.stopWaitingSound();
    if (this.speaking) this.init.line.stopSpeaking(); // cut «Et øyeblikk…» if it is still playing
    this.reasked = 0;
    const yes = /^(ja|yes|ok)$/i.test(choice.trim());
    const no = /^(nei|no)$/i.test(choice.trim());
    if (p.kind === "address") {
      if (yes) this.init.plan.willShare.push("address");
      const canShare = yes && !!this.init.profile.address;
      this.history.push({ role: "user", text: canShare ? "[godkjent] Du kan oppgi adressen: {{ADDRESS}}" : "[avslått] Ikke oppgi adressen." });
    } else if (p.kind === "stuck") {
      if (/godta/i.test(choice)) { this.approvalCredit = 1; this.approvedCommit = true; this.approvedItems.push(norm(p.question)); }
      this.history.push({ role: "user", text: /godta/i.test(choice)
        ? `[godkjent] Brukeren godtar det butikken tilbyr (${p.question}). Bekreft det kort.`
        : `[svar] ${choice}. Ikke gjenta det samme spørsmålet; prøv en annen løsning eller avslutt høflig.` });
    } else if (yes && p.kind !== "commit") {
      // A yes to a side question (extras, delivery, a choice) is an answer, not permission to commit.
      this.history.push({ role: "user", text: `[svar] Ja (${p.question})` });
    } else if (yes) {
      this.approvalCredit = 1;
      this.approvedCommit = true;
      this.approvedItems.push(norm(p.question));
      this.history.push({ role: "user", text: `[godkjent] ${p.question}` });
    } else if (no) {
      this.history.push({ role: "user", text: `[avslått] ${p.question}` });
    } else {
      this.history.push({ role: "user", text: `[svar] ${choice}` });
    }
    this.answeredAtHistory = this.history.length;
    this.progress();
    if (p.kind === "stuck" && /legg på/i.test(choice)) {
      void this.hold.resume().then(() => this.wrapUp(this.U.summary.userHungUp));
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
        if (this.pending?.kind === "choice") { this.answer(this.pending.id, text); break; }
        const lang = langFromText(text);
        if (lang && lang !== this.lang) this.setLang(lang);
        this.history.push({ role: "user", text: `[instruks] ${text}` });
        this.progress();
        this.note(this.U.note.instruction(text));
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
        this.note(this.U.note.tone(cmd.tone));
        break;
      case "hangup":
        void this.userHangup();
        break;
    }
  }

  /** «Speak English» / «snakk norsk» from the user: prompt, fixed lines, STT and TTS switch. */
  setLang(lang: Lang) {
    this.lang = lang;
    this.init.line.setLang?.(lang);
    this.debug("call_lang", { lang });
    this.note(this.U.note.speaking(lang));
  }

  private async userHangup() {
    this.turnAbort?.abort();
    this.hold.cancel();
    if (this.pending) { clearTimeout(this.pending.timer); this.pending = undefined; this.init.line.stopWaitingSound(); }
    if (this.status === "connected") {
      if (this.speaking) this.init.line.stopSpeaking();
      await Promise.race([this.say(this.L.mustEnd, "filler"), Bun.sleep(5000)]);
    }
    await this.finish("user hangup", { outcome: "partial", summary: this.U.summary.byYou });
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
    clearInterval(this.warmTimer);
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
    let honestSummary: string | undefined;
    // «done» needs an approved deal AND a clear yes from the callee afterwards (call #8 claimed done
    // after «Begge to» and a confused 240/274 kr).
    if (outcome === "done" && !this.init.infoOnly && !(this.approvedCommit && this.confirmedByCallee)) {
      outcome = "partial";
      honestSummary = this.approvedCommit ? this.U.summary.unclearConfirm : this.U.summary.noDeal;
      this.debug("done_downgraded", { approvedCommit: this.approvedCommit, confirmedByCallee: this.confirmedByCallee });
    }
    if (this.voicemail) outcome = "no_answer";
    if (!this.connectedAt) outcome = this.status === "failed" ? "failed" : "no_answer";
    const summary = this.voicemail ? this.voicemailText() : !this.connectedAt
      ? (outcome === "no_answer" ? this.U.summary.noAnswer : this.U.summary.notConnected)
      : honestSummary ? `${honestSummary} ${s.summary || ""}`.trim() : tag ? tag.summary : (s.summary || tagIn?.summary || this.U.summary.done);
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
    console.log(`[cost] call ${this.callId}: LLM $${this.usage.costUsd.toFixed(5)} (${this.usage.requests} req, ${this.usage.promptTokens} in [${this.cachedTokens} cached] / ${this.usage.completionTokens} out)` +
      (this.lineCost ? `, TTS ${this.lineCost.ttsChars} chars, STT ${this.lineCost.sttSec} s` : ""));
    this.debug("cost", { llm: this.usage, line: this.lineCost });
    this.status = "ended";
    this.emit({ type: "status", status: "ended", at: Date.now() });
    this.emit({ type: "result", result: this.result });
  }

  get isEnded() { return this.ended; }
}
