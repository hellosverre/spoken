// One live call: owns the transcript, the agent loop, approvals, barge-in and the
// safety gates between the LLM and the speaker. Works the same over mock and Telnyx lines.

import type {
  CallResult, CallStatus, LiveCommand, LiveEvent, Outcome, Plan, Profile, TranscriptLine, Word,
} from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { mockSummary } from "../llm/mock.ts";
import type { AgentContext, HistoryItem, LlmProvider, Tone } from "../llm/types.ts";
import {
  ADDRESS_REFUSAL, CARD_REFUSAL, FNR_REFUSAL, detectSecretAsk, ensureDisclosure, filterOutgoing, isCommitment,
} from "../safety.ts";
import type { CallLine } from "./line.ts";
import { Segmenter, type Segment } from "./segment.ts";

export const WAIT_PHRASE = "Et øyeblikk…";

type Listener = (ev: LiveEvent) => void;

interface PendingApproval {
  id: string;
  question: string;
  options: string[];
  kind: "commit" | "address" | "choice";
  timer: ReturnType<typeof setTimeout>;
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
  private nudged = 0;

  constructor(private init: SessionInit) {
    this.callId = init.callId;
    this.taskId = init.taskId;
  }

  // ---------- events ----------

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(ev: LiveEvent) {
    this.events.push(ev);
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
    this.init.line.prefetch?.([ensureDisclosure(this.init.plan.opening, this.init.profile.name), WAIT_PHRASE, CARD_REFUSAL]);
    this.maxTimer = setTimeout(() => this.forceEnd("Maks samtaletid (10 min) nådd."), config.maxCallSec * 1000);
    try {
      await this.init.line.start({
        status: (s, detail) => this.onLineStatus(s, detail),
        calleeSpeech: () => this.onCalleeSpeech(),
        calleePartial: (id, text) => this.emit({ type: "transcript", id, who: "callee", text, final: false, at: Date.now() }),
        calleeFinal: (id, text, words) => this.onCalleeFinal(id, text, words),
        calleeWords: (id, text, words) => this.emit({ type: "transcript", id, who: "callee", text, final: true, words, at: Date.now() }),
        ended: (reason) => void this.finish(reason),
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
    this.history.push({ role: "callee", text: clean });
    if (this.speaking) this.onCalleeSpeech();

    if (this.pending) {
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
    this.requestTurn();
  }

  // ---------- agent turns ----------

  private requestTurn() {
    if (this.ended) return;
    if (this.turnRunning) {
      this.turnAbort?.abort();
      this.wantTurn = true;
      return;
    }
    void this.runTurn();
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
      willShare: share,
      needsApprovalFor: this.init.plan.needsApprovalFor,
      profileFacts: facts,
      tone: this.tone,
      simpler: this.simpler,
      history: [...this.history],
    };
  }

  private async runTurn() {
    this.turnRunning = true;
    this.wantTurn = false;
    const abort = new AbortController();
    this.turnAbort = abort;
    const t0 = this.lastCalleeAt || Date.now();
    let firstAudio = true;
    this.emit({ type: "agent_typing", at: Date.now() });
    const seg = new Segmenter();
    const said: string[] = [];
    let stop = false;

    const handle = async (s: Segment) => {
      if (stop || abort.signal.aborted) return;
      if (s.kind === "speech") {
        const commitment = isCommitment(s.text);
        if (commitment && this.approvalCredit <= 0) {
          // Safety: the model tried to commit without a yes from the user.
          this.note("Stoppet en forpliktelse som ikke var godkjent; spør deg først.", "warn");
          stop = true;
          await this.requestApproval(`Skal jeg si: «${s.text}»?`, ["JA", "NEI"], "commit");
          return;
        }
        if (commitment) this.approvalCredit--;
        if (firstAudio) { firstAudio = false; this.latencies.push(Date.now() - t0); }
        said.push(s.text);
        const r = await this.say(s.text, "say", false, abort.signal);
        if (r.interrupted) stop = true;
      } else if (s.kind === "ask") {
        stop = true;
        await this.requestApproval(s.question, s.options, /^(ja|nei)$/i.test(s.options[0] ?? "") ? "commit" : "choice");
      } else if (s.kind === "note") {
        this.note(s.text);
      } else if (s.kind === "end") {
        const outcome = (["done", "partial", "failed", "refused", "no_answer"].includes(s.outcome) ? s.outcome : "partial") as Outcome;
        this.endTag = { outcome, summary: s.summary };
        stop = true;
      }
    };

    try {
      for await (const tok of this.init.llm.reply(this.ctx(), abort.signal)) {
        if (abort.signal.aborted || stop) break;
        for (const s of seg.push(tok)) await handle(s);
      }
      if (!abort.signal.aborted && !stop) for (const s of seg.end()) await handle(s);
    } catch (e) {
      if (!abort.signal.aborted) {
        console.error("[session] LLM failed:", (e as Error).message);
        this.note("KI-en svarte ikke i tide.", "warn");
        await this.say("Beklager, et lite øyeblikk.", "filler");
      }
    } finally {
      this.turnRunning = false;
      if (this.endTag && !abort.signal.aborted) {
        await this.finish("agent ended");
      } else if (this.wantTurn && !this.pending) {
        void this.runTurn();
      }
    }
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

  /** If the callee says nothing for 8 s after we spoke, check the line once. */
  private armSilenceNudge() {
    clearTimeout(this.silenceTimer);
    if (this.ended || this.pending || this.nudged >= 2) return;
    const since = Date.now();
    this.silenceTimer = setTimeout(() => {
      if (this.ended || this.pending || this.speaking || this.turnRunning || this.lastCalleeAt > since) return;
      this.nudged++;
      void this.say(this.nudged === 1 ? "Hallo, hører du meg?" : "Jeg hører deg dessverre ikke. Jeg prøver igjen senere. Ha det!", "filler").then(() => {
        if (this.nudged >= 2 && !this.ended) void this.finish("silence", { outcome: "failed", summary: "Hørte ingenting fra mottakeren." });
      });
    }, 8000);
  }

  private async requestApproval(question: string, options: string[], kind: PendingApproval["kind"], spoken = WAIT_PHRASE) {
    if (this.pending || this.ended) return;
    const id = nid("ap");
    const timer = setTimeout(() => {
      if (this.pending?.id !== id) return;
      this.note("Fikk ikke svar fra deg i tide; sa nei.", "warn");
      this.answer(id, "NEI");
    }, config.approvalTimeoutSec * 1000);
    this.pending = { id, question, options, kind, timer };
    this.waitingNoticeSaid = false;
    this.emit({ type: "approval_request", id, question, options, at: Date.now() });
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
    const yes = /^(ja|yes|ok)$/i.test(choice.trim());
    const no = /^(nei|no)$/i.test(choice.trim());
    if (p.kind === "address") {
      if (yes) this.init.plan.willShare.push("address");
      this.history.push({ role: "user", text: yes ? "[godkjent] Du kan oppgi adressen: {{ADDRESS}}" : "[avslått] Ikke oppgi adressen." });
    } else if (yes) {
      this.approvalCredit = 1;
      this.history.push({ role: "user", text: `[godkjent] ${p.question}` });
    } else if (no) {
      this.history.push({ role: "user", text: `[avslått] ${p.question}` });
    } else {
      this.history.push({ role: "user", text: `[svar] ${choice}` });
    }
    this.requestTurn();
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
    clearTimeout(this.silenceTimer);
    this.turnAbort?.abort();
    if (this.pending) clearTimeout(this.pending.timer);
    this.init.line.stopWaitingSound();
    try { await this.init.line.hangup(); } catch (e) { console.error("[session] hangup failed:", (e as Error).message); }

    const ctx = this.ctx();
    let s = mockSummary(ctx);
    if (this.connectedAt) {
      try {
        s = await Promise.race([this.init.llm.summarize(ctx), Bun.sleep(8000).then(() => mockSummary(ctx))]);
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
      details: s.details,
      transcript: [...this.transcript],
      durationSec: this.connectedAt ? Math.round((Date.now() - this.connectedAt) / 1000) : 0,
    };
    if (this.latencies.length) {
      const avg = Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length);
      console.log(`[latency] call ${this.callId}: avg ${avg} ms over ${this.latencies.length} turns (${this.latencies.join(", ")})`);
    }
    console.log(`[session] ${this.callId} ended (${reason}): ${outcome}`);
    this.status = "ended";
    this.emit({ type: "status", status: "ended", at: Date.now() });
    this.emit({ type: "result", result: this.result });
  }

  get isEnded() { return this.ended; }
}
