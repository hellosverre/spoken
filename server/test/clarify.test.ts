import { describe, expect, test } from "bun:test";
import { clarifyPrompt } from "../src/llm/prompt.ts";
import { mockClarify, mockPlan } from "../src/llm/mock.ts";
import type { TaskForLlm } from "../src/llm/types.ts";

const task = (text: string, lang: "no" | "en" = "no") => ({ text, lang, callLang: lang, phone: "+4722334455", profile: {} } as unknown as TaskForLlm);
const ids = (t: string, lang: "no" | "en" = "no") => mockClarify(task(t, lang)).questions.map((q) => q.id);

describe("clarify questions", () => {
  test("booking without time → asks date, time and people", () => {
    expect(ids("Bestill bord på Egon")).toEqual(["date", "time", "people"]);
    expect(ids("Book a table at Egon", "en")).toEqual(["date", "time", "people"]);
  });
  test("never asks what the request already says", () => {
    expect(ids("Bestill bord for 4 i kveld kl 19")).toEqual([]);
    expect(ids("Bestill bord i morgen")).toEqual(["time", "people"]);
  });
  test("plain question: nothing extra, and no confirmation question", () => {
    expect(ids("Hva er åpningstiden til Rema 1000?")).toEqual([]);
    for (const q of mockClarify(task("Bestill bord")).questions) expect(q.id).not.toBe("confirm");
    expect(mockClarify(task("Bestill bord")).questions.length).toBeLessThanOrEqual(4);
  });
  test("answers end up in the plan goal", () => {
    const p = mockPlan(task("Bestill bord på Egon"), { date: "I morgen", time: "19:00", people: "4" });
    expect(p.goal).toContain("19:00");
    expect(p.goal).toContain("4");
  });
  test("LLM prompt demands date + time + people, forbids a confirmation question", () => {
    const p = clarifyPrompt(task("Bestill bord"));
    expect(p).toMatch(/dato, klokkeslett og antall personer/);
    expect(p).toMatch(/IKKE en bekreftelse/);
    expect(p).toMatch(/Maks 4/);
  });
});
