import { afterAll, expect, test } from "bun:test";
import { OpenAiCompatLlm } from "../src/llm/openai-compat.ts";

// Fake OpenRouter: first request with reasoning=none is rejected, then SSE with keep-alive comments.
const seen: any[] = [];
const fake = Bun.serve({
  port: 0,
  async fetch(req) {
    const body: any = await req.json();
    seen.push({ body, title: req.headers.get("x-openrouter-title"), auth: req.headers.get("authorization") });
    if (body.reasoning) return new Response(JSON.stringify({ error: { message: "reasoning effort not supported" } }), { status: 400 });
    const chunks = [": OPENROUTER PROCESSING", ...["Jeg vil ", "gjerne ", "bestille."].map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}`), "data: [DONE]"];
    return new Response(chunks.join("\n\n") + "\n\n", { headers: { "Content-Type": "text/event-stream" } });
  },
});
afterAll(() => fake.stop(true));

test("openrouter: streams, sends title + latency routing, drops reasoning when rejected", async () => {
  const llm = new OpenAiCompatLlm("openrouter", "test-key", "test/model", `http://localhost:${fake.port}/chat`);
  const ctx = { goal: "g", calleeName: "c", userName: "Sverre", willShare: [], needsApprovalFor: [], profileFacts: {}, tone: "friendly" as const, simpler: false, history: [] };
  let text = "";
  for await (const t of llm.reply(ctx, new AbortController().signal)) text += t;
  expect(text).toBe("Jeg vil gjerne bestille.");
  expect(seen[0].body.reasoning).toEqual({ effort: "none" });
  expect(seen[1].body.reasoning).toBeUndefined();
  expect(seen[0].body.provider).toEqual({ sort: "latency" });
  expect(seen[1].body.stream).toBe(true);
  expect(seen[1].title).toBe("Spoken");
  expect(seen[1].auth).toBe("Bearer test-key");
});

test("routing: Haiku thinking off + Anthropic/Azure only; gpt-oss on Groq; Sonnet low reasoning", async () => {
  const { routing } = await import("../src/llm/openai-compat.ts");
  expect(routing("anthropic/claude-haiku-5.5")).toEqual({ provider: { order: ["anthropic", "azure"], allow_fallbacks: false }, reasoning: { effort: "none" } });
  expect(routing("openai/gpt-oss-120b").provider).toEqual({ order: ["groq"], allow_fallbacks: true });
  expect(routing("anthropic/claude-sonnet-5.5").reasoning).toEqual({ effort: "low" });
});
