// Regressions from test call c_cc7521a0c46d (Sat 7 Nov 14:56, «6 Cola Zero» at Domino's).
import { describe, expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import { asksUserWhereCallee, fixCardOptions, priceWarning } from "../src/call/approval.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import { parseErrand, restatesErrand } from "../src/call/style.ts";
import type { LlmProvider } from "../src/llm/types.ts";

/** A phone-like line: can be talked over, measures silence, sends batch checks. */
class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  readonly revises: boolean;
  quietSince = Date.now() - 10_000;
  private cut?: () => void;
  speakMs = 5;
  constructor(revises = false) { this.revises = revises; }
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) {
    this.spoken.push(text);
    const interrupted = await new Promise<boolean>((r) => {
      const t = setTimeout(() => r(false), this.speakMs);
      this.cut = () => { clearTimeout(t); r(true); };
    });
    this.cut = undefined;
    return { interrupted };
  }
  stopSpeaking() { this.cut?.(); }
  silenceMs() { return Date.now() - this.quietSince; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}

function llm(replies: string[], delayMs = 0): LlmProvider & { calls: number } {
  const p = {
    calls: 0,
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial" as const, summary: "x", details: {} }),
    async *reply() {
      const r = replies[Math.min(p.calls++, replies.length - 1)]!;
      if (delayMs) await Bun.sleep(delayMs);
      yield r;
    },
  };
  return p;
}

