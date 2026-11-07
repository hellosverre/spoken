// Sverre's test call: «Okay?» then «jeg er et lite barn» got two replies, and a repeated
// question ended the call (c_ba0df20d31a5).
import { expect, test } from "bun:test";
import type { Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import type { LlmProvider } from "../src/llm/types.ts";

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  voicedAt = Date.now();
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push(text); await Bun.sleep(5); return { interrupted: false }; }
  stopSpeaking() {}
  silenceMs() { return Date.now() - this.voicedAt; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}
const plan: Plan = {
  taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};
function session(replies: string[]) {
  let i = 0;
  const llm: LlmProvider = {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "", details: {} }),
    async *reply() { yield replies[Math.min(i++, replies.length - 1)]!; },
  };
  const line = new Line();
  const s = new CallSession({ callId: `s_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm });
  return { s, line };
}

test("a short «Okay?» waits for the rest of the sentence: one reply, not two", async () => {
  const { s, line } = session(["Skjønner, takk for at du sier det.", "Andre svar."]);
  await s.start();
  await Bun.sleep(30);
  const before = line.spoken.length;
  line.voicedAt = Date.now();
  line.ev.calleeFinal("c1", "Okay?");
  await Bun.sleep(300);
  line.voicedAt = Date.now();
  line.ev.calleeFinal("c2", "Jeg er et lite barn.");
  await Bun.sleep(2000);
  expect(line.spoken.slice(before)).toEqual(["Skjønner, takk for at du sier det."]);
  await s.finish("test");
});

test("repeating a question once does not hang up", async () => {
  const q = "Hva koster en stor pepperoni?";
  const { s, line } = session([q, q, q]);
  await s.start();
  await Bun.sleep(30);
  line.ev.calleeFinal("c1", "Hei, Domino's, hva kan jeg hjelpe med?");
  await Bun.sleep(1500);
  line.ev.calleeFinal("c2", "Hæ, det hørte jeg ikke helt.");
  await Bun.sleep(1500);
  expect(s.isEnded).toBe(false);
  expect(line.spoken.filter((t) => t === q).length).toBe(2);
  expect(line.spoken.some((t) => /ikke godt nok/.test(t))).toBe(false);
  await s.finish("test");
});
