import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import { HOLD_LINES, HOLD_NOTES } from "../src/call/hold.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import { config } from "../src/config.ts";
import type { LlmProvider } from "../src/llm/types.ts";

// Real timings are 30 s / 20 s / 120 s; scaled down so the suite stays fast.
const saved = { ask: config.holdAskSec, remind: config.holdRemindSec, max: config.holdMaxSec };
beforeAll(() => { config.holdAskSec = 0.1; config.holdRemindSec = 0.15; config.holdMaxSec = 0.8; });
afterAll(() => { config.holdAskSec = saved.ask; config.holdRemindSec = saved.remind; config.holdMaxSec = saved.max; });

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  sound: false | "typing" | "music" = false;
  sounds: string[] = [];
  hungUp = false;
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push(text); await Bun.sleep(5); return { interrupted: false }; }
  stopSpeaking() {}
  startWaitingSound(kind: "typing" | "music" = "typing") { this.sound = kind; this.sounds.push(kind); }
  stopWaitingSound() { this.sound = false; }
  async hangup() { this.hungUp = true; }
}

/** Asks for approval on the first callee line, then says a fixed line. */
function llm(): LlmProvider {
  let n = 0;
  return {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "done", summary: "ok", details: {} }),
    async *reply() { yield n++ === 0 ? "[[ASK: 189 kr for en stor pepperoni? | JA | NEI]]" : "Ja takk, da bekrefter jeg det."; },
  };
}

const plan: Plan = {
  taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" }, goal: "bestille pizza",
  opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};

async function setup() {
  const line = new Line();
  const s = new CallSession({ callId: `h_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: llm() });
  const evs: LiveEvent[] = [];
  s.subscribe((e) => evs.push(e));
  await s.start();
  await Bun.sleep(30);
  line.ev.calleeFinal("c1", "Det blir 189 kroner. Skal jeg legge den inn?");
  await Bun.sleep(40);
  const ap = evs.find((e) => e.type === "approval_request") as Extract<LiveEvent, { type: "approval_request" }>;
  expect(ap).toBeDefined();
  const notes = () => evs.filter((e): e is Extract<LiveEvent, { type: "note" }> => e.type === "note").map((e) => e.text);
  return { line, s, evs, ap, notes };
}

describe("approval timeout → hold", () => {
  test("after the ask time the callee is asked to hold", async () => {
    const { line, s, notes } = await setup();
    await Bun.sleep(150);
    expect(line.spoken).toContain(HOLD_LINES.ask("Sverre"));
    expect(notes()).toContain(HOLD_NOTES.asking);
    await s.finish("test");
  });

  test("callee says yes → hold music, countdown notes, reminders", async () => {
    const { line, s, notes } = await setup();
    await Bun.sleep(150);
    line.ev.calleeFinal("c2", "Ja, det går fint.");
    await Bun.sleep(60);
    expect(line.sound).toBe("music");
    const holding = notes().find((n) => n.startsWith("Personen venter"));
    expect(holding).toMatch(/Personen venter… \d+ s \(ventemusikk på\)/);
    await Bun.sleep(200);
    expect(line.spoken).toContain(HOLD_LINES.remind);
    expect(notes().filter((n) => n.startsWith("Personen venter")).length).toBeGreaterThan(1);
    await s.finish("test");
  });

  test("callee says no → offers a callback and ends as partial", async () => {
    const { line, s, evs, notes } = await setup();
    await Bun.sleep(150);
    line.ev.calleeFinal("c2", "Nei, jeg har ikke tid.");
    await Bun.sleep(80);
    expect(line.spoken).toContain(HOLD_LINES.callback);
    expect(notes().some((n) => n.includes("ringe tilbake"))).toBe(true);
    expect(s.isEnded).toBe(true);
    expect((evs.at(-1) as any).result.outcome).toBe("partial");
    expect(line.hungUp).toBe(true);
  });

  test("user answers during hold → music stops, thanks the callee, continues", async () => {
    const { line, s, ap, notes } = await setup();
    await Bun.sleep(150);
    line.ev.calleeFinal("c2", "Ja da.");
    await Bun.sleep(60);
    expect(line.sound).toBe("music");
    s.command({ type: "approval_response", id: ap.id, choice: "JA" });
    await Bun.sleep(60);
    expect(line.sound).toBe(false);
    expect(notes()).toContain(HOLD_NOTES.resumed);
    const back = line.spoken.indexOf(HOLD_LINES.back);
    expect(back).toBeGreaterThan(-1);
    expect(line.spoken.slice(back + 1)).toContain("Ja takk, da bekrefter jeg det.");
    expect(s.isEnded).toBe(false);
    await s.finish("test");
  });

  test("no answer at all → callback after the max wait", async () => {
    const { line, s, evs } = await setup();
    await Bun.sleep(950);
    expect(line.spoken).toContain(HOLD_LINES.callback);
    expect(s.isEnded).toBe(true);
    expect((evs.at(-1) as any).result.outcome).toBe("partial");
  });

  test("user answers before the timeout → no hold lines at all", async () => {
    const { line, s, ap } = await setup();
    s.command({ type: "approval_response", id: ap.id, choice: "JA" });
    await Bun.sleep(200);
    expect(line.spoken).not.toContain(HOLD_LINES.ask("Sverre"));
    expect(line.spoken).not.toContain(HOLD_LINES.back);
    expect(line.spoken).toContain("Ja takk, da bekrefter jeg det.");
    await s.finish("test");
  });
});
