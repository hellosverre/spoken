// «femti» came back as «15.» (confidence 0.41) on c_28dd2d9a6285: the LLM must get both readings.
import { expect, test } from "bun:test";
import type { Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { numberHint, soundAlike } from "../src/call/numbers.ts";
import { CallSession } from "../src/call/session.ts";
import type { LlmProvider } from "../src/llm/types.ts";

test("-ten and -ti numbers map to each other", () => {
  expect(soundAlike(15)).toBe(50);
  expect(soundAlike(50)).toBe(15);
  expect(soundAlike(17)).toBe(70);
  expect(soundAlike(80)).toBe(18);
  expect(soundAlike(150)).toBe(115);
  expect(soundAlike(115)).toBe(150);
  expect(soundAlike(12)).toBeUndefined();
  expect(soundAlike(25)).toBeUndefined();
  expect(soundAlike(100)).toBeUndefined();
});

test("only unsure numbers get a hint; times are left alone", () => {
  expect(numberHint([{ text: "15.", confidence: 0.41 }])).toBe("⟨uklart tall: 15 eller 50⟩");
  expect(numberHint([{ text: "femti", confidence: 0.5 }])).toBe("⟨uklart tall: 50 eller 15⟩");
  expect(numberHint([{ text: "15.", confidence: 0.95 }])).toBe("");
  expect(numberHint([{ text: "12.17", confidence: 0.3 }])).toBe("");
  expect(numberHint([{ text: "kroner", confidence: 0.3 }])).toBe("");
});

class Line implements CallLine {
  ev!: LineEvents;
  readonly revises = true; // like the phone line: word confidences follow each final
  spoken: string[] = [];
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push(text); await Bun.sleep(5); return { interrupted: false }; }
  stopSpeaking() {}
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}

test("the LLM sees «15 eller 50» for an unsure 15", async () => {
  const seen: string[] = [];
  const llm: LlmProvider = {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "", details: {} }),
    async *reply(...args: unknown[]) { seen.push(JSON.stringify(args)); yield "Sa du femten eller femti?"; },
  };
  const plan: Plan = {
    taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" },
    goal: "spørre hva en pizza koster", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
  };
  const line = new Line();
  const s = new CallSession({ callId: `n_${Math.random()}`, taskId: "t", plan, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm });
  await s.start();
  await Bun.sleep(30);
  line.ev.calleeFinal("c1", "Den koster 15 kroner.");
  line.ev.calleeWords?.("c1", "Den koster 15 kroner.", [
    { text: "Den", confidence: 0.9 }, { text: "koster", confidence: 0.9 }, { text: "15", confidence: 0.41 }, { text: "kroner.", confidence: 0.9 },
  ]);
  await Bun.sleep(2500);
  expect(seen.some((a) => a.includes("uklart tall: 15 eller 50"))).toBe(true);
  await s.finish("test");
});
