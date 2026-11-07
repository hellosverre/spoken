// Scribe v2 batch on one finished callee segment: slower (~0.7 s) but more accurate than
// realtime. Used as a second opinion that corrects the live transcript.
import type { Word } from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { logprobToConfidence } from "./scribe.ts";

function upsample16k(pcm8k: Int16Array): Int16Array {
  const out = new Int16Array(pcm8k.length * 2);
  for (let i = 0; i < pcm8k.length; i++) {
    out[2 * i] = pcm8k[i]!;
    out[2 * i + 1] = ((pcm8k[i]! + (pcm8k[i + 1] ?? pcm8k[i]!)) / 2) | 0;
  }
  return out;
}

export async function transcribeSegment(pcm8k: Int16Array, keyterms: string[], timeoutMs = 4000): Promise<{ text: string; words: Word[] }> {
  if (!config.elevenlabs.apiKey) throw new Error("ELEVENLABS_API_KEY missing");
  const form = new FormData();
  form.append("model_id", "scribe_v2");
  form.append("language_code", "no");
  form.append("file_format", "pcm_s16le_16");
  for (const t of keyterms.slice(0, 50)) form.append("keyterms", t);
  form.append("file", new Blob([upsample16k(pcm8k).buffer as ArrayBuffer]), "segment.pcm");
  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": config.elevenlabs.apiKey },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`Scribe batch HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const j: any = await res.json();
  const words: Word[] = (j.words ?? [])
    .filter((w: any) => w.type === "word" && w.text?.trim())
    .map((w: any) => ({ text: w.text, confidence: typeof w.logprob === "number" ? logprobToConfidence(w.logprob) : 1 }));
  return { text: String(j.text ?? "").trim(), words };
}
