import type {
  CallResult,
  LiveCommand,
  LiveEvent,
  Outcome,
  TranscriptLine,
  Word,
} from "../../../shared/contract.ts";
import type { LiveConnection, LiveHandlers } from "./types.ts";

// A scripted Domino's call that emits the same LiveEvents the server will.
// The call itself is in Norwegian (the callee's language); UI-facing bits follow `lang`.

type Who = "callee" | "agent";
type Step =
  | { kind: "status"; status: "dialing" | "ringing" | "connected" | "on_hold" | "ended"; pause: number }
  | { kind: "say"; who: Who; text: string; unsure?: string[]; pause: number }
  | { kind: "note"; text: string; level: "info" | "warn"; pause: number }
  | { kind: "approval"; id: string; question: string; options: string[] }
  | { kind: "end"; outcome: Outcome; summary: string; details: Record<string, string> };

interface Copy {
  approve: string;
  yes: string;
  no: string;
  refusedCard: string;
  summaryDone: string;
  summaryDeclined: string;
  instruction: (t: string) => string;
  simpler: string;
  tone: (t: string) => string;
  hungUp: string;
  details: { item: string; pickup: string; price: string; name: string };
}

const COPY: Record<"en" | "no", Copy> = {
  en: {
    approve: "Pay 189 kr at pickup?",
    yes: "JA",
    no: "NEI",
    refusedCard: "Refused to share a card number on the call",
    summaryDone: "Ordered: 1 large pepperoni, pickup 18:00, 189 kr",
    summaryDeclined: "Nothing ordered. You said no to paying 189 kr.",
    instruction: (t) => `Instruction received: «${t}»`,
    simpler: "Spoken will say it more simply",
    tone: (t) => `Tone changed to ${t}`,
    hungUp: "You ended the call",
    details: { item: "Item", pickup: "Pickup", price: "Price", name: "Name on order" },
  },
  no: {
    approve: "Betale 189 kr ved henting?",
    yes: "JA",
    no: "NEI",
    refusedCard: "Nektet å dele kortnummer i samtalen",
    summaryDone: "Bestilt: 1 stor pepperoni, hentes 18:00, 189 kr",
    summaryDeclined: "Ingenting bestilt. Du sa nei til å betale 189 kr.",
    instruction: (t) => `Beskjed mottatt: «${t}»`,
    simpler: "Spoken sier det enklere",
    tone: (t) => `Tonen er endret til ${t}`,
    hungUp: "Du la på",
    details: { item: "Vare", pickup: "Henting", price: "Pris", name: "Navn på bestillingen" },
  },
};

function opening(name: string): Step[] {
  return [
    { kind: "status", status: "dialing", pause: 900 },
    { kind: "status", status: "ringing", pause: 2200 },
    { kind: "status", status: "connected", pause: 500 },
    { kind: "say", who: "callee", text: "Domino's Storo, hei!", pause: 500 },
    {
      kind: "say",
      who: "agent",
      text: `Hei, jeg er en KI-assistent som ringer på vegne av ${name}. Du kan si nei til å snakke med meg.`,
      pause: 600,
    },
    { kind: "say", who: "callee", text: "Å, ja vel. Nei, det går fint. Hva skal det være?", unsure: ["vel."], pause: 500 },
    { kind: "say", who: "agent", text: "Jeg vil gjerne bestille en stor pepperoni til henting klokka atten.", pause: 700 },
    { kind: "say", who: "callee", text: "Stor pepperoni, ja. Kan jeg få kortnummeret ditt?", pause: 400 },
  ];
}

function middle(c: Copy): Step[] {
  return [
    { kind: "say", who: "agent", text: "Jeg kan ikke dele kortnummer, men vi kan betale ved henting.", pause: 200 },
    { kind: "note", text: c.refusedCard, level: "warn", pause: 600 },
    {
      kind: "say",
      who: "callee",
      text: "Det går fint. Det blir hundre og åttini kroner, betalt ved henting da?",
      unsure: ["åttini", "henting"],
      pause: 300,
    },
    { kind: "approval", id: "appr-pay", question: c.approve, options: [c.yes, c.no] },
  ];
}

function afterYes(c: Copy, name: string): Step[] {
  return [
    { kind: "say", who: "agent", text: "Ja, vi betaler ved henting.", pause: 500 },
    { kind: "say", who: "callee", text: "Supert. Hvilket navn skal stå på bestillingen?", pause: 400 },
    { kind: "say", who: "agent", text: `${name}.`, pause: 500 },
    { kind: "say", who: "callee", text: "Den er klar klokka seks. Ha det bra!", pause: 400 },
    { kind: "say", who: "agent", text: "Tusen takk, ha det!", pause: 700 },
    { kind: "status", status: "ended", pause: 300 },
    {
      kind: "end",
      outcome: "done",
      summary: c.summaryDone,
      details: {
        [c.details.item]: "1 × stor pepperoni",
        [c.details.pickup]: "18:00, Domino's Storo",
        [c.details.price]: "189 kr",
        [c.details.name]: name,
      },
    },
  ];
}

