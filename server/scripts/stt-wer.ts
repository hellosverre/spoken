// Norwegian STT word error rate over a simulated phone path, per input variant.
// Sentences are TTS'd once at 16 kHz (cached), band-limited to 8 kHz and A-law encoded the
// way Telnyx delivers Norwegian calls, then sent through each STT variant.
// Real-voice audio: pass a directory of saved call segments with SEGMENTS=<dir> (see README).
// Usage: bun scripts/stt-wer.ts   (ELEVENLABS key via bas-secret; ~3 min of Scribe audio)
import { ScribeStream, type ScribeFormat } from "../src/voice/scribe.ts";
import { concat, tts } from "../src/voice/tts.ts";
import { toSpeakable } from "../src/voice/speakable.ts";
import { alawToUlaw, g711ToPcm16, linearToAlaw } from "../src/voice/ulaw.ts";
import { config } from "../src/config.ts";

const SENTENCES = [
  "Jeg må snakke med sjefen min først.",
  "Det blir hundre og åttini kroner, skal jeg legge den inn?",
  "Den er klar til henting klokka seks.",
  "Hvilket navn skal bestillingen stå på?",
  "Vi har dessverre ikke pepperoni i dag, går det bra med skinke?",
  "Skal den leveres, eller henter du selv?",
  "Ett øyeblikk, jeg setter deg på vent.",
  "Det tar omtrent tjue minutter.",
  "Vil du ha ekstra ost på den?",
  "Vi stenger klokka ti i kveld.",
];
const VOICE = process.env.WER_VOICE ?? "JBFqnCBsd6RMkjVDRZzb"; // George: a different voice than the agent

const BASE_TERMS = ["KI-assistent", "KI", "Domino's", "pepperoni"]; // what call #3 had
const LEXICON = [
  ...BASE_TERMS, "Sverre", "sjef", "sjefen", "sjefen min", "bestille", "bestilling", "bestillingen", "henting", "hente",
  "levering", "levere", "pizza", "kroner", "klokka", "navnet", "navn", "betale", "ett øyeblikk", "på vent", "minutter",
  "skinke", "ost", "stenger",
];

// --- phone path simulation: 16 kHz PCM → crude 3.4 kHz low-pass + decimate → A-law ---
function phone(pcm16k: Int16Array): Uint8Array {
  const out = new Uint8Array(Math.floor(pcm16k.length / 2));
  for (let i = 0; i < out.length; i++) {
    const a = pcm16k[2 * i - 1] ?? 0, b = pcm16k[2 * i]!, c = pcm16k[2 * i + 1] ?? 0;
    out[i] = linearToAlaw((a + 2 * b + c) / 4);
  }
  return out;
}

function upsample16k(pcm8k: Int16Array): Int16Array {
  const out = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    out[2 * i] = pcm8k[i]!;
    out[2 * i + 1] = ((pcm8k[i]! + (pcm8k[i + 1] ?? pcm8k[i]!)) / 2) | 0;
  }
  return out;
}

// --- WER ---
function words(t: string): string[] {
  return toSpeakable(t).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
}
function wer(ref: string, hyp: string): { errors: number; n: number } {
  const r = words(ref), h = words(hyp);
  const d = Array.from({ length: r.length + 1 }, (_, i) => [i, ...Array(h.length).fill(0)]);
  for (let j = 1; j <= h.length; j++) d[0]![j] = j;
  for (let i = 1; i <= r.length; i++) for (let j = 1; j <= h.length; j++) {
    d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (r[i - 1] === h[j - 1] ? 0 : 1));
  }
  return { errors: d[r.length]![h.length]!, n: r.length };
}

// --- STT variants ---
async function realtime(alaw: Uint8Array, format: ScribeFormat, terms: string[]): Promise<{ text: string; wordsDelayMs: number }> {
  const commits: string[] = [];
  let commitAt = 0, wordsAt = 0;
  const s = new ScribeStream({
    partial() {},
    committed: (t) => { commits.push(t); commitAt = Date.now(); },
    words: () => { if (!wordsAt) wordsAt = Date.now(); },
    error: (m) => commits.push(`[err ${m}]`),
  }, terms, "", format);
  s.connect();
  const audio = concat([alaw, new Uint8Array(8000 * 1.5).fill(0xd5)]); // A-law silence
  for (let o = 0; o < audio.length; o += 320) {
    const raw = audio.subarray(o, o + 320);
    s.send(format === "ulaw_8000" ? alawToUlaw(raw) : new Uint8Array(g711ToPcm16(raw, true).buffer));
    await Bun.sleep(40);
  }
  await Bun.sleep(800);
  s.close();
  return { text: commits.join(" "), wordsDelayMs: wordsAt && commitAt ? wordsAt - commitAt : NaN };
}

async function batch(alaw: Uint8Array, terms: string[]): Promise<string> {
  const pcm = upsample16k(g711ToPcm16(alaw, true));
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("language_code", "no");
  form.append("file_format", "pcm_s16le_16");
  for (const t of terms) form.append("keyterms", t);
  form.append("file", new Blob([pcm.buffer]), "seg.pcm");
  const t0 = Date.now();
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST", headers: { "xi-api-key": config.elevenlabs.apiKey }, body: form, signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return `[err ${res.status} ${(await res.text()).slice(0, 120)}]`;
  const j: any = await res.json();
  batchMs.push(Date.now() - t0);
  return j.text ?? "";
}
const batchMs: number[] = [];

// --- run ---
const clips: Uint8Array[] = [];
for (const s of SENTENCES) {
  const parts: Uint8Array[] = [];
  for await (const c of tts(s, { voiceId: VOICE, cache: true, format: "pcm_16000" })) parts.push(c);
  const bytes = concat(parts);
  clips.push(phone(new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)));
}

const VARIANTS: { name: string; run: (a: Uint8Array) => Promise<string> }[] = [
  { name: "A  before: A-law→µ-law, ulaw_8000, call #3 keyterms", run: async (a) => (await realtime(a, "ulaw_8000", BASE_TERMS)).text },
  { name: "B  A-law→PCM16, pcm_8000, call #3 keyterms", run: async (a) => (await realtime(a, "pcm_8000", BASE_TERMS)).text },
  { name: "C  B + lexicon keyterms", run: async (a) => { const r = await realtime(a, "pcm_8000", LEXICON); wordsDelay.push(r.wordsDelayMs); return r.text; } },
  { name: "D  Scribe v2 batch on the segment + lexicon", run: (a) => batch(a, LEXICON) },
];
const wordsDelay: number[] = [];

const rows: string[] = [];
for (const v of VARIANTS) {
  let e = 0, n = 0;
  const misses: string[] = [];
  // Sequential: the free tier allows 6 concurrent Scribe requests.
  const outs: string[] = [];
  for (const c of clips) outs.push(await v.run(c));
  outs.forEach((hyp, i) => {
    const w = wer(SENTENCES[i]!, hyp);
    e += w.errors; n += w.n;
    if (w.errors) misses.push(`      «${SENTENCES[i]}» → «${hyp.trim()}»`);
  });
  rows.push(`${v.name.padEnd(56)} WER ${((100 * e) / n).toFixed(1).padStart(5)} %  (${e}/${n} words)`);
  console.log(rows.at(-1));
  if (misses.length) console.log(misses.join("\n"));
}
const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
console.log(`\nword confidences arrive ${med(wordsDelay)} ms after the commit (median); batch round-trip ${med(batchMs)} ms`);
console.log("\nSUMMARY\n" + rows.join("\n"));
process.exit(0);
