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
