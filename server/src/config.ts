// Runtime config from env. Secrets are read here and nowhere else; never log them.

export type CallProvider = "mock" | "telnyx" | "46elks" | "vonage";
export type LlmProviderName = "mock" | "mistral" | "openai" | "openrouter";

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
  /** Call language when neither a cue («in English», «på norsk») nor the task's own language decides it. */
  callLang: (env("CALL_LANG", "en") === "no" ? "no" : "en") as "no" | "en",
  llmProvider: (env("LLM_PROVIDER", "mock") as LlmProviderName),
  llmApiKey: env("LLM_API_KEY", env("OPENROUTER_API_KEY")),
  llmModel: env("LLM_MODEL"),
  // Planning (clarify/plan/summary) may use a stronger, slower model than in-call turns.
  llmPlanModel: env("LLM_PLAN_MODEL"),
  telnyx: {
    apiKey: env("TELNYX_API_KEY"),
    connectionId: env("TELNYX_CONNECTION_ID"),
    fromNumber: env("TELNYX_FROM_NUMBER"),
  },
  elks: {
    apiUser: env("ELKS_API_USER"),
    apiPassword: env("ELKS_API_PASSWORD"),
    /** Our voice-enabled 46elks number: caller id of the outbound call. */
    number: env("ELKS_NUMBER"),
    /** The 46elks WebSocket number whose websocket_url points at /elks/media. */
    wsNumber: env("ELKS_WS_NUMBER"),
    /** Shared secret in that websocket_url (?t=…): 46elks can't carry a per-call token. */
    wsSecret: env("ELKS_WS_SECRET"),
  },
  vonage: {
    applicationId: env("VONAGE_APPLICATION_ID"),
    /** PEM private key of the Vonage application (literal «\n» sequences are accepted). */
    privateKey: env("VONAGE_PRIVATE_KEY"),
    number: env("VONAGE_NUMBER"),
  },
  elevenlabs: {
    apiKey: env("ELEVENLABS_API_KEY"),
    fallbackKey: env("ELEVENLABS_API_KEY_FALLBACK"),
    ttsModel: env("TTS_MODEL", "eleven_flash_v2_5"),
    defaultVoice: env("DEFAULT_VOICE_ID", "nPczCjzI2devNBz1zQrb"),
  },
  // Real calls only go to numbers listed here (comma-separated E.164). Empty = no real calls.
  callAllowlist: env("CALL_ALLOWLIST").split(",").map((s) => s.trim()).filter(Boolean),
  maxCallSec: num("MAX_CALL_SEC", 600),
  // Telnyx prepaid balance: real calls are refused below this (Sat 7 Nov: top-up failed, ~$2.31 left).
  minBalanceUsd: num("MIN_BALANCE_USD", 0.3),
  // Cached «Ja.»/«Okei.» when a reply is slow. Off since call #9 («fillers everywhere»); 1200 = on.
  backchannelMs: num("BACKCHANNEL_MS", 0),
  // Real calls need this code in the X-Spoken-Passcode header; without it the call runs in
  // mock mode (jurors opening the link see the demo, the Telnyx reserve stays untouched).
  demoPasscode: env("DEMO_PASSCODE"),
  maxCallsPerDay: num("MAX_CALLS_PER_DAY", 20),
  // Mock pacing: 1 = real-time-ish demo, 0.02 = fast tests.
  mockSpeed: num("MOCK_SPEED", 1),
  // Approval card unanswered: ask the callee to hold after holdAskSec, remind every
  // holdRemindSec, give up (offer callback) holdMaxSec after the card went out.
  holdAskSec: num("HOLD_ASK_SEC", 30),
  holdRemindSec: num("HOLD_REMIND_SEC", 20),
  holdMaxSec: num("HOLD_MAX_SEC", 120),
  // No progress (approval asked/answered, user instruction) for this long → wrap up politely.
  unproductiveSec: num("UNPRODUCTIVE_SEC", 120),
};

export type Config = typeof config;
