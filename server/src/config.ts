// Runtime config from env. Secrets are read here and nowhere else; never log them.

export type CallProvider = "mock" | "telnyx";
export type LlmProviderName = "mock" | "mistral" | "openai";

function env(name: string, fallback = ""): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v.trim();
}

function num(name: string, fallback: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && env(name) !== "" ? n : fallback;
}

export const config = {
  port: num("PORT", 8787),
  publicUrl: env("PUBLIC_URL", "http://localhost:8787").replace(/\/$/, ""),
  callProvider: (env("CALL_PROVIDER", "mock") as CallProvider),
  llmProvider: (env("LLM_PROVIDER", "mock") as LlmProviderName),
  llmApiKey: env("LLM_API_KEY"),
  llmModel: env("LLM_MODEL"),
  telnyx: {
    apiKey: env("TELNYX_API_KEY"),
    connectionId: env("TELNYX_CONNECTION_ID"),
    fromNumber: env("TELNYX_FROM_NUMBER"),
  },
  elevenlabs: {
    apiKey: env("ELEVENLABS_API_KEY"),
    ttsModel: env("TTS_MODEL", "eleven_flash_v2_5"),
    defaultVoice: env("DEFAULT_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
  },
  // Real calls only go to numbers listed here (comma-separated E.164). Empty = no real calls.
  callAllowlist: env("CALL_ALLOWLIST").split(",").map((s) => s.trim()).filter(Boolean),
  maxCallSec: num("MAX_CALL_SEC", 600),
  maxCallsPerDay: num("MAX_CALLS_PER_DAY", 20),
  // Mock pacing: 1 = real-time-ish demo, 0.02 = fast tests.
  mockSpeed: num("MOCK_SPEED", 1),
  approvalTimeoutSec: num("APPROVAL_TIMEOUT_SEC", 120),
};

export type Config = typeof config;
