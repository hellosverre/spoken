import { expect, test } from "bun:test";
import { config } from "../src/config.ts";
import { tts } from "../src/voice/tts.ts";
import { resetElKeyForTests } from "../src/voice/el-key.ts";

test("TTS falls back to the second ElevenLabs key when the first is rejected", async () => {
  const saved = { a: config.elevenlabs.apiKey, b: config.elevenlabs.fallbackKey, f: globalThis.fetch };
  config.elevenlabs.apiKey = "primary-test";
  config.elevenlabs.fallbackKey = "fallback-test";
  resetElKeyForTests();
  const used: string[] = [];
  globalThis.fetch = (async (_url: any, init: any) => {
    used.push(init.headers["xi-api-key"]);
    return used.length === 1
      ? new Response(JSON.stringify({ detail: { status: "quota_exceeded" } }), { status: 401 })
      : new Response(new Uint8Array([1, 2, 3]));
  }) as any;
  try {
    const chunks: Uint8Array[] = [];
    for await (const c of tts(`fallback test ${Math.random()}`)) chunks.push(c);
    expect(used).toEqual(["primary-test", "fallback-test"]);
    expect(chunks.length).toBe(1);
  } finally {
    config.elevenlabs.apiKey = saved.a; config.elevenlabs.fallbackKey = saved.b; globalThis.fetch = saved.f;
  }
});