const plan: Plan = {
  taskId: "t", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en cola zero til henting", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};

async function session(replies: string[], opts: { revises?: boolean; delayMs?: number } = {}) {
  const line = new Line(opts.revises);
  const model = llm(replies, opts.delayMs);
  const s = new CallSession({ callId: `cc_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Petter", hearCall: true, personality: "warm", lang: "no" }, line, llm: model });
  const evs: LiveEvent[] = [];
  s.subscribe((e) => evs.push(e));
  await s.start();
  await Bun.sleep(30);
  const say = async (id: string, t: string, ms = 80) => { line.ev.calleeFinal(id, t); await Bun.sleep(ms); };
  const approvals = () => evs.filter((e): e is Extract<LiveEvent, { type: "approval_request" }> => e.type === "approval_request");
  return { line, model, s, evs, say, approvals, said: () => line.spoken.slice(1) };
}

describe("the order may be repeated when the callee asks about it", () => {
  const e = parseErrand("bestille en cola zero til henting", "Petter");
  test("questions and confusion let the answer through", () => {
    for (const c of ["Hvor mange cola bestilte du?", "Hei, jeg heter Petter, så, eh, hvor mange kullasjere vil du ha?", "Hva? Jeg skjønner ikke hva de prater om.", "Hvorfor faen ringer du dominos hvis du bare skal ha en cola sjef?"]) {
      expect(restatesErrand("Jeg vil bestille seks cola zero i 0,5 liter.", e, c)).toBe(false);
    }
  });
  test("an unprompted repeat is still dropped", () => {
    expect(restatesErrand("Jeg vil gjerne bestille en cola zero.", e, "Ja, det går fint.")).toBe(true);
  });
  test("the second half of a started sentence is said", async () => {
    const { s, say, said } = await session(["Jeg vil gjerne bestille en cola zero.", "Jeg ringer for Petter, og han ville ha en cola zero hos dere."]);
    await say("c1", "Hva vil du ha?");
    await say("c2", "Ja, det er greit.");
    expect(said().join(" ")).toContain("og han ville ha en cola zero hos dere.");
    await s.finish("test");
  });
});

describe("approval cards", () => {
  test("open questions get «Skriv svar», not JA / NEI", () => {
    expect(fixCardOptions("Hvilken størrelse vil du ha?", ["JA", "NEI"])).toEqual(["Skriv svar"]);
    expect(fixCardOptions("Skal jeg bestille seks cola zero i 0,5 liter?", ["JA", "NEI"])).toEqual(["JA", "NEI"]);
    expect(fixCardOptions("Dominos spør: «Hva slags brus?»", ["JA", "NEI"])).toEqual(["Skriv svar"]);
  });
  test("«how many» gets numbers", () => {
    expect(fixCardOptions("Dominos vil at du bestiller flere cola zero, hvor mange vil du ha?", ["Én", "Flere"])).toEqual(["1", "2", "Skriv svar"]);
    expect(fixCardOptions("Hvor mange vil du ha?", ["1", "6"])).toEqual(["1", "6", "Skriv svar"]);
  });
  test("real choices stay, plus a way to write", () => {
    expect(fixCardOptions("Hvilken størrelse, 0,5 liter eller 1,5 liter?", ["0,5 liter", "1,5 liter"])).toEqual(["0,5 liter", "1,5 liter", "Skriv svar"]);
  });
  test("asking the user where we called is caught", () => {
    expect(asksUserWhereCallee("Hvilken Dominos-restaurant skal jeg hente cola zero hos, og hva er adressen?")).toBe(true);
    expect(asksUserWhereCallee("Hvilken restaurant er det?")).toBe(true);
    expect(asksUserWhereCallee("Dominos vil ha 2800 kr. Godtar du det?")).toBe(false);
  });
  test("a price the agent already questioned is flagged", () => {
    const q = "Dominos vil ha 2800 kr for seks cola zero i 0,5 liter, klar til henting. Godtar du det?";
    expect(priceWarning(q, ["Tre tusen kroner for seks cola zero er mye, kan du sjekke prisen igjen?"])).toBe("Obs: prisen virker høy. ");
    expect(priceWarning(q, ["Hva koster det?"])).toBe("");
  });
  test("in a call: no card asking which restaurant, and open cards are fixed", async () => {
    const { s, say, approvals, said } = await session([
      "[[ASK: Hvilken Dominos-restaurant skal jeg hente cola zero hos, og hva er adressen? | JA | NEI]]",
      "Hos dere.",
      "[[ASK: Hvilken farge skal den ha? | JA | NEI]]",
    ]);
    await say("c1", "Hvor skal du hente den?", 150);
    expect(approvals().length).toBe(0);
    expect(said()).toContain("Hos dere.");
    await say("c2", "Var det noe mer du ville ha?", 150);
    expect(approvals().at(-1)?.options).toEqual(["Skriv svar"]);
    await s.finish("test");
  });
});

describe("faster replies", () => {
  test("the LLM starts before the batch check; speech waits for it", async () => {
    const { s, line, model, said } = await session(["Vi tar seks stykker i halvliter."], { revises: true });
    line.ev.calleeFinal("c1", "Kan jeg få seks Cola Zeros?");
    line.ev.calleeWords?.("c1", "Kan jeg få seks Cola Zeros?", [{ text: "seks", confidence: 0.3 }] as never);
    await Bun.sleep(300 + 60);
    expect(model.calls).toBe(1); // thinking already
    expect(said().length).toBe(0); // but not talking before the batch check
    line.ev.calleeBatchDone?.("c1");
    await Bun.sleep(60);
    expect(said()).toContain("Vi tar seks stykker i halvliter.");
    await s.finish("test");
  });
  test("an unsure word that isn't a number doesn't hold the reply back", async () => {
    const { s, line, said } = await session(["Ja, det har vi."], { revises: true });
    line.ev.calleeFinal("c1", "Har dere Cola Zero?");
    line.ev.calleeWords?.("c1", "Har dere Cola Zero?", [{ text: "Zero?", confidence: 0.3 }] as never);
    await Bun.sleep(300 + 60);
    expect(said()).toContain("Ja, det har vi."); // no batch check came, and we didn't wait for one
    await s.finish("test");
  });
});

describe("talked over by noise", () => {
  test("the cut sentence is said again when nothing real follows", async () => {
    const { s, line, said } = await session(["Da er det seks cola zero i 0,5 liter, klar til henting."]);
    line.speakMs = 200;
    line.ev.calleeFinal("c1", "Ja, seks cola zero.");
    await Bun.sleep(60);
    line.ev.calleeSpeech(); // a cough
    await Bun.sleep(1800);
    const all = said().join(" | ");
    expect(all.match(/klar til henting/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(said().filter((t) => /^(Som jeg sa, d|D)a er det seks cola zero i 0,5 liter, klar til henting\.$/.test(t)).length).toBe(1);
    await s.finish("test");
  });
});
