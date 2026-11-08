import { describe, expect, test } from "bun:test";
import { disclosureLine, ensureDisclosure, reasonForPrompt } from "../src/safety.ts";
import { agentSystemPrompt } from "../src/llm/prompt.ts";
import type { AgentContext } from "../src/llm/types.ts";

const base = { name: "Ola", hearCall: false };

describe("opening", () => {
  test("default is short, no reason, no «si nei»", () => {
    expect(disclosureLine(base)).toBe("Hei, jeg er en KI som ringer for Ola.");
    expect(disclosureLine(base, "en")).toBe("Hi, I'm an AI calling for Ola.");
    expect(disclosureLine({ ...base, reason: "deaf" })).not.toContain("døv"); // when_helpful by default
  });
  test("always + deaf names the reason", () => {
    expect(disclosureLine({ ...base, reason: "deaf", reasonMode: "always" })).toBe("Hei, jeg er en KI som ringer for Ola, som er døv.");
    expect(disclosureLine({ ...base, reason: "deaf", reasonMode: "always" }, "en")).toBe("Hi, I'm an AI calling for Ola, who is Deaf.");
  });
  test("hearCall no longer lengthens the opening", () => {
    expect(disclosureLine({ ...base, hearCall: true })).not.toContain("følger med");
  });
  test("never mode and when_helpful keep the reason out", () => {
    for (const reasonMode of ["never", "when_helpful"] as const) {
      expect(disclosureLine({ ...base, reason: "deaf", reasonMode })).toBe("Hei, jeg er en KI som ringer for Ola.");
    }
  });
  test("other uses the free text; empty text says nothing", () => {
    expect(disclosureLine({ ...base, reason: "other", reasonText: "har dysleksi", reasonMode: "always" })).toContain("Ola, som har dysleksi.");
    expect(disclosureLine({ ...base, reason: "other", reasonText: "has dyslexia", reasonMode: "always" }, "en")).toContain("Ola, who has dyslexia.");
    expect(disclosureLine({ ...base, reason: "other", reasonMode: "always" })).toBe("Hei, jeg er en KI som ringer for Ola.");
  });
  test("ensureDisclosure keeps the rest of the plan's opening", () => {
    expect(ensureDisclosure("Hei, jeg er en KI-assistent som ringer for X. Kan jeg bestille bord?", base)).toBe("Hei, jeg er en KI som ringer for Ola. Kan jeg bestille bord?");
  });
});

describe("prompt", () => {
  const ctx = (p: Parameters<typeof reasonForPrompt>[0], lang: "no" | "en"): AgentContext => ({
    goal: "g", calleeName: "Pizzabakeren", userName: "Ola", reason: reasonForPrompt(p), willShare: [], needsApprovalFor: [],
    profileFacts: {}, tone: "friendly", simpler: false, lang, history: [],
  });
  test("when_helpful allows the reason only when asked", () => {
    expect(agentSystemPrompt(ctx({ reason: "deaf" }, "no"))).toContain("Nevn det aldri ellers");
    expect(agentSystemPrompt(ctx({ reason: "deaf" }, "en"))).toContain("Never mention it otherwise");
  });
  test("never/unset: no reason text, «can't take the call right now»", () => {
    const p = agentSystemPrompt(ctx({ reason: "deaf", reasonMode: "never" }, "no"));
    expect(p).toContain("ikke kan ta samtalen akkurat nå");
    expect(p).not.toContain("er døv");
    expect(agentSystemPrompt(ctx({}, "en"))).toContain("can't take the call right now");
  });
});
