// The app shows notes and summaries in its own language, not the call language.
import { describe, expect, test } from "bun:test";
import { HoldFlow } from "../src/call/hold.ts";
import { isPriceRule, UI_TEXT } from "../src/call/ui-text.ts";
import { clarifyPrompt, summaryPrompt } from "../src/llm/prompt.ts";
import { mockSummary } from "../src/llm/mock.ts";
import { filterOutgoing } from "../src/safety.ts";
import type { AgentContext } from "../src/llm/types.ts";

const ctx = (uiLang: "no" | "en", goal = "order a large pepperoni for pickup at 18:00"): AgentContext => ({
  goal, calleeName: "Domino's", history: [{ role: "callee", text: "That's 189 kr." }, { role: "user", text: "[godkjent] ja" }], uiLang,
} as unknown as AgentContext);

describe("UI language", () => {
  test("both languages have every text", () => {
    const keys = (o: object): string[] => Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k])).sort();
    expect(keys(UI_TEXT.en)).toEqual(keys(UI_TEXT.no));
  });
  test("the summary prompt asks for the app language", () => {
    expect(summaryPrompt(ctx("en"))).toContain("one line in English");
    expect(summaryPrompt(ctx("no"))).toContain("én linje på norsk");
  });
  test("the clarify prompt asks for the summary in the app language", () => {
    const task = { text: "x", lang: "en" as const, profile: {} as never };
    expect(clarifyPrompt(task)).toContain("én linje på engelsk");
  });
  test("mock summary follows the app language, even for a Norwegian goal", () => {
    expect(mockSummary(ctx("en")).summary).toBe("Ordered: a large pepperoni for pickup at 18:00, 189 kr.");
    expect(mockSummary(ctx("en", "bestille en stor pepperoni")).summary).toStartWith("Ordered:");
    expect(mockSummary(ctx("no", "bestille en stor pepperoni")).summary).toStartWith("Bestilt:");
  });
  test("blocked notes follow the app language", () => {
    expect(filterOutgoing("Card 4111 1111 1111 1111.", { willShare: [], uiLang: "en" }).blocked).toBe(UI_TEXT.en.blocked.card);
    expect(filterOutgoing("Kort 4111 1111 1111 1111.", { willShare: [] }).blocked).toBe(UI_TEXT.no.blocked.card);
  });
  test("price rules in either language count", () => {
    expect(isPriceRule("pris over 0 kr")).toBe(true);
    expect(isPriceRule("any price above 0 kr")).toBe(true);
    expect(isPriceRule("price (limit: up to 250 kr)")).toBe(true);
    expect(isPriceRule("confirming an order")).toBe(false);
  });
  test("hold notes follow the app language", async () => {
    const notes: string[] = [];
    const h = new HoldFlow({ userName: "Sam", notes: () => UI_TEXT.en.hold, say: async () => {}, note: (t) => notes.push(t), sound: () => {}, giveUp: async () => {}, debug: () => {} });
    (h as any).state = "waiting";
    await (h as any).ask();
    h.cancel();
    expect(notes[0]).toBe(UI_TEXT.en.hold.asking);
  });
});
