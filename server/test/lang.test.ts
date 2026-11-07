// Call language: picked from the task, switchable mid-call, and every safety rule works in English.
import { describe, expect, test } from "bun:test";
import type { Lang, LiveEvent } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import type { LlmProvider } from "../src/llm/types.ts";
import { callLangFor, guessLang, langFromText, LINES } from "../src/call/lines.ts";
import { calleeProposesCommitment, detectSecretAsk, ensureDisclosure, isCommitment } from "../src/safety.ts";

describe("picking the call language", () => {
  test("explicit cues win", () => {
    expect(langFromText("Ring mamma, snakk engelsk")).toBe("en");
    expect(langFromText("Call the dentist in Norwegian")).toBe("no");
    expect(langFromText("Bestill pizza")).toBeUndefined();
  });
  test("the task's own language decides when it is clear", () => {
    expect(guessLang("Bestill en stor pepperoni fra Domino's Storo til 18:00")).toBe("no");
    expect(guessLang("Order a large pepperoni from Domino's Storo for 6pm")).toBe("en");
    expect(guessLang("Domino's")).toBeUndefined();
  });
  test("otherwise the default", () => {
    expect(callLangFor("Domino's", "en")).toBe("en");
    expect(callLangFor("Domino's", "no")).toBe("no");
    expect(callLangFor("Book a haircut at 3, på norsk", "en")).toBe("no");
  });
});

describe("safety rules in English", () => {
  test("disclosure is forced into the opening", () => {
    const o = ensureDisclosure("Hello there!", "Sverre", "en");
    expect(o).toStartWith("Hi, I'm an AI assistant calling on behalf of Sverre, who is following the call.");
    expect(o).toContain("say no");
    expect(ensureDisclosure("Hei, jeg er en KI-assistent som ringer på vegne av Sverre.", "Sverre", "en")).not.toContain("KI-assistent");
  });
  test("card, ID number and address asks are caught", () => {
    expect(detectSecretAsk("Can I have your card number?")).toBe("card");
    expect(detectSecretAsk("What's the security code on the back?")).toBe("card");
    expect(detectSecretAsk("Hi, how can I help?")).toBeNull();
  });
  test("commitments need approval", () => {
    expect(isCommitment("Yes, I confirm the order.")).toBe(true);
    expect(isCommitment("Please go ahead and book it.")).toBe(true);
    expect(isCommitment("What does it cost?")).toBe(false);
    expect(calleeProposesCommitment("That comes to 189 kroner. Shall I put the order in?")).toBe(true);
  });
  test("every canned line exists in both languages", () => {
    for (const k of Object.keys(LINES.no) as (keyof typeof LINES.no)[]) expect(LINES.en[k]).toBeDefined();
  });
});

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  lang: Lang = "no";
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  async speak(text: string) { this.spoken.push(text); await Bun.sleep(2); return { interrupted: false }; }
  stopSpeaking() {}
  silenceMs() { return 10_000; }
  startWaitingSound() {}
  stopWaitingSound() {}
  setLang(l: Lang) { this.lang = l; }
  async hangup() {}
}

const llm: LlmProvider = {
  name: "fake",
  clarify: async () => ({ summary: "", questions: [] }),
  plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
  summarize: async () => ({ outcome: "partial" as const, summary: "x", details: {} }),
  async *reply() { yield "Okay."; },
};

describe("switching language mid-call", () => {
  test("«speak English» switches STT/TTS and the fixed lines", async () => {
    const line = new Line();
    const s = new CallSession({
      callId: "lang1", taskId: "t", line, llm,
      plan: { taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" }, goal: "bestille pizza", opening: "", willShare: [], needsApprovalFor: [], voiceId: "v", callLang: "no" },
      profile: { name: "Petter", hearCall: true, personality: "warm", lang: "no" },
    });
    const evs: LiveEvent[] = [];
    s.subscribe((e) => evs.push(e));
    await s.start();
    await Bun.sleep(30);
    expect(line.spoken[0]).toStartWith("Hei, jeg er en KI-assistent");
    s.command({ type: "instruction", text: "Speak English, they don't understand Norwegian" });
    expect(line.lang).toBe("en");
    expect(evs.some((e) => e.type === "note" && /engelsk/i.test(e.text))).toBe(true);
    line.ev.calleeFinal("c1", "Can I have your card number?");
    await Bun.sleep(80);
    expect(line.spoken.some((t) => /can't give card numbers/.test(t))).toBe(true);
    await s.finish("test");
  });
});
