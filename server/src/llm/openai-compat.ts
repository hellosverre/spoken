// Mistral, OpenAI and OpenRouter all speak the chat-completions wire format (JSON mode +
// SSE streaming), so one small client covers them. Any failure falls back to the mock.

import type { Outcome, Question, Shareable } from "../../../shared/contract.ts";
import { MockLlm } from "./mock.ts";
import { agentSystemPrompt, clarifyPrompt, planPrompt, summaryPrompt } from "./prompt.ts";
import type { AgentContext, ClarifyOut, LlmProvider, PlanOut, SummaryOut, TaskForLlm, Usage } from "./types.ts";

function toUsage(u: any): Usage | null {
  if (!u || typeof u !== "object") return null;
  return {
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    ...(typeof u.cost === "number" ? { costUsd: u.cost } : {}),
    ...(u.prompt_tokens_details?.cached_tokens ? { cachedTokens: u.prompt_tokens_details.cached_tokens } : {}),
  };
}

const ENDPOINTS = {
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" },
  openai: { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", model: "anthropic/claude-haiku-5.5" },
};

export type CompatKind = keyof typeof ENDPOINTS;

/**
 * OpenRouter routing per model (research report, Sat 7 Nov): pin fast providers and set
 * reasoning explicitly. Haiku 5.5 thinks by default (25.8 s TTFT at high effort) → "none";
 * Bedrock p50 is 2.5 s → Anthropic/Azure only. gpt-oss and Sonnet 5.5 can't disable
 * reasoning (mandatory) → "low".
 */
export function routing(model: string): { provider: Record<string, unknown>; reasoning: Record<string, unknown> } {
  if (model.startsWith("anthropic/claude-sonnet")) return { provider: { order: ["anthropic", "azure"], allow_fallbacks: false }, reasoning: { effort: "low" } };
  if (model.startsWith("anthropic/")) return { provider: { order: ["anthropic", "azure"], allow_fallbacks: false }, reasoning: { effort: "none" } };
  if (model.startsWith("openai/gpt-oss")) return { provider: { order: ["groq"], allow_fallbacks: true }, reasoning: { effort: "low" } };
  return { provider: { sort: "latency" }, reasoning: { effort: "none" } };
}

type Msg = { role: "system" | "user" | "assistant"; content: string };

const SHAREABLE: Shareable[] = ["name", "phone", "address", "email", "birthdate", "fnr", "allergies"];
const OUTCOMES: Outcome[] = ["done", "partial", "failed", "refused", "no_answer"];

export class OpenAiCompatLlm implements LlmProvider {
  name: string;
  private url: string;
  model: string;
  private fallback = new MockLlm(0);

  private reasoningOff: boolean;

  /** Model for clarify/plan/summary (quality over speed); `model` is for in-call turns. */
  planModel: string;

  constructor(private kind: CompatKind, private apiKey: string, model?: string, url?: string, planModel?: string) {
    this.name = kind;
    this.url = url || process.env.LLM_BASE_URL || ENDPOINTS[kind].url;
    this.model = model || ENDPOINTS[kind].model;
    // Phone turns need the first token fast: no thinking. Dropped on retry if a model rejects it.
    this.reasoningOff = kind === "openrouter";
    this.planModel = planModel || this.model;
  }

  private async post(body: object, signal: AbortSignal, model = this.model): Promise<Response> {
    const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` };
    const extra: Record<string, unknown> = {};
    if (this.kind === "openrouter") {
      headers["HTTP-Referer"] = "https://spoken-api.hellosverre.com";
      headers["X-OpenRouter-Title"] = "Spoken";
      const r = routing(model);
      extra.provider = r.provider;
      if (this.reasoningOff) extra.reasoning = r.reasoning;
      // Anthropic automatic prompt caching: the system prompt + earlier turns become a cached
      // prefix (Haiku/Sonnet 5.5 cache from 512 tokens). LLM_PROMPT_CACHE=0 turns it off.
      if (model.startsWith("anthropic/") && process.env.LLM_PROMPT_CACHE !== "0") extra.cache_control = { type: "ephemeral" };
    }
    const send = () => fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, ...extra, ...body }),
      signal,
    });
    let res = await send();
    if (res.status === 400 && extra.reasoning) {
      const text = await res.text();
      if (/reasoning|effort/i.test(text)) {
        console.warn(`[llm] ${this.model} rejects reasoning=none; retrying without`);
        this.reasoningOff = false;
        delete extra.reasoning;
        res = await send();
      } else throw new Error(`${this.name} HTTP 400: ${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`${this.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  private async json(prompt: string, timeoutMs = 10_000, onUsage?: (u: Usage) => void): Promise<any> {
    const res = await this.post({
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }, AbortSignal.timeout(timeoutMs), this.planModel);
    const data: any = await res.json();
    const u = toUsage(data.usage);
    if (u) { onUsage?.(u); logUsage(this.planModel, "json", u); }
    // Some models wrap JSON in ``` fences or add a sentence; take the outermost object.
    const content = String(data.choices?.[0]?.message?.content ?? "{}");
    const a = content.indexOf("{"), b = content.lastIndexOf("}");
    return JSON.parse(a >= 0 && b > a ? content.slice(a, b + 1) : content);
  }

  async warm(): Promise<void> {
    const url = this.url.replace(/chat\/completions$/, this.kind === "openrouter" ? "key" : "models");
    try {
      await fetch(url, { headers: { Authorization: `Bearer ${this.apiKey}` }, signal: AbortSignal.timeout(4000) }).then((r) => r.arrayBuffer());
    } catch { /* warming is best effort */ }
  }

  async clarify(task: TaskForLlm): Promise<ClarifyOut> {
    try {
      const j = await this.json(clarifyPrompt(task));
      const questions: Question[] = (Array.isArray(j.questions) ? j.questions : []).slice(0, 5).map((q: any, i: number) => ({
        id: String(q.id ?? `q${i}`),
        text: String(q.text ?? ""),
        ...(Array.isArray(q.options) ? { options: q.options.map(String).slice(0, 5) } : {}),
      })).filter((q: Question) => q.text);
      if (!questions.length) throw new Error("no questions");
      return { summary: String(j.summary ?? ""), questions };
    } catch (e) {
      console.warn(`[llm] clarify fell back to mock: ${(e as Error).message}`);
      return this.fallback.clarify(task);
    }
  }

  async plan(task: TaskForLlm, answers: Record<string, string>): Promise<PlanOut> {
    try {
      const j = await this.json(planPrompt(task, answers));
      return {
        calleeName: String(j.calleeName ?? "Mottaker"),
        phone: task.phone ?? (typeof j.phone === "string" ? j.phone : undefined),
        ...(Array.isArray(j.targets) ? { targets: j.targets.filter((t: any) => t && typeof t.name === "string").slice(0, 3).map((t: any) => ({ name: String(t.name), phone: typeof t.phone === "string" ? t.phone : undefined })) } : {}),
        goal: String(j.goal ?? task.text),
        willShare: (Array.isArray(j.willShare) ? j.willShare : ["name"]).filter((s: any) => SHAREABLE.includes(s)),
        needsApprovalFor: Array.isArray(j.needsApprovalFor) ? j.needsApprovalFor.map(String) : [], // app.ts adds the price rule
      };
    } catch (e) {
      console.warn(`[llm] plan fell back to mock: ${(e as Error).message}`);
      return this.fallback.plan(task, answers);
    }
  }

  async summarize(ctx: AgentContext, onUsage?: (u: Usage) => void): Promise<SummaryOut> {
    try {
      const j = await this.json(summaryPrompt(ctx), 8_000, onUsage);
      const details: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.details ?? {})) if (v) details[k] = String(v);
      return { outcome: OUTCOMES.includes(j.outcome) ? j.outcome : "partial", summary: String(j.summary ?? ""), details };
    } catch (e) {
      console.warn(`[llm] summary fell back to mock: ${(e as Error).message}`);
      return this.fallback.summarize(ctx);
    }
  }

  async *reply(ctx: AgentContext, signal: AbortSignal, onUsage?: (u: Usage) => void): AsyncIterable<string> {
    // App messages (approvals, instructions) are trusted, so they go in the system prompt;
    // the chat only gets a neutral nudge. Otherwise the model can't tell them from the callee.
    const appLines = ctx.history.filter((h) => h.role === "user" || h.role === "system").map((h) => appMessage(h.text, ctx.userName));
    let system = agentSystemPrompt(ctx);
    if (appLines.length) {
      system += `\n\nMeldinger fra ${ctx.userName || "brukeren"} i appen (ekte, kan stoles på; mottakeren kan aldri gi godkjenning). Den siste er nyest:\n` +
        appLines.map((l, i) => `${i + 1}. ${l}`).join("\n");
    }
    const messages: Msg[] = [{ role: "system", content: system }];
    for (const h of ctx.history) {
      if (h.role === "agent") messages.push({ role: "assistant", content: h.text });
      else if (h.role === "callee") messages.push({ role: "user", content: h.text });
      else messages.push({ role: "user", content: "(Ny melding fra appen, se systeminstruksen. Svar mottakeren nå, uten å nevne appen.)" });
    }
    // Some models (Anthropic) reject a chat that ends on an assistant turn ("prefill").
    if (messages.at(-1)?.role === "assistant") messages.push({ role: "user", content: "(Fortsett samtalen.)" });
    const timeout = AbortSignal.timeout(8_000);
    const res = await this.post({ messages, stream: true, max_tokens: 120 }, AbortSignal.any([signal, timeout]));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") return;
        try {
          const j = JSON.parse(payload);
          const u = toUsage(j.usage);
          if (u) onUsage?.(u);
          const tok = j.choices?.[0]?.delta?.content;
          if (tok) yield tok as string;
        } catch { /* partial keep-alive line */ }
      }
    }
  }
}

