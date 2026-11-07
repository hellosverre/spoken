// Parallel info-only calls: ask 2–3 businesses the same question (price, earliest time), never commit.
// app.ts does the safety checks and builds real lines; this file owns the legs, their state and the mock callees.

import type { CallResult, CompareLeg, CompareState, Lang, Profile } from "../../../shared/contract.ts";
import type { AgentContext, LlmProvider, SummaryOut } from "../llm/types.ts";
import type { CallLine, LineEvents, SpeakKind } from "./line.ts";
import { CallSession } from "./session.ts";
import { calls } from "../store.ts";

/** The goal every leg gets: ask, never agree. The agent still ends with [[END: done | one line]]. */
export function infoGoal(text: string, lang: Lang): string {
  return lang === "en"
    ? `ONLY ASK, DO NOT ORDER OR BOOK. Find out for this request: ${text}. Ask for the price and the earliest available time. Do not agree to anything, do not book or order, give no personal data except the first name. Thank them, say you will get back, and end with [[END: done | price and time in one line]].`
    : `KUN SPØRRE, IKKE BESTILLE ELLER BOOKE. Finn ut for denne forespørselen: ${text}. Spør om pris og tidligste ledige tid. Ikke si ja til noe, ikke bestill, ikke oppgi personopplysninger utover fornavnet. Takk, si at du tar kontakt igjen, og avslutt med [[END: done | pris og tid på én linje]].`;
}

export const INFO_APPROVALS = { no: ["å bestille", "å godta en pris"], en: ["ordering", "accepting a price"] } as const;

export interface Leg {
  name: string;
  phone: string;
  callId: string;
  session: CallSession;
  lastLine?: string;
}

export interface Compare {
  id: string;
  text: string;
  mode: "real" | "mock";
  device?: string;
  legs: Leg[];
}

export const compares = new Map<string, Compare>();

export interface LegSpec { name: string; phone: string; callId: string; line: CallLine; llm: LlmProvider }

export function createCompare(o: {
  id: string; text: string; lang: Lang; callLang: Lang; mode: "real" | "mock"; device?: string; profile: Profile; voiceId: string;
  opening: string; maxSec: number; legs: LegSpec[];
}): Compare {
  const cmp: Compare = { id: o.id, text: o.text, mode: o.mode, device: o.device, legs: [] };
  for (const spec of o.legs) {
    const session = new CallSession({
      callId: spec.callId,
      taskId: o.id,
      plan: {
        taskId: o.id, callee: { name: spec.name, phone: spec.phone, source: "user" }, goal: infoGoal(o.text, o.callLang), opening: o.opening,
        willShare: ["name"], needsApprovalFor: [...INFO_APPROVALS[o.callLang]], voiceId: o.voiceId, callLang: o.callLang,
      },
      profile: { ...o.profile, lang: o.lang },
      line: spec.line,
      llm: spec.llm,
      maxSec: o.maxSec,
      taskText: o.text,
      infoOnly: true,
    });
    const leg: Leg = { name: spec.name, phone: spec.phone, callId: spec.callId, session };
    session.subscribe((ev) => { if (ev.type === "transcript" && ev.final) leg.lastLine = ev.text; });
    calls.set(spec.callId, session);
    cmp.legs.push(leg);
  }
  compares.set(o.id, cmp);
  setTimeout(() => compares.delete(o.id), 30 * 60_000).unref?.();
  for (const leg of cmp.legs) void leg.session.start();
  return cmp;
}

/** What the comparison table shows for one finished leg. */
export function answerOf(r: CallResult): string {
  const d = r.details ?? {};
  const bits = [d.pris ?? d.price, d.tid ?? d.time].filter(Boolean);
  if (r.outcome === "no_answer") return "Ingen svar";
  if (r.outcome === "refused") return "Ville ikke snakke med KI";
  if (bits.length) return bits.join(", ");
  return r.summary;
}

export function stateOf(c: Compare): CompareState {
  const legs: CompareLeg[] = c.legs.map((l) => {
    const r = l.session.result;
    return {
      name: l.name, phone: l.phone, callId: l.callId, status: l.session.status,
      ...(r ? { answer: answerOf(r), outcome: r.outcome } : {}),
      ...(l.lastLine ? { lastLine: l.lastLine } : {}),
    };
  });
  return { compareId: c.id, text: c.text, mode: c.mode, done: c.legs.every((l) => !!l.session.result), legs };
}

// ---- mock callees: three different shops, so the demo table has something to compare ----

const SHOPS = [
  { price: 189, time: "18:15" },
  { price: 169, time: "18:45" },
  { price: 205, time: "18:00" },
];

export function mockShop(i: number) { return SHOPS[i % SHOPS.length]!; }

