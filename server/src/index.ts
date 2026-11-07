import { createApp } from "./app.ts";
import { initPronunciation } from "./voice/pronunciation.ts";
import { config } from "./config.ts";
import { connectDb } from "./db.ts";
import { createLlm } from "./llm/index.ts";

const app = createApp(createLlm(), await connectDb());
const server = Bun.serve({ port: config.port, fetch: app.fetch, websocket: { ...app.websocket, idleTimeout: 960 }, idleTimeout: 60 });

console.log(`[spoken] listening on :${server.port} (CALL_PROVIDER=${config.callProvider}, LLM_PROVIDER=${config.llmProvider}, public ${config.publicUrl})`);
if (config.callProvider !== "mock" && !config.callAllowlist.length) console.warn("[spoken] CALL_ALLOWLIST is empty: real calls are refused");

// The ElevenLabs pronunciation dictionary is created/loaded in the background; TTS works without it.
initPronunciation();
