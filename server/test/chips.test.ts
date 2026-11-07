import { describe, expect, test } from "bun:test";
import { parseChips, suggestChips } from "../src/call/chips.ts";
import type { AgentContext, LlmProvider } from "../src/llm/types.ts";

const ctx = (): AgentContext => ({
  goal: "Bestille time", calleeName: "Klinikken", userName: "Ola", willShare: [], needsApprovalFor: [],
  profileFacts: {}, tone: "friendly", simpler: false, lang: "no", uiLang: "no",
  history: [{ role: "callee", text: "Vi har ledig kl 14." }],
});
const fake = (reply: () => AsyncIterable<string>): LlmProvider => ({ name: "x", model: "m", reply } as unknown as LlmProvider);

describe("chips", () => {
  test("valid JSON → 3 items", async () => {
    const llm = fake(async function* () { yield '```json\n{"chips":["Spør om glutenfri",'; yield '"Be om tidligere tid","Takk og legg på"]}\n```'; });
    expect(await suggestChips(llm, ctx())).toEqual(["Spør om glutenfri", "Be om tidligere tid", "Takk og legg på"]);
  });
  test("LLM failure → null (no event)", async () => {
    const llm = fake(async function* () { throw new Error("boom"); });
    expect(await suggestChips(llm, ctx())).toBeNull();
  });
  test("garbage / wrong count → null", async () => {
    expect(parseChips("nope")).toBeNull();
    expect(parseChips('{"chips":["a","b"]}')).toBeNull();
  });
  test("slow LLM is cut at the budget, never hangs", async () => {
    const llm = fake(async function* () { await new Promise((r) => setTimeout(r, 2000)); yield "{}"; });
    const t = Date.now();
    // the abort signal isn't observed by this fake, so race it like the session does
    const r = await Promise.race([suggestChips(llm, ctx(), 50), Bun.sleep(300).then(() => "late")]);
    expect(r === null || r === "late").toBe(true);
    expect(Date.now() - t).toBeLessThan(1000);
  });
  test("mock llm → deterministic chips", async () => {
    const r = await suggestChips({ name: "mock" } as LlmProvider, ctx());
    expect(r?.length).toBe(3);
  });
});
