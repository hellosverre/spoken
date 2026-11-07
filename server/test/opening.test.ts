// The disclosure started on connect and «Hei, dette er Dominos» cut it off (c_28dd2d9a6285).
// Now: wait for the greeting, say the disclosure uncut, then answer.
import { expect, test } from "bun:test";
import type { Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import type { LlmProvider } from "../src/llm/types.ts";

class PhoneLine implements CallLine {
  ev!: LineEvents;
  readonly answersFirst = true;
  spoken: { text: string; at: number }[] = [];
  stops = 0;
  voicedAt = 0; // 0 = nobody has spoken
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push({ text, at: Date.now() }); await Bun.sleep(400); return { interrupted: false }; }
  stopSpeaking() { this.stops++; }
  silenceMs() { return this.voicedAt ? Date.now() - this.voicedAt : Infinity; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
  /** Callee says a line: voice now, final a little later (like the STT). */
  async callee(id: string, text: string) { this.voicedAt = Date.now(); await Bun.sleep(50); this.ev.calleeFinal(id, text); }
}

const plan: Plan = {
  taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};
function session(reply = "Jeg vil gjerne bestille en stor pepperoni til henting.") {
  let calls = 0;
  const llm: LlmProvider = {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "", details: {} }),
    async *reply() { calls++; yield reply; },
  };
  const line = new PhoneLine();
  const s = new CallSession({ callId: `o_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm });
  return { s, line, llmCalls: () => calls };
}
const isDisclosure = (t: string) => /KI-assistent/.test(t);

test("waits for «Hei, dette er Dominos» before the disclosure, and doesn't answer the greeting first", async () => {
  const { s, line } = session();
  await s.start();
  await Bun.sleep(200);
  expect(line.spoken.length).toBe(0); // connected, but they haven't greeted yet
  await line.callee("c0", "Hei, dette er Dominos, du snakker med Vil.");
  const greetedAt = Date.now();
  await Bun.sleep(300);
  expect(line.spoken.length).toBe(0); // still inside the 600 ms gap after the greeting
  await Bun.sleep(800);
  expect(line.spoken.length).toBe(1);
  expect(isDisclosure(line.spoken[0]!.text)).toBe(true);
  expect(line.spoken[0]!.at - greetedAt).toBeGreaterThanOrEqual(500);
  await s.finish("test");
});

test("the disclosure can't be interrupted; what they said over it is answered after", async () => {
  const { s, line, llmCalls } = session();
  await s.start();
  await line.callee("c0", "Domino's, hallo?");
  await Bun.sleep(750);
  expect(isDisclosure(line.spoken[0]?.text ?? "")).toBe(true);
  line.ev.calleeSpeech();
  await line.callee("c1", "Hvem er det?");
  expect(line.stops).toBe(0);
  expect(llmCalls()).toBe(0); // no reply before the disclosure is done
  await Bun.sleep(900);
  expect(line.spoken.length).toBe(2); // disclosure, then the answer
  await s.finish("test");
});

test("nobody speaks: disclosure after ~3 s, then the errand", async () => {
  const { s, line } = session();
  await s.start();
  await Bun.sleep(2500);
  expect(line.spoken.length).toBe(0);
  await Bun.sleep(800);
  expect(line.spoken.length).toBe(1);
  expect(isDisclosure(line.spoken[0]!.text)).toBe(true);
  await Bun.sleep(2700); // 400 ms speech + 2 s for a reply, then we go on
  expect(line.spoken.length).toBe(2);
  expect(line.spoken[1]!.text).toMatch(/pepperoni/);
  await s.finish("test");
}, 10000);
