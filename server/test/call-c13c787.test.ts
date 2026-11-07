// Regressions from test call c_13c78747ac98 (Sat 7 Nov 15:29): the callee said «Nei.» to the
// AI disclosure, the agent ordered pizza anyway, then said the same line twice.
import { describe, expect, test } from "bun:test";
import type { Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import type { AgentContext, LlmProvider } from "../src/llm/types.ts";

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  quietSince = Date.now() - 10_000;
  speakMs = 5;
  left?: number; // what speechLeftMs() reports while speaking
  private cut?: () => void;
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
  speechLeftMs() { return this.left ?? Infinity; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}

function llm(replies: string[], delayMs = 0) {
  const seen: AgentContext["history"][] = [];
  const p: LlmProvider & { calls: number; seen: typeof seen } = {
    calls: 0,
    seen,
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial" as const, summary: "x", details: {} }),
    async *reply(ctx: AgentContext) {
      seen.push([...ctx.history]);
      const r = replies[Math.min(p.calls++, replies.length - 1)]!;
      if (delayMs) await Bun.sleep(delayMs);
      yield r;
    },
  };
  return p;
}

const plan: Plan = {
  taskId: "t", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting", opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};

async function session(replies: string[], delayMs = 0) {
  const line = new Line();
  const model = llm(replies, delayMs);
  const s = new CallSession({ callId: `c13_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Petter", hearCall: true, personality: "warm", lang: "no" }, line, llm: model });
  const dbg: string[] = [];
  const orig = s.debug.bind(s);
  s.debug = (k, d) => { dbg.push(k); orig(k, d); };
  await s.start();
  await Bun.sleep(30);
  return { line, model, s, dbg, said: () => line.spoken.slice(1) };
}

const ORDER = "Jeg vil gjerne bestille en stor pepperoni til henting.";

describe("a line that comes before we start talking", () => {
  test("restarts the turn so the reply answers it", async () => {
    const { s, line, model, said } = await session([ORDER, "Den er grei. Ha en fin dag!"], 150);
    line.ev.calleeFinal("c1", "Hallo, Domino's Storo her.");
    await Bun.sleep(40);
    line.ev.calleeFinal("c2", "Nei.");
    await Bun.sleep(500);
    expect(model.calls).toBe(2);
    expect(said()).not.toContain(ORDER);
    expect(said()).toContain("Ha en fin dag!");
    // The second reply saw «Nei.» last, marked as the answer to the disclosure.
    expect(model.seen[1]!.at(-1)?.text).toContain("Nei.");
    expect(model.seen[1]!.at(-1)?.text).toContain("⟨svar på om de vil snakke med en KI⟩");
    await s.finish("test");
  });
});

describe("a short line that batch STT calls noise", () => {
  test("does not start a turn when its hold timer fires", async () => {
    const { s, line, model } = await session([ORDER]);
    line.ev.calleeFinal("c1", "Okei.");
    await Bun.sleep(100);
    line.ev.calleeNoise?.("c1");
    await Bun.sleep(1000);
    expect(model.calls).toBe(0);
    await s.finish("test");
  });
});

describe("talk at the very end of our line", () => {
  test("doesn't cut it", async () => {
    const { s, line, dbg, said } = await session([ORDER]);
    line.speakMs = 300;
    line.ev.calleeFinal("c1", "Hva kan jeg hjelpe deg med?");
    await Bun.sleep(150);
    line.left = 100;
    line.ev.calleeSpeech();
    await Bun.sleep(600);
    expect(dbg).toContain("barge_in_at_end");
    expect(dbg).not.toContain("barge_in");
    expect(said().filter((t) => t === ORDER).length).toBe(1);
    await s.finish("test");
  });
});

describe("the same line again with nothing new from the callee", () => {
  test("is skipped", async () => {
    const Q = "Hvor lang ventetid har dere nå?";
    const { s, line, dbg, said } = await session([Q, Q]);
    line.speakMs = 200;
    line.ev.calleeFinal("c1", "Hva kan jeg hjelpe deg med?");
    await Bun.sleep(80);
    // Talk over us that batch STT later throws out: the turn reruns with nothing new.
    line.ev.calleeFinal("c2", "Ja, hva sa du der nå?");
    line.ev.calleeNoise?.("c2");
    await Bun.sleep(600);
    expect(dbg).toContain("skip_duplicate");
    // Said once, and at most once more by the cut-line resume, never by a new turn.
    expect(said().filter((t) => t === Q).length).toBeLessThanOrEqual(2);
    await s.finish("test");
  });
});
