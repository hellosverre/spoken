// Automatic language switching: detection, the switch rule, prompts for any language, handover.
import { describe, expect, test } from "bun:test";
import type { Lang, LiveEvent } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import { detectLang, LangSwitcher } from "../src/call/langswitch.ts";
import { langName, linesFor, LINES } from "../src/call/lines.ts";
import { agentSystemPrompt } from "../src/llm/prompt.ts";
import type { AgentContext, LlmProvider } from "../src/llm/types.ts";

const switcher = (start: Lang = "no") => {
  const log: string[] = [];
  return { sw: new LangSwitcher(start, (to) => log.push(to)), log };
};

describe("detectLang", () => {
  test("recognises full sentences", () => {
    expect(detectLang("Hello, how can I help you today?").lang).toBe("en");
    expect(detectLang("Hei, jeg kan ikke komme til dere på mandag").lang).toBe("no");
    expect(detectLang("Dzień dobry, chciałbym zamówić pizzę, czy to jest możliwe").lang).toBe("pl");
    expect(detectLang("Guten Tag, ich möchte bitte einen Tisch für heute").lang).toBe("de");
  });
  test("names, brands and single words give nothing", () => {
    expect(detectLang("Domino's Pizza").lang).toBeNull();
    expect(detectLang("Okay").lang).toBeNull();
    expect(detectLang("").lang).toBeNull();
  });
});

describe("switch rule", () => {
  test("no → en after two English segments", () => {
    const { sw, log } = switcher();
    expect(sw.feed("Yes, we have that")).toBeUndefined();
    expect(sw.feed("What time would you like it?")).toBe("en");
    expect(log).toEqual(["en"]);
    expect(sw.lang).toBe("en");
  });
  test("one long English segment switches at once", () => {
    const { sw } = switcher();
    expect(sw.feed("Sorry, I only speak English, can you please call back later")).toBe("en");
  });
  test("an English brand name inside Norwegian never flips", () => {
    const { sw, log } = switcher();
    for (const t of ["Velkommen til Domino's Pizza", "Pizza", "Ja, vi har Coca-Cola og Pepsi", "Hva vil du ha på pizzaen?"]) sw.feed(t);
    expect(log).toEqual([]);
  });
  test("a Norwegian segment between resets the streak", () => {
    const { sw, log } = switcher();
    sw.feed("Yes, we have that");
    sw.feed("Ja, det har vi, og det er ikke noe problem");
    sw.feed("What time is it?");
    expect(log).toEqual([]);
  });
  test("no → pl after a Polish handover", () => {
    const { sw, log } = switcher();
    expect(sw.feed("Dzień dobry, w czym mogę pomóc, czy to jest pilne")).toBe("pl");
    expect(log).toEqual(["pl"]);
  });
});

const ctx = (lang: Lang): AgentContext => ({
  lang, uiLang: "no", userName: "Petter", calleeName: "Domino's", goal: "order a pizza", profileFacts: {}, willShare: [],
  needsApprovalFor: [], tone: "friendly", history: [],
} as unknown as AgentContext);

describe("prompts", () => {
  test("Polish runs on the English prompt with «Always reply in Polish»", () => {
    const p = agentSystemPrompt(ctx("pl"));
    expect(p).toContain("Always reply in Polish");
    expect(p).toContain("POLISH only");
    expect(p).toContain("Rules:");
    expect(langName("pl")).toBe("Polish");
  });
  test("English and Norwegian are unchanged in language", () => {
    expect(agentSystemPrompt(ctx("en"))).toContain("ENGLISH only");
    expect(agentSystemPrompt(ctx("en"))).not.toContain("Always reply in");
    expect(agentSystemPrompt(ctx("no"))).toContain("Du snakker norsk");
  });
  test("handover rule is in both prompts", () => {
    expect(agentSystemPrompt(ctx("no"))).toContain("Overlevering:");
    expect(agentSystemPrompt(ctx("en"))).toContain("Handover:");
    expect(agentSystemPrompt(ctx("pl"))).toContain("Handover:");
  });
  test("other languages get the English fixed lines", () => {
    expect(linesFor("pl")).toBe(LINES.en);
    expect(linesFor("no")).toBe(LINES.no);
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

describe("in a live session", () => {
  test("two English segments switch the line and write «Byttet til engelsk»", async () => {
    const seen: Lang[] = [];
    const llm: LlmProvider = {
      name: "fake",
      clarify: async () => ({ summary: "", questions: [] }),
      plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
      summarize: async () => ({ outcome: "partial" as const, summary: "x", details: {} }),
      async *reply(c: AgentContext) { seen.push(c.lang); yield "Okay."; },
    };
    const line = new Line();
    const s = new CallSession({
      callId: "ls1", taskId: "t", line, llm,
      plan: { taskId: "t", callee: { name: "Domino's", phone: "+4722000001", source: "lookup" }, goal: "bestille pizza", opening: "", willShare: [], needsApprovalFor: [], voiceId: "v", callLang: "no" },
      profile: { name: "Petter", hearCall: true, personality: "warm", lang: "no" },
    });
    const evs: LiveEvent[] = [];
    s.subscribe((e) => evs.push(e));
    await s.start();
    await Bun.sleep(30);
    line.ev.calleeFinal("c1", "Yes, we have that");
    await Bun.sleep(60);
    expect(line.lang).toBe("no");
    line.ev.calleeFinal("c2", "What time would you like it?");
    await Bun.sleep(80);
    expect(line.lang).toBe("en");
    expect(evs.some((e) => e.type === "note" && e.text === "Byttet til engelsk")).toBe(true);
    expect(seen.at(-1)).toBe("en");
    await s.finish("test");
  });
});
