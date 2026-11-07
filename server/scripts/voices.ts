// Offline voice A/B for the phone line: same Norwegian line per voice at 8 kHz µ-law.
// Reports median pitch (lower = deeper), pace, and how well Scribe understands it.
// Writes .cache/voices/<name>.wav to listen to. ~90 TTS chars per voice.
import { mkdirSync } from "node:fs";
import { ScribeStream } from "../src/voice/scribe.ts";
import { concat, tts } from "../src/voice/tts.ts";
import { ulawToLinear } from "../src/voice/ulaw.ts";

const LINE = "Hei, jeg er en KI-assistent som ringer på vegne av Sverre. Du kan gjerne si nei til å snakke med meg.";
const VOICES: Record<string, string> = Object.fromEntries((process.env.VOICES ??
  "Brian:nPczCjzI2devNBz1zQrb,George:JBFqnCBsd6RMkjVDRZzb,Bill:pqHfZKP75CvOlQylNhV4").split(",").map((v) => v.split(":")));
mkdirSync(".cache/voices", { recursive: true });

function medianF0(pcm: Float32Array): number {
  const f0s: number[] = [];
  for (let o = 0; o + 400 < pcm.length; o += 160) {
    const w = pcm.subarray(o, o + 400);
    let e = 0; for (const x of w) e += x * x;
    if (e / 400 < 2e5) continue; // skip silence
    let best = 0, bestLag = 0;
    for (let lag = 32; lag <= 100; lag++) { // 80–250 Hz
      let c = 0; for (let i = 0; i + lag < 400; i++) c += w[i]! * w[i + lag]!;
      if (c > best) { best = c; bestLag = lag; }
    }
    if (bestLag && best / e > 0.4) f0s.push(8000 / bestLag);
  }
  f0s.sort((a, b) => a - b);
  return f0s.length ? Math.round(f0s[f0s.length >> 1]!) : 0;
}

function wav(ulaw: Uint8Array): Uint8Array {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + ulaw.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(7, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(8000, 28); h.writeUInt16LE(1, 32); h.writeUInt16LE(8, 34); h.write("data", 36); h.writeUInt32LE(ulaw.length, 40);
  return concat([h, ulaw]);
}

async function stt(audio: Uint8Array): Promise<string> {
  const out: string[] = [];
  const s = new ScribeStream({ partial() {}, committed: (t) => out.push(t), words() {}, error: (m) => out.push(`[err ${m}]`) }, ["KI-assistent", "KI"]);
  s.connect();
  const all = concat([audio, new Uint8Array(16000).fill(0xff)]);
  for (let o = 0; o < all.length; o += 640) { s.send(all.subarray(o, o + 640)); await Bun.sleep(40); }
  await Bun.sleep(1500);
  s.close();
  return out.join(" ");
}

for (const [name, id] of Object.entries(VOICES)) {
  const parts: Uint8Array[] = [];
  for await (const c of tts(LINE, { voiceId: id, cache: true })) parts.push(c);
  const audio = concat(parts);
  await Bun.write(`.cache/voices/${name}.wav`, wav(audio));
  const pcm = Float32Array.from(audio, (u) => ulawToLinear(u));
  const sec = audio.length / 8000;
  console.log(`${name.padEnd(7)} F0 ${medianF0(pcm)} Hz, ${sec.toFixed(1)} s (${(LINE.length / sec).toFixed(1)} chars/s)\n        STT: ${await stt(audio)}`);
}
process.exit(0);
