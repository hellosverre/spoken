// Pre-call planning bench: clarify + plan on 3 Norwegian tasks per model, with latency and
// automatic checks; prints the questions and plan so a human can judge quality.
// Usage: bun scripts/plan-bench.ts [model,model,...]
import { OpenAiCompatLlm } from "../src/llm/openai-compat.ts";
import type { TaskForLlm } from "../src/llm/types.ts";

const key = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
if (!key) { console.error("No LLM_API_KEY"); process.exit(1); }
const MODELS = (process.argv[2] ?? "anthropic/claude-haiku-5.5,anthropic/claude-sonnet-5.5,deepseek/deepseek-v4.1-flash").split(",");
const profile = { name: "Sverre", hearCall: true, personality: "warm" as const, lang: "no" as const };
const TASKS: TaskForLlm[] = [
  { text: "Bestill en stor pepperoni fra Domino's Storo til 18:00", lang: "no", profile },
  { text: "Book time hos fastlegen min neste uke, helst formiddag", lang: "no", phone: "+4722000003", profile },
  { text: "Si opp treningsmedlemskapet mitt på SATS", lang: "no", phone: "+4722000005", profile },
];
const SHARE = ["name", "phone", "address", "email", "birthdate", "fnr", "allergies"];

for (const model of MODELS) {
  const llm = new OpenAiCompatLlm("openrouter", key, model, undefined, model);
  const times: number[] = [];
  const issues: string[] = [];
  const samples: string[] = [];
  for (const task of TASKS) {
    let t0 = performance.now();
    const c = await llm.clarify(task);
    const tClar = performance.now() - t0;
    const answers: Record<string, string> = {};
    for (const q of c.questions) answers[q.id] = q.options?.[0] ?? "ja";
    t0 = performance.now();
    const p = await llm.plan(task, answers);
    const tPlan = performance.now() - t0;
    times.push(tClar + tPlan);
    // Fallback to mock = the model failed (JSON or timeout): the mock's tell-tale «Stemmer det at jeg skal».
    if (c.questions.some((q) => q.text.startsWith("Stemmer det at jeg skal"))) issues.push(`${task.text.slice(0, 20)}: clarify fell back`);
    if (c.questions.length < 1 || c.questions.length > 5) issues.push("question count");
    if (!/stemmer|bekreft|riktig|ok\b|greit/i.test(c.questions.at(-1)?.text ?? "")) issues.push("last question doesn't confirm");
    if (p.willShare.some((s) => !SHARE.includes(s))) issues.push("bad willShare");
    if (p.willShare.includes("fnr") && !/lege/i.test(task.text)) issues.push("shares fnr needlessly");
    if (!/^[a-zæøå]/.test(p.goal) || /\b(the|please)\b/i.test(p.goal)) issues.push("goal not a Norwegian infinitive");
    samples.push(`  ${task.text}\n    ${(tClar / 1000).toFixed(1)} s clarify + ${(tPlan / 1000).toFixed(1)} s plan\n    Q: ${c.questions.map((q) => q.text + (q.options ? ` [${q.options.join(" / ")}]` : "")).join("\n       ")}\n    goal: ${p.goal}\n    share: ${p.willShare.join(", ")} | approve: ${p.needsApprovalFor.join("; ")}`);
  }
  const med = [...times].sort((a, b) => a - b)[1]!;
  console.log(`\n${model}: median clarify+plan ${(med / 1000).toFixed(1)} s | ${issues.length ? issues.join("; ") : "all checks ok"}`);
  console.log(samples.join("\n"));
}
process.exit(0);
