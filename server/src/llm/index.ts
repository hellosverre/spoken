import { config } from "../config.ts";
import { MockLlm } from "./mock.ts";
import { OpenAiCompatLlm } from "./openai-compat.ts";
import type { LlmProvider } from "./types.ts";

export function createLlm(): LlmProvider {
  const p = config.llmProvider;
  if ((p === "mistral" || p === "openai") && config.llmApiKey) return new OpenAiCompatLlm(p, config.llmApiKey, config.llmModel);
  if (p !== "mock") console.warn(`[llm] LLM_PROVIDER=${p} without LLM_API_KEY: using mock`);
  return new MockLlm(config.mockSpeed >= 1 ? 15 : 0);
}