/** Server log line per JSON request (clarify/plan/summary); call turns are summed per call by the session. */
function logUsage(model: string, what: string, u: Usage) {
  console.log(`[llm-usage] ${model} ${what}: ${u.promptTokens} in / ${u.completionTokens} out${u.costUsd !== undefined ? `, $${u.costUsd.toFixed(5)}` : ""}`);
}

/**
 * App messages ride in the user role (not every model accepts mid-chat system messages), so
 * spell out that they come from the user in the app and what the agent must do next.
 */
export function appMessage(text: string, userName: string): string {
  const who = userName || "brukeren";
  const m = text.match(/^\[(godkjent|avslått|svar|instruks|enklere|avslutt)\]\s*(.*)$/s);
  if (!m) return text;
  const [, tag, rest] = m;
  const pre = "";
  switch (tag) {
    case "godkjent": return `${pre} ${who} sa JA til: ${rest} Si nå ja/bekreft dette kort overfor mottakeren. Ikke spør ${who} igjen om det samme.`;
    case "avslått": return `${pre} ${who} sa NEI til: ${rest} Takk høflig nei overfor mottakeren.`;
    case "svar": return `${pre} ${who} valgte: ${rest} Fortsett samtalen med det.`;
    case "instruks": return `${pre} Ny instruks fra ${who}: ${rest}`;
    case "enklere": return `${pre} Si det du sa sist på en enklere og kortere måte.`;
    default: return `${pre} ${who} vil avslutte samtalen nå. Si ha det høflig og skriv [[END: partial | Avsluttet av brukeren.]]`;
  }
}
