// Regressions from Sverre's app call #9 (lead review).
import { describe, expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import { PICKUP_NO_ADDRESS, isCommitment } from "../src/safety.ts";

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push(text); await Bun.sleep(5); return { interrupted: false }; }
  stopSpeaking() {}
  silenceMs() { return Infinity; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}
function llm(replies: string[]): LlmProvider {
  let i = 0;
  return {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "x", details: {} }),
    async *reply() { yield replies[Math.min(i++, replies.length - 1)]!; },
  };
}
const plan: Plan = {
  taskId: "t", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting klokka 18:00", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};
async function session(replies: string[]) {
  const line = new Line();
  const s = new CallSession({ callId: `n_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: llm(replies) });
  const evs: LiveEvent[] = [];
  s.subscribe((e) => evs.push(e));
  await s.start();
  await Bun.sleep(30);
  const say = async (id: string, t: string, ms = 80) => { line.ev.calleeFinal(id, t); await Bun.sleep(ms); };
  const approvals = () => evs.filter((e): e is Extract<LiveEvent, { type: "approval_request" }> => e.type === "approval_request");
  return { line, s, evs, say, approvals, said: () => line.spoken.slice(1) };
}

describe("1: no commitment without an approval for exactly that", () => {
  test("any tense and word order", () => {
    for (const t of ["Jeg bestiller en stor pepperoni-pizza til henting.", "Da bestiller jeg den.", "Jeg har bestilt en pizza.", "Jeg bekreftet bestillingen.", "Jeg godtar prisen."]) expect(isCommitment(t)).toBe(true);
    for (const t of ["Jeg vil gjerne bestille en pizza.", "Før jeg bestiller,", "Kan jeg bestille?"]) expect(isCommitment(t)).toBe(false);
  });
  test("«Jeg bestiller …» right after the wait line is blocked", async () => {
    const { s, say, said, approvals } = await session(["Så bra. Jeg bestiller en stor pepperoni-pizza til henting."]);
    await say("c1", "Det går fint det.");
    expect(said().join(" ")).not.toContain("bestiller");
    expect(approvals().length).toBe(1);
    await s.finish("test");
  });
  test("a «Ja» to a side question is not permission to commit", async () => {
    const { s, say, said, approvals } = await session(["Jeg bestiller en stor pepperoni til henting."]);
    await say("c1", "Vil du ha ekstra ost?");
    const extra = approvals()[0]!;
    s.command({ type: "approval_response", id: extra.id, choice: "Ja" });
    await Bun.sleep(100);
    expect(said().join(" ")).not.toContain("Jeg bestiller");
    expect(approvals().length).toBe(2); // the commitment became its own card
    await s.finish("test");
  });
  test("approved pepperoni doesn't cover a different item", async () => {
    const { s, say, said, approvals } = await session([
      "[[ASK: En stor pepperoni for 189 kr. Skal jeg bestille? | JA | NEI]]",
      "Da bestiller jeg en hawaii i stedet.",
    ]);
    await say("c1", "Det blir 189 kroner.");
    s.command({ type: "approval_response", id: approvals()[0]!.id, choice: "JA" });
    await Bun.sleep(100);
    expect(said().join(" ")).not.toContain("hawaii");
    await s.finish("test");
  });
});

describe("2+3: errand once, no filler openers, polite", () => {
  test("restating the errand is dropped after the first time", async () => {
    const { s, say, said } = await session([
      "Jeg ringer for å bestille en stor pepperoni til henting.",
      "Jeg vil gjerne bestille en stor pepperoni hvis det passer.",
      "Kan jeg bestille en stor pepperoni?",
    ]);
    await say("c1", "Hei, Domino's.");
    await say("c2", "Hm, vent litt.");
    await say("c3", "Ja, og?");
    expect(said()).toEqual(["Jeg ringer for å bestille en stor pepperoni til henting."]);
    await s.finish("test");
  });
  test("«Skjønner.» / «Okei, …» openers go", async () => {
    const { s, say, said } = await session(["Skjønner. Den står på Sverre.", "Okei, da tar vi den klokka 18:00."]);
    await say("c1", "Hvilket navn?");
    await say("c2", "Når vil du hente?");
    expect(said()).toEqual(["Den står på Sverre.", "Da tar vi den klokka 18:00."]);
    await s.finish("test");
  });
});

describe("4+5: no meta talk, no asking who they are", () => {
  test("pickup order: the address question gets a plain answer, no card", async () => {
    const { s, say, said, approvals } = await session(["unused"]);
    await say("c1", "Hva er adressen din?");
    expect(said()).toEqual([PICKUP_NO_ADDRESS]);
    expect(approvals().length).toBe(0);
    await s.finish("test");
  });
  test("«Hvilken filial er det?» is never asked", async () => {
    const { s, say, said } = await session(["Hvilken filial er det?"]);
    await say("c1", "Hei, Domino's her.");
    expect(said()).toEqual([]);
    await s.finish("test");
  });
});

describe("6: one transcript line per agent turn", () => {
  test("clauses share one id; the result transcript has one agent line", async () => {
    const { s, say, evs } = await session(["Det er til henting, så du trenger ikke adressen."]);
    await say("c1", "Hvor skal den leveres?");
    const all = evs.filter((e): e is Extract<LiveEvent, { type: "transcript" }> => e.type === "transcript" && e.who === "agent");
    const agent = all.filter((e) => e.id !== all[0]!.id); // without the opening line
    expect(new Set(agent.map((e) => e.id)).size).toBe(1);
    expect(agent.at(-1)).toMatchObject({ final: true, text: "Det er til henting, så du trenger ikke adressen." });
    await s.finish("test");
    const res = (evs.at(-1) as any).result;
    expect(res.transcript.filter((l: any) => l.who === "agent").length).toBe(2); // opening + this turn
  });
});

describe("7: a plain «Nei» goes to the user", () => {
  test("«Nei» to our price question → card, no «hører deg ikke»", async () => {
    const { s, say, said, approvals } = await session(["Kan dere ha den klar til 18:00 for 189 kroner?", "Beklager, jeg hørte ikke helt."]);
    await say("c1", "Hva vil du ha?");
    await say("c2", "Nei.");
    expect(approvals().length).toBe(1);
    expect(approvals()[0]!.options).toEqual(["Prøv noe annet", "Legg på"]);
    expect(said().join(" ")).not.toMatch(/hører deg|hørte ikke/);
    await s.finish("test");
  });
});
