import { describe, expect, test } from "bun:test";
import { Segmenter } from "../src/call/segment.ts";
import { CallSession } from "../src/call/session.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import { checkNumber, detectSecretAsk, ensureDisclosure, filterOutgoing, isCommitment } from "../src/safety.ts";
import { toSpeakable } from "../src/voice/speakable.ts";
import type { LiveEvent, Plan } from "../../shared/contract.ts";

describe("numbers", () => {
  test("emergency and short codes blocked, normal numbers pass", () => {
    for (const n of ["110", "112", "113", "+47113", "004711 2", "1412", "116117", "1881", "02800"]) expect(checkNumber(n).ok).toBe(false);
    expect(checkNumber("22 00 00 01")).toEqual({ ok: true, e164: "+4722000001" });
    expect(checkNumber("+1 773 340 8724").ok).toBe(true);
  });
});

describe("disclosure", () => {
  test("always first, even if the opening tries something else", () => {
    expect(ensureDisclosure("Hei, det er Sverre her!", "Sverre")).toStartWith("Hei, jeg er en KI-assistent som ringer på vegne av Sverre.");
    expect(ensureDisclosure("", "")).toStartWith("Hei, jeg er en KI-assistent som ringer på vegne av en bruker.");
  });
});

describe("secrets", () => {
  test("card, CVV, PIN and fnr never reach TTS", () => {
    const share = { willShare: ["name" as const] };
    expect(filterOutgoing("Kortnummeret er 4111 1111 1111 1111.", share).text).toBe("");
    expect(filterOutgoing("CVV er 123.", share).text).toBe("");
    expect(filterOutgoing("Fødselsnummeret er 01019012345.", share).text).toBe("");
    expect(filterOutgoing("Det er {{FNR}}.", share).text).not.toContain("{{FNR}}");
    expect(filterOutgoing("Det er {{FNR}}.", { willShare: ["fnr"], fnr: "01019012345" }).text).toContain("0 1 0 1");
    expect(filterOutgoing("Adressen er {{ADDRESS}}.", share).text).toBe("");
  });
  test("callee asking for card is detected", () => {
    expect(detectSecretAsk("Kan jeg få kortnummeret ditt?")).toBe("card");
    expect(detectSecretAsk("Hva er CVV-koden?")).toBe("card");
    expect(detectSecretAsk("Hva er fødselsnummeret?")).toBe("fnr");
    expect(detectSecretAsk("Hva skal det være?")).toBeNull();
  });
  test("commitments are recognised", () => {
    expect(isCommitment("Ja takk, da bekrefter jeg det.")).toBe(true);
    expect(isCommitment("Jeg booker timen klokka ti.")).toBe(true);
    expect(isCommitment("Hva koster den?")).toBe(false);
  });
});

describe("speakable", () => {
  test("numbers and times as words", () => {
    expect(toSpeakable("189 kr klokka 18:00")).toBe("hundre og åttini kroner klokka atten");
    expect(toSpeakable("Ring 22 00 00 01")).toBe("Ring to to null null null null null en");
    expect(toSpeakable("kl. 9.30")).toBe("klokka ni tretti");
  });
});

describe("segmenter", () => {
  test("splits sentences and tags while streaming", () => {
    const s = new Segmenter();
    const out = [..."Hei der. Jeg vil ha kl. 18 en pizza! [[ASK: Ja? | JA | NEI]]".split(/(?<=\s)/).flatMap((t) => s.push(t)), ...s.end()];
    expect(out).toEqual([
      { kind: "speech", text: "Hei der." },
      { kind: "speech", text: "Jeg vil ha kl. 18 en pizza!" },
      { kind: "ask", question: "Ja?", options: ["JA", "NEI"] },
    ]);
  });
});

// A line that "talks" forever until stopped, to test barge-in and the commitment guard.
class FakeLine implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  stopped = 0;
  private stop?: () => void;
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  speak(text: string) {
    this.spoken.push(text);
    return new Promise<{ interrupted: boolean }>((r) => {
      const t = setTimeout(() => r({ interrupted: false }), text.includes("lang") ? 5000 : 5);
      this.stop = () => { clearTimeout(t); r({ interrupted: true }); };
    });
  }
  stopSpeaking() { this.stopped++; this.stop?.(); }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}

function llmSaying(text: string): LlmProvider {
  return {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "x", details: {} }),
    async *reply() { yield text; },
  };
}

const plan: Plan = {
  taskId: "t", callee: { name: "Butikken", phone: "+4722000001", source: "user" }, goal: "spørre om pris",
  opening: "", willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};
