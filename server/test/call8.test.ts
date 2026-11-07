// Regressions from call #8 (c_a88fc710dd1d): "talks too much and repeats too much".
import { describe, expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import { errandParts, parseErrand, shortenErrand } from "../src/call/style.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import { isCommitment } from "../src/safety.ts";

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
function llm(replies: string[], summary: "done" | "partial" = "done"): LlmProvider {
  let i = 0;
  return {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: summary, summary: "Bestilt.", details: {} }),
    async *reply() { yield replies[Math.min(i++, replies.length - 1)]!; },
  };
}
const plan: Plan = {
  taskId: "t", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting klokka 18:00", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};
async function session(replies: string[], summary?: "done" | "partial") {
  const line = new Line();
  const s = new CallSession({ callId: `e_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: llm(replies, summary) });
  const evs: LiveEvent[] = [];
  s.subscribe((e) => evs.push(e));
  await s.start();
  await Bun.sleep(30);
  const say = async (id: string, t: string, ms = 80) => { line.ev.calleeFinal(id, t); await Bun.sleep(ms); };
  return { line, s, evs, say, said: () => line.spoken.slice(1) };
}

describe("safety: commitments in Norwegian word order", () => {
  test("«da bestiller jeg» is a commitment; conditions and questions are not", () => {
    expect(isCommitment("Flott, da bestiller jeg en stor pepperoni.")).toBe(true);
    expect(isCommitment("Så bekrefter jeg det.")).toBe(true);
    expect(isCommitment("Før jeg bekrefter bestillingen,")).toBe(false);
    expect(isCommitment("Skal jeg bestille den?")).toBe(false);
  });
  test("«da bestiller jeg» without approval becomes an approval card", async () => {
    const { s, evs, say, said } = await session(["Flott, da bestiller jeg en stor pepperoni til 18:00."]);
    await say("c1", "Det går fint, det.");
    expect(said().some((t) => /bestiller jeg/.test(t))).toBe(false);
    expect(evs.some((e) => e.type === "approval_request")).toBe(true);
    await s.finish("test");
  });
});

describe("1: the full order is said once", () => {
  test("shortening helpers", () => {
    const e = parseErrand(plan.goal, "Sverre");
    expect(e).toEqual({ item: "en stor pepperoni", time: "18:00", name: "Sverre" });
    const full = "Flott, da bekrefter jeg en stor pepperoni med standard bunn til henting klokka 18:00 på navnet Sverre.";
    expect(errandParts(full, e)).toBe(3);
    expect(shortenErrand(full, e, "Supert.")).toBe("Flott, da bekrefter jeg den til 18:00.");
    // asked about the name → the name stays
    expect(shortenErrand("Den står på navnet Sverre, en stor pepperoni.", e, "Hvilket navn?")).toContain("navnet Sverre");
  });
  test("the second full statement is shortened in a call", async () => {
    const full = "Jeg vil gjerne bestille en stor pepperoni til henting klokka 18:00 på navnet Sverre.";
    const { s, say, said } = await session([full, "Ja, en stor pepperoni til henting klokka 18:00 på navnet Sverre, takk."]);
    await say("c1", "Hva kan jeg hjelpe med?");
    await say("c2", "Supert, det fikser vi.");
    expect(said()[0]).toBe(full);
    expect(said()[1]).not.toContain("navnet Sverre");
    expect(said()[1]).not.toContain("stor pepperoni");
    await s.finish("test");
  });
  test("one sentence per turn; no meta talk; no echo", async () => {
    const { s, say, said } = await session(["Jeg vil gjerne ha en stor pepperoni. Den skal hentes i dag. Og den skal være varm.", "Jeg må få bekreftet prisen før jeg kan gå videre.", "Jeg hører deg."]);
    await say("c1", "Hei, Domino's.");
    expect(said()).toEqual(["Jeg vil gjerne ha en stor pepperoni."]);
    await say("c2", "Hm.");
    await say("c3", "Jeg hører deg.");
    expect(said()).toEqual(["Jeg vil gjerne ha en stor pepperoni."]);
    await s.finish("test");
  });
});

describe("4: waiting for the user's approval", () => {
  test("one natural wait line, silence after, no «Hallo» while we wait", async () => {
    const { s, evs, say, said } = await session(["[[ASK: 274 kr for en stor pepperoni? | JA | NEI]]"]);
    await say("c1", "Det blir 274 kroner.");
    await say("c2", "Hallo?");
    await say("c3", "Er du der?");
    expect(said()).toEqual(["Et lite øyeblikk, jeg sjekker med Sverre."]);
    expect(evs.filter((e) => e.type === "approval_request").length).toBe(1);
    await s.finish("test");
  });
  test("the same question is not asked again after the user answered", async () => {
    const { s, evs, say } = await session([
      "[[ASK: Domino's sier 274 kroner for en stor pepperoni. Skal jeg bekrefte? | JA | NEI]]",
      "[[ASK: Domino's sier at en stor pepperoni koster 274 kroner. Skal jeg bekrefte bestillingen? | JA | NEI]]",
      "Ja takk, da bekrefter jeg den.",
      "Beklager, hva er galt?",
    ]);
    await say("c1", "Det blir 274 kroner.");
    const ap = evs.find((e) => e.type === "approval_request") as any;
    s.command({ type: "approval_response", id: ap.id, choice: "JA" });
    await Bun.sleep(60);
    await say("c2", "Dette er galt.", 150);
    expect(evs.filter((e) => e.type === "approval_request").length).toBe(1);
    await s.finish("test");
  });
  test("extras the plan didn't cover go to the user as a card", async () => {
    const { s, evs, say, said } = await session(["Ingen drikke, takk."]);
    await say("c1", "Hva slags drikke skal du ha?");
    const ap = evs.find((e) => e.type === "approval_request") as any;
    expect(ap.options).toEqual(["Nei", "Ja", "Skriv svar"]);
    expect(said().join(" ")).not.toContain("Ingen drikke");
    await s.finish("test");
  });
});

describe("6: «done» only with an approved deal and a clear yes from the callee", () => {
  test("no approval → partial even if the model says done", async () => {
    const { s, evs, say } = await session(["Takk, ha det bra! [[END: done | Bestilt.]]"]);
    await say("c1", "Begge to.", 150);
    expect(s.isEnded).toBe(true);
    expect((evs.at(-1) as any).result.outcome).toBe("partial");
  });
  test("approved + callee confirms → done", async () => {
    const { s, evs, say } = await session(["[[ASK: 189 kr for en stor pepperoni? | JA | NEI]]", "Ja takk, da bekrefter jeg den.", "Takk, ha det bra! [[END: done | Bestilt.]]"]);
    await say("c1", "Det blir 189 kroner.");
    const ap = evs.find((e) => e.type === "approval_request") as any;
    s.command({ type: "approval_response", id: ap.id, choice: "JA" });
    await Bun.sleep(80);
    await say("c2", "Supert, den er notert.", 150);
    expect((evs.at(-1) as any).result.outcome).toBe("done");
  });
});
