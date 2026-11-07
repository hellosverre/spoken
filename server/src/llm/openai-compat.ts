// Mistral and OpenAI both speak the chat-completions wire format (JSON mode + SSE
// streaming), so one small client covers both. Any failure falls back to the mock.

import type { Outcome, Question, Shareable } from "../../../shared/contract.ts";
import { MockLlm } from "./mock.ts";
import { agentSystemPrompt, clarifyPrompt, planPrompt, summaryPrompt } from "./prompt.ts";
import type { AgentContext, ClarifyOut, LlmProvider, PlanOut, SummaryOut, TaskForLlm } from "./types.ts";

const ENDPOINTS = {
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" },
  openai: { url: "https://api.openai.com/v1/chat/completions", model: "gpt-4.1-mini" },
};

type Msg = { role: "system" | "user" | "assistant"; content: string };

const SHAREABLE: Shareable[] = ["name", "phone", "address", "email", "birthdate", "fnr", "allergies"];
const OUTCOMES: Outcome[] = ["done", "partial", "failed", "refused", "no_answer"];

export class OpenAiCompatLlm implements LlmProvider {
  name: string;
  private url: string;
  private model: string;
  private fallback = new MockLlm(0);

  constructor(kind: keyof typeof ENDPOINTS, private apiKey: string, model?: string) {
    this.name = kind;
    this.url = ENDPOINTS[kind].url;
    this.model = model || ENDPOINTS[kind].model;
  }

  private async post(body: object, signal: AbortSignal): Promise<Response> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, ...body }),
      signal,
    });
    if (!res.ok) throw new Error(`${this.name} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res;
  }

  private async json(prompt: string, timeoutMs = 10_000): Promise<any> {
    const res = await this.post({
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }, AbortSignal.timeout(timeoutMs));
    const data: any = await res.json();
    return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
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
        goal: String(j.goal ?? task.text),
        willShare: (Array.isArray(j.willShare) ? j.willShare : ["name"]).filter((s: any) => SHAREABLE.includes(s)),
        needsApprovalFor: (Array.isArray(j.needsApprovalFor) ? j.needsApprovalFor.map(String) : []).concat("pris over 0 kr"),
      };
    } catch (e) {
      console.warn(`[llm] plan fell back to mock: ${(e as Error).message}`);
      return this.fallback.plan(task, answers);
    }
  }

  async summarize(ctx: AgentContext): Promise<SummaryOut> {
    try {
      const j = await this.json(summaryPrompt(ctx), 8_000);
      const details: Record<string, string> = {};
      for (const [k, v] of Object.entries(j.details ?? {})) if (v) details[k] = String(v);
      return { outcome: OUTCOMES.includes(j.outcome) ? j.outcome : "partial", summary: String(j.summary ?? ""), details };
    } catch (e) {
      console.warn(`[llm] summary fell back to mock: ${(e as Error).message}`);
      return this.fallback.summarize(ctx);
    }
  }

  async *reply(ctx: AgentContext, signal: AbortSignal): AsyncIterable<string> {
    const messages: Msg[] = [{ role: "system", content: agentSystemPrompt(ctx) }];
    for (const h of ctx.history) {
      if (h.role === "agent") messages.push({ role: "assistant", content: h.text });
      else if (h.role === "callee") messages.push({ role: "user", content: h.text });
      else messages.push({ role: "user", content: h.text }); // [godkjent]/[instruks]… markers
    }
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
          const tok = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (tok) yield tok as string;
        } catch { /* partial keep-alive line */ }
      }
    }
  }
}