const profile = { name: "Sverre", hearCall: true, personality: "warm" as const, lang: "no" as const };
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("session safety", () => {
  test("model committing without approval is stopped and turned into an approval_request", async () => {
    const line = new FakeLine();
    const s = new CallSession({ callId: "c1", taskId: "t", plan: { ...plan }, profile, line, llm: llmSaying("Jeg bestiller den til 300 kr.") });
    const evs: LiveEvent[] = [];
    s.subscribe((e) => evs.push(e));
    await s.start();
    await tick();
    line.ev.calleeFinal("c_1", "Den koster 300 kroner.");
    await tick(60);
    expect(line.spoken.some((t) => /bestiller/.test(t))).toBe(false);
    expect(evs.some((e) => e.type === "approval_request")).toBe(true);
    expect(line.spoken).toContain("Et øyeblikk…");
    await s.finish("test");
  });

  test("barge-in stops TTS at once", async () => {
    const line = new FakeLine();
    const s = new CallSession({ callId: "c2", taskId: "t", plan: { ...plan }, profile, line, llm: llmSaying("Dette er en lang setning som tar tid.") });
    await s.start();
    await tick();
    line.ev.calleeFinal("c_1", "Hei?");
    await tick();
    line.ev.calleeSpeech();
    expect(line.stopped).toBeGreaterThan(0);
    await s.finish("test");
  });
});

describe("g711", () => {
  test("A-law → µ-law keeps the signal", async () => {
    const { alawToLinear, alawToUlaw, ulawToLinear } = await import("../src/voice/ulaw.ts");
    for (const a of [0x55, 0xd5, 0x2a, 0xaa, 0x00, 0x80, 0x7f]) {
      const lin = alawToLinear(a);
      const back = ulawToLinear(alawToUlaw(new Uint8Array([a]))[0]!);
      expect(Math.abs(back - lin)).toBeLessThanOrEqual(Math.max(16, Math.abs(lin) * 0.07));
    }
    expect(Math.abs(alawToLinear(0x55))).toBeLessThan(16); // A-law silence
  });
});

describe("mock agent on a real human", () => {
  test("'Det går bra' after the opening → states the errand, no repeat loop", async () => {
    const { mockReplyText } = await import("../src/llm/mock.ts");
    const base = { goal: "bestille en stor pepperoni", calleeName: "X", userName: "Sverre", willShare: [], needsApprovalFor: [], profileFacts: {}, tone: "friendly" as const, simpler: false };
    const h = [{ role: "agent" as const, text: "Hei, jeg er en KI-assistent." }, { role: "callee" as const, text: "Det går bra." }];
    expect(mockReplyText({ ...base, history: h })).toStartWith("Jeg vil gjerne");
    const h2 = [...h, { role: "agent" as const, text: "Jeg vil gjerne bestille en stor pepperoni." }, { role: "callee" as const, text: "Mm hm hm." },
      { role: "agent" as const, text: "Beklager, linja er litt dårlig. Kan du si det en gang til?" }, { role: "callee" as const, text: "Mm." }];
    expect(mockReplyText({ ...base, history: h2 })).toContain("oppsummere");
  });
});

describe("call #2 replay: callee keeps saying the same thing", () => {
  for (const [label, said, outcome] of [
    ["yes-answers move the call on", "Det går bra.", "partial"],
    ["unintelligible → ends politely", "Mm hm.", "failed"],
  ] as const) test(label, async () => {
    const { MockLlm } = await import("../src/llm/mock.ts");
    const line = new FakeLine();
    const s = new CallSession({ callId: "c_replay", taskId: "t", plan: { ...plan, goal: "bestille en stor pepperoni til henting klokka 18:00" }, profile, line, llm: new MockLlm(0) });
    const evs: LiveEvent[] = [];
    s.subscribe((e) => evs.push(e));
    await s.start();
    await tick();
    for (const t of ["Det var det.", ...Array(6).fill(said)]) {
      if (s.isEnded) break;
      line.ev.calleeFinal(`c_${t}`, t);
      await tick(60);
    }
    await tick(100);
    const agentTurns = line.spoken.slice(1).map((x) => x.toLowerCase());
    for (let i = 1; i < agentTurns.length; i++) expect(agentTurns[i]).not.toBe(agentTurns[i - 1]);
    expect(agentTurns.filter((x) => x.startsWith("beklager, linja")).length).toBeLessThanOrEqual(1);
    expect(s.isEnded).toBe(true);
    expect((evs.at(-1) as any).result.outcome).toBe(outcome);
  });
});
