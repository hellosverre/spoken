import { expect, test } from "bun:test";
import { config } from "../src/config.ts";
import { tts } from "../src/voice/tts.ts";
import { DEFAULT_VOICE, listVoices, voiceForCall } from "../src/voice/voices.ts";

test("listVoices returns the 8 library voices with lang and gender", () => {
  const vs = listVoices().filter((v) => v.preset);
  expect(vs.length).toBe(8);
  expect(vs.filter((v) => v.lang === "no").map((v) => v.name)).toEqual(["Sebastian", "Olaf", "Nadia", "Mia"]);
  expect(vs.filter((v) => v.lang === "en").map((v) => v.name)).toEqual(["Maya", "Amy", "John", "Jon"]);
  expect(vs.every((v) => v.gender === "male" || v.gender === "female")).toBe(true);
  expect(new Set(vs.map((v) => v.id)).size).toBe(8);
});

test("a call uses the profile voice only when its language matches", () => {
  const nadia = "BRY5wALXFkJsxVM6sEOH";
  expect(voiceForCall(nadia, "no")).toBe(nadia);
  expect(voiceForCall(nadia, "en")).toBe(DEFAULT_VOICE.en);
  expect(voiceForCall(undefined, "no")).toBe(DEFAULT_VOICE.no);
  expect(voiceForCall("custom-designed", "en")).toBe("custom-designed");
});

test("fallback key + voice_not_found retries once with Brian", async () => {
  const saved = { a: config.elevenlabs.apiKey, b: config.elevenlabs.fallbackKey, f: globalThis.fetch };
  config.elevenlabs.apiKey = "primary-v";
  config.elevenlabs.fallbackKey = "fallback-v";
  const voices: string[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const id = String(url).match(/text-to-speech\/([^/]+)\//)![1]!;
    voices.push(`${init.headers["xi-api-key"]}:${id}`);
    if (init.headers["xi-api-key"] === "primary-v") return new Response("{}", { status: 401 });
    if (id !== "nPczCjzI2devNBz1zQrb") return new Response('{"detail":{"status":"voice_not_found"}}', { status: 404 });
    return new Response(new Uint8Array([1, 2, 3]));
  }) as any;
  try {
    const chunks: Uint8Array[] = [];
    for await (const c of tts(`voice retry ${Math.random()}`, { voiceId: "4kCDY3HJwvO7Zp3con83" })) chunks.push(c);
    expect(chunks.length).toBe(1);
    expect(voices.at(-2)).toBe("fallback-v:4kCDY3HJwvO7Zp3con83");
    expect(voices.at(-1)).toBe("fallback-v:nPczCjzI2devNBz1zQrb");
  } finally {
    config.elevenlabs.apiKey = saved.a; config.elevenlabs.fallbackKey = saved.b; globalThis.fetch = saved.f;
  }
});
