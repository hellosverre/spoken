// ElevenLabs hardening: speakable normalisation (NO + EN), TTS request shape (Flash + v4), Scribe params,
// Scribe language detection → LangSwitcher, pronunciation dictionary creation.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { LangSwitcher, normalizeLangCode } from "../src/call/langswitch.ts";
import { config } from "../src/config.ts";
import { elOnFallback } from "../src/voice/el-key.ts";
import { _resetPronunciationForTest, DICT_NAME, ensurePronunciation, RULES } from "../src/voice/pronunciation.ts";
import { ScribeStream, secondaryLanguages } from "../src/voice/scribe.ts";
import { toSpeakable } from "../src/voice/speakable.ts";
import { buildRequest, FLASH_MODEL, tts, V4_MODEL } from "../src/voice/tts.ts";

describe("speakable (no)", () => {
  test("phone numbers in pairs", () => {
    expect(toSpeakable("22 22 55 55")).toBe("tjueto, tjueto, femtifem, femtifem");
    expect(toSpeakable("Ring 91 23 45 67")).toBe("Ring nittien, tjuetre, førtifem, sekstisju");
    expect(toSpeakable("+47 22 22 55 55")).toBe("pluss førtisju, tjueto, tjueto, femtifem, femtifem");
    expect(toSpeakable("22 05 00 01")).toBe("tjueto, null fem, null null, null en");
  });
  test("times: natural spoken form", () => {
    expect(toSpeakable("18:30")).toBe("halv sju");
    expect(toSpeakable("kl. 12:30")).toBe("klokka halv ett");
    expect(toSpeakable("17:15")).toBe("kvart over fem");
    expect(toSpeakable("17:45")).toBe("kvart på seks");
    expect(toSpeakable("18:00")).toBe("atten");
    expect(toSpeakable("18:20")).toBe("atten tjue");
    expect(toSpeakable("9.05")).toBe("ni null fem");
  });
  test("prices", () => {
    expect(toSpeakable("249 kr")).toBe("to hundre og førtini kroner");
    expect(toSpeakable("1 249 kr")).toBe("tusen to hundre og førtini kroner");
    expect(toSpeakable("249,50 kr")).toBe("to hundre og førtini kroner og femti øre");
    expect(toSpeakable("189,-")).toBe("hundre og åttini kroner");
    expect(toSpeakable("1 kr")).toBe("en krone");
  });
  test("dates", () => {
    expect(toSpeakable("12.11.2026")).toBe("tolvte november to tusen og tjueseks");
    expect(toSpeakable("fredag 6. november")).toBe("fredag sjette november");
  });
  test("KI is still spelled", () => {
    expect(toSpeakable("bruker KI")).toBe("bruker kå-i");
  });
});

describe("speakable (en)", () => {
  test("phone numbers digit by digit in written groups", () => {
    expect(toSpeakable("+47 22 22 55 55", "en")).toBe("plus four seven, two two, two two, five five, five five");
  });
  test("times", () => {
    expect(toSpeakable("6:30 pm", "en")).toBe("six thirty p m");
    expect(toSpeakable("18:30", "en")).toBe("six thirty");
    expect(toSpeakable("6 pm", "en")).toBe("six p m");
    expect(toSpeakable("at 18:05", "en")).toBe("at six oh five");
  });
  test("prices and dates", () => {
    expect(toSpeakable("249 kr", "en")).toBe("two hundred forty nine kroner");
    expect(toSpeakable("$12.50", "en")).toBe("twelve dollars and fifty cents");
    expect(toSpeakable("12 November", "en")).toBe("twelfth November");
    expect(toSpeakable("November 3rd", "en")).toBe("November third");
    expect(toSpeakable("1,249 NOK", "en")).toBe("one thousand two hundred forty nine kroner");
  });
  test("other languages pass through", () => {
    expect(toSpeakable("Ich komme um 18:30", "de")).toBe("Ich komme um 18:30");
  });
});

