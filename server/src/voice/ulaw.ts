// G.711 µ-law helpers: energy for local barge-in VAD, and synthesis of the soft
// typing sound played while the user decides on an approval.

const BIAS = 0x84;
const CLIP = 32635;

export function linearToUlaw(sample: number): number {
  let s = Math.max(-CLIP, Math.min(CLIP, Math.round(sample)));
  const sign = s < 0 ? 0x80 : 0;
  if (sign) s = -s;
  s += BIAS;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
  const mant = (s >> (exp + 3)) & 0x0f;
  return ~(sign | (exp << 4) | mant) & 0xff;
}

export function ulawToLinear(u: number): number {
  const x = ~u & 0xff;
  const sign = x & 0x80;
  const exp = (x >> 4) & 0x07;
  const mant = x & 0x0f;
  const s = (((mant << 3) + BIAS) << exp) - BIAS;
  return sign ? -s : s;
}

const DECODE = new Int16Array(256).map((_, i) => ulawToLinear(i));

/** RMS of a µ-law buffer in linear units (0..32k). Speech on a phone line is usually > 800. */
export function ulawRms(buf: Uint8Array): number {
  if (!buf.length) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) { const v = DECODE[buf[i]!]!; sum += v * v; }
  return Math.sqrt(sum / buf.length);
}

export const ULAW_SILENCE = 0xff;

/** ~4 s of quiet keyboard clicks at 8 kHz, looped while we wait. Deterministic. */
export function typingSound(seconds = 4): Uint8Array {
  const rate = 8000;
  const out = new Float32Array(rate * seconds);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let t = 0.2 * rate;
  while (t < out.length - 400) {
    const amp = 1400 + rnd() * 900; // soft: well below speech level
    const len = 160 + Math.floor(rnd() * 120); // 20–35 ms click
    for (let i = 0; i < len && t + i < out.length; i++) {
      const env = Math.exp(-i / 28);
      out[t + i] = (rnd() * 2 - 1) * amp * env;
    }
    // bursts of keystrokes, then a short pause
    t += Math.floor((rnd() < 0.15 ? 0.5 : 0.09 + rnd() * 0.12) * rate);
  }
  const u = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) u[i] = linearToUlaw(out[i]!);
  return u;
}

// Norwegian calls arrive as G.711 A-law (PCMA); Scribe and our VAD expect µ-law.
export function alawToLinear(a: number): number {
  const x = a ^ 0x55;
  const sign = x & 0x80;
  const exp = (x >> 4) & 0x07;
  const mant = x & 0x0f;
  let s = exp === 0 ? (mant << 4) + 8 : ((mant << 4) + 0x108) << (exp - 1);
  return sign ? s : -s;
}

const ALAW_TO_ULAW = new Uint8Array(256).map((_, i) => linearToUlaw(alawToLinear(i)));

export function alawToUlaw(buf: Uint8Array): Uint8Array {
  const out = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = ALAW_TO_ULAW[buf[i]!]!;
  return out;
}

const ALAW_DECODE = new Int16Array(256).map((_, i) => alawToLinear(i));

/** Telnyx G.711 payload → 16-bit linear PCM, decoded once (no lossy µ-law re-encode for STT). */
export function g711ToPcm16(raw: Uint8Array, alaw: boolean): Int16Array {
  const table = alaw ? ALAW_DECODE : DECODE;
  const out = new Int16Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = table[raw[i]!]!;
  return out;
}

export function pcmRms(pcm: Int16Array): number {
  if (!pcm.length) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / pcm.length);
}

export function linearToAlaw(sample: number): number {
  let s = Math.max(-32768, Math.min(32767, Math.round(sample)));
  const sign = s >= 0 ? 0x80 : 0;
  if (!sign) s = -s - 1;
  let exp = 7;
  for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
  const mant = exp === 0 ? (s >> 4) & 0x0f : (s >> (exp + 3)) & 0x0f;
  return ((sign | (exp << 4) | mant) ^ 0x55) & 0xff;
}

/** Loudness 0..1 for the live voice visual (speech on a phone line sits around 0.2–0.8). */
export function levelOf(rms: number): number {
  return Math.min(1, Math.sqrt(rms / 9000));
}
