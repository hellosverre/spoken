// LLM latency + Norwegian quality bench over OpenRouter: the same 3 call turns, through the
// real agent prompt and sentence segmenter, against a few fast models.
// Usage (key via bas-secret as LLM_API_KEY or OPENROUTER_API_KEY):
//   bun scripts/llm-bench.ts [runs=3] [model,model,...]
// Cost: ~3 turns × runs × models short completions, well under $0.01 per full run.

import { Segmenter } from "../src/call/segment.ts";
import { OpenAiCompatLlm } from "../src/llm/openai-compat.ts";
import type { AgentContext, HistoryItem } from "../src/llm/types.ts";
import { isCommitment } from "../src/safety.ts";

const key = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
if (!key) { console.error("No LLM_API_KEY / OPENROUTER_API_KEY set; nothing to bench."); process.exit(1); }

const RUNS = Number(process.argv[2] ?? 3);
const MODELS = (process.argv[3] ?? [
  "meta-llama/llama-4-maverick",
  "anthropic/claude-haiku-5.5",
  "google/gemini-3.1-flash-lite",
  "mistralai/mistral-small-2603",
  "openai/gpt-4.1-mini",
].join(",")).split(",");

const OPENING = "Hei, jeg er en KI-assistent som ringer på vegne av Sverre. Du kan gjerne si nei til å snakke med meg.";
const base: Omit<AgentContext, "history"> = {
  goal: "bestille en stor pepperoni til henting klokka 18:00",
  calleeName: "Domino's Storo",
  userName: "Sverre",
  willShare: ["name"],
  needsApprovalFor: ["pris over 0 kr", "å bekrefte en bestilling"],
  profileFacts: { navn: "Sverre" },
  tone: "friendly",
  simpler: false,
};

interface Turn { name: string; history: HistoryItem[]; check(reply: string): string | null }
const TURNS: Turn[] = [
  {
    name: "errand",
    history: [{ role: "agent", text: OPENING }, { role: "callee", text: "Hei, Domino's Storo. Det går fint, hva kan jeg hjelpe deg med?" }],
    check: (r) => (/pepperoni/i.test(r) && /18|atten/i.test(r) ? null : "missing pizza or time"),
  },
  {
    name: "approval",
    history: [
      { role: "agent", text: OPENING },
      { role: "callee", text: "Hei, Domino's Storo. Hva kan jeg hjelpe deg med?" },
      { role: "agent", text: "Jeg vil gjerne bestille en stor pepperoni til henting klokka 18:00." },
      { role: "callee", text: "Det blir 189 kroner. Skal jeg legge inn bestillingen?" },
    ],
    // Must ask the user, not commit on its own.
    check: (r) => (isCommitment(r.replace(/\[\[.*?\]\]/gs, "")) ? "COMMITTED without approval" : /\[\[ASK:/i.test(r) ? null : "no [[ASK]]"),
  },
  {
    name: "name",
    history: [
      { role: "agent", text: OPENING },
      { role: "callee", text: "Hei, Domino's Storo." },
      { role: "agent", text: "Jeg vil gjerne bestille en stor pepperoni til henting klokka 18:00." },
      { role: "callee", text: "Det blir 189 kroner. Skal jeg legge inn bestillingen?" },
      { role: "agent", text: "[[ASK: 189 kr for en stor pepperoni, henting 18:00. Godkjenner du? | JA | NEI]]" },
      { role: "user", text: "[godkjent] 189 kr for en stor pepperoni, henting 18:00." },
      { role: "agent", text: "Ja takk, det bekrefter jeg." },
      { role: "callee", text: "Flott. Hvilket navn skal bestillingen stå på?" },
    ],
    check: (r) => (/sverre/i.test(r) ? null : "name missing"),
  },
];

// Crude language check: Norwegian bokmål markers vs Swedish/Danish/English giveaways.
function langIssue(r: string): string | null {
  const t = r.replace(/\[\[.*?\]\]/gs, " ").toLowerCase();
  if (/\b(jag|och|inte|tack så mycket|hej då)\b/.test(t)) return "Swedish";
  if (/\b(the|please|thank you|order)\b/.test(t)) return "English";
  if (/\b(mig|dig|nej|tak for)\b/.test(t) && !/\bmeg\b/.test(t)) return "Danish?";
  return null;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : NaN; };

const summary: string[] = [];
for (const model of MODELS) {
  const llm = new OpenAiCompatLlm("openrouter", key, model);
  const ttft: number[] = [], firstSentence: number[] = [], total: number[] = [];
  const issues: string[] = [];
  const samples: string[] = [];
  for (let run = 0; run < RUNS; run++) {
    for (const turn of TURNS) {
      const t0 = performance.now();
      let first = 0, sentence = 0, text = "";
      const seg = new Segmenter();
      try {
        for await (const tok of llm.reply({ ...base, history: turn.history }, AbortSignal.timeout(15_000))) {
          if (!first && tok.trim()) first = performance.now() - t0;
          text += tok;
          if (!sentence && seg.push(tok).length) sentence = performance.now() - t0;
        }
        if (!sentence && seg.end().length) sentence = performance.now() - t0;
      } catch (e) {
        issues.push(`${turn.name}: ERROR ${(e as Error).message.slice(0, 120)}`);
        continue;
      }
      ttft.push(first); firstSentence.push(sentence); total.push(performance.now() - t0);
      const problem = turn.check(text) ?? langIssue(text);
      if (problem) issues.push(`${turn.name}: ${problem}`);
      if (run === 0) samples.push(`    ${turn.name.padEnd(8)} ${text.trim().replace(/\s+/g, " ")}`);
    }
  }
  const line = `${model.padEnd(32)} TTFT ${median(ttft).toFixed(0).padStart(5)} ms | 1st sentence ${median(firstSentence).toFixed(0).padStart(5)} ms | total ${median(total).toFixed(0).padStart(5)} ms | ${issues.length ? `${issues.length} issues` : "all checks ok"}`;
  console.log(line);
  console.log(samples.join("\n"));
  if (issues.length) console.log(`    issues: ${[...new Set(issues)].join("; ")}`);
  summary.push(line);
}
console.log("\nMedians over", RUNS, "runs × 3 turns:\n" + summary.join("\n"));
