// Smart reply chips: after each callee turn, suggest 3 short next instructions the user can tap.
// Fire-and-forget: a failure or a slow model means no chips, never a delayed agent.

import type { Lang } from "../../../shared/contract.ts";
import type { AgentContext, HistoryItem, LlmProvider } from "../llm/types.ts";

export const CHIP_BUDGET_MS = 2500;
const MAX_LEN = 40;

export function parseChips(raw: string): string[] | null {
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const j = JSON.parse(raw.slice(a, b + 1));
    const items = (Array.isArray(j.chips) ? j.chips : Array.isArray(j.items) ? j.items : [])
      .filter((x: unknown): x is string => typeof x === "string")
      .map((s: string) => s.replace(/\s+/g, " ").trim().slice(0, MAX_LEN))
      .filter(Boolean);
    const uniq = [...new Set<string>(items)].slice(0, 3);
    return uniq.length === 3 ? uniq : null;
  } catch { return null; }
}

function mockChips(lang: Lang, calleeText: string): string[] {
  const q = /\?/.test(calleeText);
  return lang === "en"
    ? [q ? "Say yes" : "Ask about price", "Ask for an earlier time", "Thank them and hang up"]
    : [q ? "Svar ja" : "Spør om pris", "Be om tidligere tid", "Takk og legg på"];
}

/** Ask the LLM for 3 chips. Resolves null on any failure or timeout. */
export async function suggestChips(llm: LlmProvider, ctx: AgentContext, budgetMs = CHIP_BUDGET_MS): Promise<string[] | null> {
  const lang = ctx.uiLang ?? ctx.lang ?? "no";
  const lastCallee = [...ctx.history].reverse().find((h) => h.role === "callee")?.text ?? "";
  if (llm.name === "mock") return mockChips(lang, lastCallee);
  // Only real providers (they carry a model id) get a side request; scripted LLMs stay untouched.
  if (!llm.model) return null;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), budgetMs);
  try {
    const task = lang === "en"
      ? `IGNORE all rules above about speaking to the callee. Suggest exactly 3 short next instructions (max 5 words each, imperative, English) the user might send to you now. Answer ONLY with JSON: {"chips":["...","...","..."]}`
      : `IGNORER alle regler over om å snakke med mottakeren. Foreslå nøyaktig 3 korte neste instrukser (maks 5 ord hver, imperativ, norsk) brukeren kan sende deg nå. Svar KUN med JSON: {"chips":["...","...","..."]}`;
    const history: HistoryItem[] = [...ctx.history.filter((h) => h.role !== "system").slice(-6), { role: "system", text: task }];
    let out = "";
    for await (const tok of llm.reply({ ...ctx, history }, abort.signal)) out += tok;
    return parseChips(out);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
