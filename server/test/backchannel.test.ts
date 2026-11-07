import { describe, expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import type { LlmProvider } from "../src/llm/types.ts";

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push(text); await Bun.sleep(5); return { interrupted: false }; }
  stopSpeaking() {}
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}

function llm(delayMs: number, text?: string): LlmProvider {
  const answers = ["Den står på Sverre.", "Henting klokka seks passer fint.", "Da tar vi det slik.", "Supert, takk for det."];
  let n = 0;
  return {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "x", details: {} }),
    async *reply() { await Bun.sleep(delayMs); yield text ?? answers[n++ % answers.length]!; },
  };
}

const plan: Plan = { taskId: "t", callee: { name: "X", phone: "+4722000001", source: "user" }, goal: "bestille pizza", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v" };
const BACK = ["Ja.", "Okei.", "Skjønner."];

async function session(l: LlmProvider) {
  const line = new Line();
  const s = new CallSession({ callId: `b_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: l });
  const evs: LiveEvent[] = [];
  s.subscribe((e) => evs.push(e));
  await s.start();
  await Bun.sleep(30);
  return { line, s, evs };
}

describe("backchannel", () => {
  test("never when the reply is ready fast", async () => {
    const { line, s } = await session(llm(50));
    for (let i = 0; i < 3; i++) { line.ev.calleeFinal(`c${i}`, `Greit, notert nummer ${i}.`); await Bun.sleep(200); }
    expect(line.spoken.filter((t) => BACK.includes(t))).toEqual([]);
    await s.finish("test");
  });

  test("slow replies: at most once every 3 turns, and varied", async () => {
    const { line, s } = await session(llm(1500));
    for (let i = 0; i < 4; i++) { line.ev.calleeFinal(`c${i}`, `Greit, notert nummer ${i}.`); await Bun.sleep(1700); }
    const backs = line.spoken.filter((t) => BACK.includes(t));
    expect(backs.length).toBe(2); // turn 1 and turn 4
    expect(backs[0]).not.toBe(backs[1]);
    await s.finish("test");
  }, 15_000);

  test("never after a question from the callee", async () => {
    const { line, s } = await session(llm(1500));
    line.ev.calleeFinal("c0", "Hvilket navn skal den stå på?");
    await Bun.sleep(1700);
    expect(line.spoken.filter((t) => BACK.includes(t))).toEqual([]);
    await s.finish("test");
  });
});

describe("goodbye", () => {
  test("agent says «ha det» without [[END]] → the call ends", async () => {
    const { line, s } = await session(llm(10, "Takk for hjelpen, ha det bra!"));
    line.ev.calleeFinal("c0", "Da er det fikset.");
    await Bun.sleep(150);
    expect(s.isEnded).toBe(true);
  });
});
