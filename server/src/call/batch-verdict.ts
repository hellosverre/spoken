// Realtime and batch STT both transcribe each callee segment; this decides which one stands.
import { toSpeakable } from "../voice/speakable.ts";

// Number words after toSpeakable(): what the batch second opinion is allowed to correct.
const NUMBERISH = /^(\d+|null|en|ett|én|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|elleve|tolv|tretten|fjorten|femten|seksten|sytten|atten|nitten|tjue\p{L}*|tretti\p{L}*|førti\p{L}*|femti\p{L}*|seksti\p{L}*|sytti\p{L}*|åtti\p{L}*|nitti\p{L}*|hundre\p{L}*|tusen|halv|kvart|kroner|krone|kr)$/iu;
// Batch beats realtime on any line when it is this sure and realtime is unsure (c_05079f8d4529:
// realtime «Hold da.» 0.63 / batch «Ha det bra!»; «Jeg må bare se på andre…» 0.54 / batch
// «Domino's, har bare adressen og telefonnummeret ditt…»). Tune with scripts/stt-segments.ts.
// c_5b26344610cc: wrong batch lines scored 0.84–0.86 («To kroner hjelper, nå»), right ones ≥ 0.95.
const BATCH_SURE = Number(process.env.BATCH_SURE ?? 0.9);
const RT_UNSURE = Number(process.env.RT_UNSURE ?? 0.65);
// Batch tags a segment with no speech as «[snakking i bakgrunnen]», «(musikk)»; realtime made up
// «Jeg vet ikke hva jeg skal gjøre.» (0.42) for that one.
const NOISE_TAG = /^[\s.]*([\[(][^\])]*[\])][\s.]*)+$/;
export const meanConf = (ws: { confidence: number }[]) => ws.length ? ws.reduce((a, w) => a + w.confidence, 0) / ws.length : undefined;

// Numbers spelled out first, so «110 krona» and «hundre og åttini kroner» can be compared.
const norm = (t: string) => toSpeakable(t).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();
const count = (t: string) => norm(t).split(" ").filter(Boolean).length;
// Same stem counts («krona»/«kroner»): first 4 letters.
const stem = (w: string) => w.slice(0, 4);
const nums = (t: string) => norm(t).split(" ").filter((w) => NUMBERISH.test(w)).join(" ");

/** "noise": drop the line. "revise": use the batch text. "keep": realtime stands. */
export function batchVerdict(realtime: string, batch: string, rtConf?: number, batchConf?: number): "noise" | "revise" | "keep" {
  if (NOISE_TAG.test(batch) && (rtConf === undefined || rtConf < 0.75)) return "noise";
  // Only replace realtime when batch looks like the same utterance (guards bad windows).
  const sizeOk = count(batch) >= Math.max(1, 0.6 * count(realtime)) && count(batch) <= 1.6 * count(realtime) + 1;
  if (!batch || norm(batch) === norm(realtime) || !sizeOk) return "keep";
  // Much surer than realtime: take it, even with no shared words.
  if (batchConf !== undefined && rtConf !== undefined && batchConf >= BATCH_SURE && rtConf < RT_UNSURE) return "revise";
  // Otherwise it must share a word ("I Storo." → "Bestill levering" on call #4 was the wrong window),
  // and only numbers (prices, times) may change: elsewhere batch made lines worse on call
  // c_ba0df20d («hvor skal vi ha adressen» → «hvor så var adressen»).
  const rw = new Set(norm(realtime).split(" ").map(stem));
  const overlap = norm(batch).split(" ").some((w) => w && rw.has(stem(w)));
  // Realtime must have heard a number too: «To kroner hjelper» for «Hva kan jeg hjelpe» (c_5b26).
  const numbersDiffer = !!nums(batch) && !!nums(realtime) && nums(batch) !== nums(realtime);
  return overlap && numbersDiffer ? "revise" : "keep";
}