describe("tts request shape", () => {
  const loc = [{ pronunciation_dictionary_id: "d1", version_id: "v1" }];
  test("Flash: speed, style 0, no boost, stitching, locators", () => {
    const r = buildRequest("Hei der.", { model: FLASH_MODEL, voiceId: "V", lang: "no", format: "ulaw_8000", previousText: "Først.", nextText: "Så.", locators: loc });
    expect(r.url).toBe("https://api.elevenlabs.io/v1/text-to-speech/V/stream?output_format=ulaw_8000");
    const b = r.body as any;
    expect(b.voice_settings.speed).toBe(0.88);
    expect(b.voice_settings.style).toBe(0);
    expect(b.voice_settings.use_speaker_boost).toBe(false);
    expect(b.previous_text).toBe("Først.");
    expect(b.next_text).toBe("Så.");
    expect(b.pronunciation_dictionary_locators).toEqual(loc);
  });
  test("v4: dialogue endpoint, [calm] tag, no voice_settings", () => {
    const r = buildRequest("Hei der.", { model: V4_MODEL, voiceId: "V", lang: "no", format: "ulaw_8000", previousText: "x", locators: loc });
    expect(r.url).toBe("https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=ulaw_8000");
    expect(r.body).toEqual({
      inputs: [{ text: "[calm] Hei der.", voice_id: "V" }],
      model_id: V4_MODEL, language_code: "no", pronunciation_dictionary_locators: loc,
    });
  });

  describe("over the wire", () => {
    const saved = { f: globalThis.fetch, k: config.elevenlabs.apiKey, m: process.env.TTS_MODEL };
    let calls: { url: string; body: any }[] = [];
    beforeEach(() => { config.elevenlabs.apiKey = "test-key"; calls = []; });
    afterEach(() => { globalThis.fetch = saved.f; config.elevenlabs.apiKey = saved.k; if (saved.m === undefined) delete process.env.TTS_MODEL; else process.env.TTS_MODEL = saved.m; });
    const drain = async (g: AsyncGenerator<Uint8Array>) => { const o: Uint8Array[] = []; for await (const c of g) o.push(c); return o; };

    test("sentences of one turn are stitched; Flash selectable by env", async () => {
      process.env.TTS_MODEL = FLASH_MODEL;
      globalThis.fetch = (async (url: any, init: any) => { calls.push({ url, body: JSON.parse(init.body) }); return new Response(new Uint8Array([1])); }) as any;
      const turn = `t${Math.random().toString(36).slice(2)}`;
      await drain(tts(`Første setning ${turn}.`, { turn }));
      await drain(tts(`Andre setning ${turn}.`, { turn, nextText: "Tredje." }));
      expect(calls[0]!.body.previous_text).toBeUndefined();
      expect(calls[1]!.body.previous_text).toBe(`Første setning ${turn}.`);
      expect(calls[1]!.body.next_text).toBe("Tredje.");
    });

    test("default is v4; a failing v4 request falls back to Flash", async () => {
      delete process.env.TTS_MODEL;
      globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url, body: JSON.parse(init.body) });
        return String(url).includes("text-to-dialogue") ? new Response("boom", { status: 500 }) : new Response(new Uint8Array([7]));
      }) as any;
      const out = await drain(tts(`Hei ${Math.random()}`));
      expect(out.length).toBe(1);
      // Once another test has pushed the process onto the fallback key, v4 is skipped up front.
      expect(calls.map((c) => c.body.model_id)).toEqual(elOnFallback() ? [FLASH_MODEL] : [V4_MODEL, FLASH_MODEL]);
      expect(calls[calls.length - 1]!.url).toContain("text-to-speech");
    });

    test("barge-in abort does not trigger the Flash fallback", async () => {
      delete process.env.TTS_MODEL;
      const ac = new AbortController();
      globalThis.fetch = (async (url: any, init: any) => { calls.push({ url, body: {} }); ac.abort(); throw new DOMException("aborted", "AbortError"); }) as any;
      await expect(drain(tts(`Hei ${Math.random()}`, { signal: ac.signal }))).rejects.toThrow();
      expect(calls.length).toBe(1);
    });
  });
});

describe("scribe", () => {
  test("secondary languages: en + no minus the call language", () => {
    expect(secondaryLanguages("no")).toEqual(["en"]);
    expect(secondaryLanguages("en")).toEqual(["no"]);
    expect(secondaryLanguages("sv")).toEqual(["en", "no"]);
  });

  test("URL params: detection on, no filter (timestamps in use), no no_verbatim; detection event reaches the handler", () => {
    const urls: string[] = [];
    const saved = { ws: globalThis.WebSocket, k: config.elevenlabs.apiKey };
    config.elevenlabs.apiKey = "test-key";
    class FakeWS { onmessage?: (e: any) => void; readyState = 1; constructor(url: string) { urls.push(url); fakes.push(this); } send() {} close() {} }
    const fakes: FakeWS[] = [];
    (globalThis as any).WebSocket = FakeWS;
    try {
      const got: [string, string][] = [];
      const s = new ScribeStream({ partial() {}, committed() {}, words() {}, error() {}, language: (c, t) => got.push([c, t]) }, ["Spoken"], "", "pcm_8000", "no");
      s.connect();
      const q = new URL(urls[0]!).searchParams;
      expect(q.get("include_language_detection")).toBe("true");
      expect(q.getAll("secondary_languages")).toEqual([]); // off unless SCRIBE_SECONDARY=1
      expect(q.get("include_timestamps")).toBe("true");
      expect(q.has("filter_background_audio")).toBe(false);
      expect(q.has("no_verbatim")).toBe(false);
      expect(q.getAll("keyterms")).toEqual(["Spoken"]);
      fakes[0]!.onmessage!({ data: JSON.stringify({ message_type: "committed_transcript_with_timestamps", text: "Hello there, can I help?", language_code: "en", words: [] }) });
      expect(got).toEqual([["en", "Hello there, can I help?"]]);
      s.close();
    } finally {
      (globalThis as any).WebSocket = saved.ws;
      config.elevenlabs.apiKey = saved.k;
    }
  });

  test("entities event reaches the handler and turns on entity_detection", () => {
    const urls: string[] = [];
    const saved = { ws: globalThis.WebSocket, k: config.elevenlabs.apiKey };
    config.elevenlabs.apiKey = "test-key";
    const fakes: any[] = [];
    (globalThis as any).WebSocket = class { onmessage?: (e: any) => void; constructor(u: string) { urls.push(u); fakes.push(this); } send() {} close() {} };
    try {
      const got: any[] = [];
      const s = new ScribeStream({ partial() {}, committed() {}, words() {}, error() {}, entities: (t, e) => got.push([t, e]) });
      s.connect();
      expect(new URL(urls[0]!).searchParams.get("entity_detection")).toBe("all");
      fakes[0].onmessage({ data: JSON.stringify({ message_type: "committed_transcript_entities", text: "Alice", entities: [{ text: "Alice", entity_type: "name_given", start_char: 0, end_char: 5 }] }) });
      expect(got[0][1][0].entity_type).toBe("name_given");
      s.close();
    } finally {
      (globalThis as any).WebSocket = saved.ws;
      config.elevenlabs.apiKey = saved.k;
    }
  });
});

