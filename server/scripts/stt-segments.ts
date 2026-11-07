// Re-run batch Scribe on a saved call (SAVE_CALL_AUDIO=1) and print realtime vs batch with
// mean word confidence, to tune when the batch reading should win.
// Usage: bas-secret run -- bun scripts/stt-segments.ts c_05079f8d4529
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transcribeSegment } from "../src/voice/scribe-batch.ts";

const id = process.argv[2];
if (!id) throw new Error("usage: bun scripts/stt-segments.ts <callId>");
const dir = join(import.meta.dir, "../.cache/calls");
const raw = readFileSync(join(dir, `${id}.pcm`));
const pcm = new Int16Array(raw.buffer, raw.byteOffset, raw.byteLength >> 1);
const segs = readFileSync(join(dir, `${id}.segments.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const mean = (ws: { confidence: number }[]) => ws.length ? ws.reduce((a, w) => a + w.confidence, 0) / ws.length : 0;

for (const s of segs) {
  const slice = pcm.subarray(Math.max(0, s.startMs * 8), s.endMs * 8);
  const r = await transcribeSegment(slice, []);
  console.log(`${s.id}\trt: ${s.realtime}\n\tbatch (${mean(r.words).toFixed(2)}): ${r.text}`);
}