function afterNo(c: Copy): Step[] {
  return [
    { kind: "say", who: "agent", text: "Da dropper vi bestillingen for nå. Takk for hjelpen!", pause: 400 },
    { kind: "say", who: "callee", text: "Greit, ha det.", pause: 600 },
    { kind: "status", status: "ended", pause: 300 },
    { kind: "end", outcome: "refused", summary: c.summaryDeclined, details: {} },
  ];
}

// How confident the mock "STT" is per word. Unsure words land under 0.6 so they render grey.
function toWords(text: string, unsure: string[] = []): Word[] {
  return text.split(" ").map((w) => ({
    text: w,
    confidence: unsure.includes(w) ? 0.42 : 0.9 + ((w.length * 7) % 10) / 100,
  }));
}

export interface MockCallOptions {
  callId: string;
  taskId: string;
  name: string;
  lang: "en" | "no";
  /** Speed multiplier; tests and screenshots run faster. */
  speed?: number;
  /** Also emit synthetic `level` events, to exercise the real-loudness path. Off by default. */
  levels?: boolean;
  onResult(result: CallResult): void;
}

export function startMockCall(opts: MockCallOptions, h: LiveHandlers): LiveConnection {
  const c = COPY[opts.lang];
  const speed = opts.speed ?? 1;
  const transcript: TranscriptLine[] = [];
  const startedAt = Date.now();
  let queue: Step[] = [...opening(opts.name), ...middle(c)];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingApproval: string | null = null;
  let closed = false;
  let ended = false;
  let lineSeq = 0;
  let levelTimer: ReturnType<typeof setInterval> | undefined;
  const now = () => Date.now();
  const emit = (e: LiveEvent) => {
    if (!closed) h.onEvent(e);
  };
  const later = (ms: number, fn: () => void) => {
    timer = setTimeout(fn, ms / speed);
  };

  // Words appear one at a time as partial events, then one final event.
  const say = (step: Extract<Step, { kind: "say" }>, done: () => void) => {
    const id = `l${++lineSeq}`;
    const words = toWords(step.text, step.unsure);
    if (step.who === "agent") emit({ type: "agent_typing", at: now() });
    let i = 0;
    // Synthetic loudness while this line is "spoken": syllable-ish bumps at ~15 Hz.
    clearInterval(levelTimer);
    if (opts.levels) {
      const t0 = Date.now();
      levelTimer = setInterval(() => {
        const t = (Date.now() - t0) / 1000;
        const rms = Math.max(0, 0.22 + 0.2 * Math.sin(t * 11) + 0.08 * Math.sin(t * 29));
        emit({ type: "level", who: step.who, rms, at: now() });
      }, 66);
    }
    const tick = () => {
      i += 1;
      const part = words.slice(0, i);
      const final = i >= words.length;
      emit({ type: "transcript", id, who: step.who, text: part.map((w) => w.text).join(" "), final, words: part, at: now() });
      if (final) {
        clearInterval(levelTimer);
        transcript.push({ who: step.who, text: step.text, at: now() });
        later(step.pause, done);
      } else {
        later(step.who === "agent" ? 150 : 190, tick);
      }
    };
    later(step.who === "agent" ? 450 : 250, tick);
  };

  const finish = (outcome: Outcome, summary: string, details: Record<string, string>) => {
    if (ended) return;
    ended = true;
    const result: CallResult = {
      callId: opts.callId,
      taskId: opts.taskId,
      outcome,
      summary,
      details,
      transcript,
      durationSec: Math.round(((Date.now() - startedAt) / 1000) * speed),
    };
    opts.onResult(result);
    emit({ type: "result", result });
    h.onState("closed");
  };

  const next = () => {
    if (closed || ended) return;
    const step = queue.shift();
    if (!step) return;
    switch (step.kind) {
      case "status":
        emit({ type: "status", status: step.status, at: now() });
        later(step.pause, next);
        break;
      case "say":
        say(step, next);
        break;
      case "note":
        emit({ type: "note", text: step.text, level: step.level, at: now() });
        later(step.pause, next);
        break;
      case "approval":
        pendingApproval = step.id;
        emit({ type: "agent_typing", at: now() });
        emit({ type: "approval_request", id: step.id, question: step.question, options: step.options, at: now() });
        break; // resumes on approval_response
      case "end":
        finish(step.outcome, step.summary, step.details);
        break;
    }
  };

  h.onState("connecting");
  later(300, () => {
    h.onState("open");
    next();
  });

  return {
    send(cmd: LiveCommand) {
      if (closed || ended) return;
      switch (cmd.type) {
        case "approval_response": {
          if (cmd.id !== pendingApproval) return;
          pendingApproval = null;
          queue = cmd.choice === c.yes ? afterYes(c, opts.name) : afterNo(c);
          later(300, next);
          break;
        }
        case "instruction":
          emit({ type: "note", text: c.instruction(cmd.text), level: "info", at: now() });
          break;
        case "say_simpler":
          emit({ type: "note", text: c.simpler, level: "info", at: now() });
          break;
        case "tone":
          emit({ type: "note", text: c.tone(cmd.tone), level: "info", at: now() });
          break;
        case "hangup":
          clearTimeout(timer);
          clearInterval(levelTimer);
          emit({ type: "status", status: "ended", at: now() });
          finish("partial", c.hungUp, {});
          break;
      }
    },
    close() {
      closed = true;
      clearTimeout(timer);
      clearInterval(levelTimer);
    },
  };
}