describe("language detection → LangSwitcher", () => {
  test("codes normalise", () => {
    expect(normalizeLangCode("nob")).toBe("no");
    expect(normalizeLangCode("en-US")).toBe("en");
    expect(normalizeLangCode("SWE")).toBe("sv");
  });
  test("detection decides when the text heuristic is unsure; one long segment switches", () => {
    const log: string[] = [];
    const sw = new LangSwitcher("no", (to) => log.push(to));
    const text = "Domino's Pizza Storo, one moment"; // heuristic: too few stopwords
    expect(sw.feed(text)).toBeUndefined();
    expect(sw.feedDetected("en", text)).toBeUndefined(); // 5 words < 6: needs a second segment
    expect(sw.feed("Okay great")).toBeUndefined();
    expect(sw.feedDetected("eng", "Okay that is great for me")).toBe("en");
    expect(log).toEqual(["en"]);
  });
  test("a confident text vote is not double counted by the detection event", () => {
    const log: string[] = [];
    const sw = new LangSwitcher("no", (to) => log.push(to));
    const t = "Yes please, can you hold on a moment";
    expect(sw.feed(t)).toBe("en"); // 8 words: switches on text alone
    expect(sw.feedDetected("en", t)).toBeUndefined();
    expect(log).toEqual(["en"]);
  });
  test("detection first, then text: counted once", () => {
    const log: string[] = [];
    const sw = new LangSwitcher("no", (to) => log.push(to));
    expect(sw.feedDetected("de", "Guten Tag wie geht")).toBeUndefined();
    expect(sw.feed("Guten Tag wie geht")).toBeUndefined();
    expect(log).toEqual([]);
  });
  test("detection in the current language resets a pending switch; one-word segments are ignored", () => {
    const sw = new LangSwitcher("no", () => {});
    expect(sw.feedDetected("en", "Okay great")).toBeUndefined();
    expect(sw.feedDetected("no", "Ja takk")).toBeUndefined();
    expect(sw.feedDetected("en", "Okay")).toBeUndefined();
    expect(sw.lang).toBe("no");
  });
});

describe("pronunciation dictionary", () => {
  beforeEach(() => _resetPronunciationForTest());
  test("created via the API when missing, then reused", async () => {
    const saved = config.elevenlabs.apiKey;
    config.elevenlabs.apiKey = "test-key";
    const calls: { url: string; method: string; body?: any }[] = [];
    const fake = (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : undefined });
      if (!init.method) return Response.json({ pronunciation_dictionaries: [{ id: "other", name: "x", latest_version_id: "o" }] });
      return Response.json({ id: "dict1", version_id: "ver1", name: DICT_NAME });
    }) as any;
    try {
      const l = await ensurePronunciation(fake, false);
      expect(l).toEqual({ pronunciation_dictionary_id: "dict1", version_id: "ver1" });
      const post = calls.find((c) => c.method === "POST")!;
      expect(post.url).toContain("/pronunciation-dictionaries/add-from-rules");
      expect(post.body.name).toBe(DICT_NAME);
      expect(post.body.rules).toEqual(RULES);
      expect(post.body.rules.every((r: any) => r.type === "alias")).toBe(true);
      const n = calls.length;
      await ensurePronunciation(fake, false);
      expect(calls.length).toBe(n); // cached
    } finally { config.elevenlabs.apiKey = saved; }
  });
  test("an existing dictionary is found by name; failures never throw", async () => {
    const saved = config.elevenlabs.apiKey;
    config.elevenlabs.apiKey = "test-key";
    try {
      const found = (async () => Response.json({ pronunciation_dictionaries: [{ id: "have", name: DICT_NAME, latest_version_id: "hv" }] })) as any;
      expect(await ensurePronunciation(found, false)).toEqual({ pronunciation_dictionary_id: "have", version_id: "hv" });
      _resetPronunciationForTest();
      const dead = (async () => { throw new Error("offline"); }) as any;
      expect(await ensurePronunciation(dead, false)).toBeUndefined();
    } finally { config.elevenlabs.apiKey = saved; }
  });
});
