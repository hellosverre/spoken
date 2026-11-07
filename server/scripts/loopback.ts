// Offline pipeline check, no phone call: TTS a Norwegian line (µ-law 8 kHz), stream it
// into Scribe in real time, and print transcripts + latency. Uses ~200 TTS characters
// the first time; later runs hit the disk cache.
import { ScribeStream } from "../src/voice/scribe.ts";
import { concat, tts } from "../src/voice/tts.ts";
import { ensureDisclosure } from "../src/safety.ts";

const text = process.argv[2] ?? ensureDisclosure("", "Sverre") + " Jeg vil gjerne bestille en stor pepperoni til klokka 18:00.";
const models = (process.env.MODELS ?? "eleven_flash_v2_5,eleven_v4").split(",");

for (const model of models) {
  const t0 = Date.now();
  let ttfb = 0;
  const parts: Uint8Array[] = [];
  try {
    for await (const c of tts(text, { model, cache: true })) { if (!ttfb) ttfb = Date.now() - t0; parts.push(c); }
  } catch (e) { console.log(`${model}: TTS failed: ${(e as Error).message}`); continue; }
  const audio = concat(parts);
  console.log(`${model}: first byte ${ttfb} ms, total ${Date.now() - t0} ms, ${(audio.length / 8000).toFixed(1)} s audio`);
  await Bun.write(`.cache/loopback-${model}.ulaw`, audio);

  let endAt = 0;
  const done = Promise.withResolvers<void>();
  let commits = 0;
  const s = new ScribeStream({
    partial: (t) => process.stdout.write(`  partial: ${t}\r`),
    committed: (t) => { commits++; console.log(`\n  committed (+${Date.now() - endAt} ms after audio end): ${t}`); },
    words: (_t, w) => { console.log(`  low-confidence words: ${w.filter((x) => x.confidence < 0.6).map((x) => `${x.text}(${x.confidence.toFixed(2)})`).join(" ") || "none"}`); done.resolve(); },
    error: (m) => { console.log(`  scribe error: ${m}`); done.resolve(); },
  }, ["Domino's", "pepperoni"]);
  s.connect();
  const silence = new Uint8Array(8000 * 2).fill(0xff);
  const all = concat([audio, silence]);
  for (let o = 0; o < all.length; o += 320) {
    s.send(all.subarray(o, o + 320));
    if (o >= audio.length && !endAt) endAt = Date.now();
    await Bun.sleep(40);
  }
  await Promise.race([done.promise, Bun.sleep(4000)]);
  if (!commits) console.log("  no commit received");
  s.close();
}
process.exit(0);
