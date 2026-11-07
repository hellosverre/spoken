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

test("a line batch calls noise is taken back and not answered", async () => {
  let replies = 0;
  const llm: LlmProvider = {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "", details: {} }),
    async *reply() { replies++; await Bun.sleep(300); yield "Beklager, hva sa du?"; },
  };
  const plan: Plan = {
    taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" },
    goal: "bestille pizza", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
  };
  const line = new Line();
  const s = new CallSession({ callId: `z_${Math.random()}`, taskId: "t", plan, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm });
  const events: { type: string; id?: string; text?: string }[] = [];
  s.subscribe((e) => events.push(e as { type: string; id?: string; text?: string }));
  await s.start();
  await Bun.sleep(30);
  const spokenBefore = line.spoken.length;
  line.ev.calleeFinal("c9", "Jeg vet ikke hva jeg skal gjøre.");
  line.ev.calleeWords?.("c9", "Jeg vet ikke hva jeg skal gjøre.", [{ text: "Jeg", confidence: 0.4 }]);
  await Bun.sleep(100);
  line.ev.calleeNoise?.("c9");
  await Bun.sleep(1500);
  expect(line.spoken.length).toBe(spokenBefore); // nothing said in answer to the made-up line
  expect(events.some((e) => e.type === "transcript" && e.id === "c9" && e.text === "")).toBe(true); // UI drops it
  await s.finish("test");
});

test("no «atten eller åtti?» after «klokka»", () => {
  expect(numberHint([{ text: "klokka", confidence: 0.9 }, { text: "atten.", confidence: 0.4 }])).toBe("");
  expect(numberHint([{ text: "kl.", confidence: 0.9 }, { text: "17", confidence: 0.4 }])).toBe("");
});

test("a made-up time is cut out, not left as silence (c_73b6b5529e9b)", async () => {
  const { withoutTimes } = await import("../src/time.ts");
  expect(withoutTimes("Jeg vil gjerne bestille en stor pepperoni til henting halv sju.")).toBe("Jeg vil gjerne bestille en stor pepperoni til henting.");
  expect(withoutTimes("Den er klar til kl. 18:30, flott.")).toBe("");
  expect(withoutTimes("Kan jeg hente klokka seks?")).toBe("Kan jeg hente?");
});

test("a time mid-sentence is not cut out", async () => {
  const { withoutTimes } = await import("../src/time.ts");
  expect(withoutTimes("Da mener du klokka 00:30, altså halv ett på natta.")).toBe("");
});