/** Fake shop: greets when the agent opens, then answers the price question with this leg's price. */
export class CompareMockLine implements CallLine {
  private ev!: LineEvents;
  private closed = false;
  private n = 0;
  private seg = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private stopSpeak?: () => void;
  constructor(private i: number, private name: string, private speed = 1, private lang: Lang = "no") {}

  private wait(ms: number) {
    return new Promise<void>((resolve) => { const t = setTimeout(() => { this.timers.delete(t); resolve(); }, ms * this.speed); this.timers.add(t); });
  }
  async start(ev: LineEvents) {
    this.ev = ev;
    void (async () => {
      await this.wait(500 + this.i * 700);
      if (this.closed) return;
      ev.status("ringing");
      await this.wait(1500 + this.i * 600);
      if (this.closed) return;
      ev.status("connected");
    })();
  }
  async speak(text: string, kind: SpeakKind) {
    const ms = text.split(/\s+/).length * 260 * this.speed;
    const r = await new Promise<{ interrupted: boolean }>((resolve) => {
      const t = setTimeout(() => { this.timers.delete(t); this.stopSpeak = undefined; resolve({ interrupted: false }); }, ms);
      this.timers.add(t);
      this.stopSpeak = () => { clearTimeout(t); this.timers.delete(t); this.stopSpeak = undefined; resolve({ interrupted: true }); };
    });
    if (!r.interrupted && kind === "say" && !this.closed && !/\[\[END/.test(text) && !/ha det|goodbye|bye/i.test(text)) void this.reply();
    return r;
  }
  private async reply() {
    const k = ++this.n;
    const s = mockShop(this.i);
    const no = this.lang !== "en";
    const line = k === 1
      ? (no ? `Hei, du har kommet til ${this.name}. Hva kan jeg hjelpe deg med?` : `Hi, you've reached ${this.name}. How can I help?`)
      : (no ? `En stor pepperoni er ${s.price} kroner, og tidligste henting er klokka ${s.time}. Er det noe mer?` : `A large pepperoni is ${s.price} kroner and the earliest pickup is ${s.time}. Anything else?`);
    await this.wait(700);
    if (this.closed) return;
    const id = `c_${++this.seg}`;
    const parts = line.split(" ");
    this.ev.calleeSpeech();
    for (let j = 1; j <= parts.length; j += 3) { await this.wait(300); if (this.closed) return; this.ev.calleePartial(id, parts.slice(0, j).join(" ")); }
    await this.wait(200);
    if (this.closed) return;
    this.ev.calleeFinal(id, line, parts.map((w) => ({ text: w, confidence: 0.93 })));
  }
  stopSpeaking() { this.stopSpeak?.(); }
  silenceMs() { return Infinity; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() { this.closed = true; for (const t of this.timers) clearTimeout(t); this.timers.clear(); }
}

/** Scripted agent for mock legs: opens, asks, ends once a price has been heard. Never books. */
export class CompareMockLlm implements LlmProvider {
  name = "mock-compare";
  constructor(private lang: Lang = "no") {}
  async clarify() { return { summary: "", questions: [] }; }
  async plan() { return { calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }; }
  async summarize(ctx: AgentContext): Promise<SummaryOut> {
    const t = ctx.history.filter((h) => h.role === "callee").map((h) => h.text).join(" ");
    const price = t.match(/(\d+)\s*(kr|kroner)/i)?.[1];
    const time = t.match(/\b(\d{1,2}[:.]\d{2})\b/)?.[1]?.replace(".", ":");
    const details: Record<string, string> = {};
    if (price) details.pris = `${price} kr`;
    if (time) details.tid = `kl. ${time}`;
    return price
      ? { outcome: "done", summary: `${price} kr${time ? `, tidligst ${time}` : ""}`, details }
      : { outcome: "partial", summary: "Fikk ikke pris", details };
  }
  async *reply(ctx: AgentContext, signal: AbortSignal): AsyncIterable<string> {
    const callee = [...ctx.history].reverse().find((h) => h.role === "callee")?.text ?? "";
    const no = this.lang !== "en";
    const priced = /\d+\s*(kr|kroner)/i.test(callee);
    const text = priced
      ? (no ? "Takk, det var det jeg lurte på. Jeg tar kontakt igjen. Ha det bra! [[END: done | pris og tid notert]]" : "Thanks, that's all I needed. We'll get back to you. Goodbye! [[END: done | price and time noted]]")
      : (no ? "Jeg lurer på hva en stor pepperoni koster, og når tidligste henting er? Jeg bestiller ikke nå, jeg spør bare." : "I'm wondering what a large pepperoni costs and the earliest pickup time? I'm not ordering now, just asking.");
    for (const w of text.split(/(?<=\s)/)) { if (signal.aborted) return; await new Promise((r) => setTimeout(r, 10)); yield w; }
  }
}
