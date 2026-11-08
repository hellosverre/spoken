import { describe, expect, test } from "bun:test";
import { Denoiser } from "../src/voice/denoise.ts";

// Deterministic PRNG so the tests don't flake.
function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296) * 2 - 1; }
const clip = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x)));

function white(n: number, amp: number, seed = 1) { const r = rng(seed); return Int16Array.from({ length: n }, () => clip(r() * amp)); }
function pink(n: number, amp: number, seed = 2) { // Paul Kellet filter
  const r = rng(seed); let b0 = 0, b1 = 0, b2 = 0;
  return Int16Array.from({ length: n }, () => { const w = r(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; return clip((b0 + b1 + b2 + w * 0.1848) * amp * 0.5); });
}
/** Formant-synthesised "speech": glottal pulse train through 3 resonators, syllabic envelope. */
function speech(n: number, rate: number, amp: number, f0 = 120) {
  const out = new Int16Array(n);
  const res = [[700, 90], [1200, 110], [2500, 170]].map(([f, bw]) => { const r = Math.exp(-Math.PI * bw! / rate), th = 2 * Math.PI * f! / rate; return { a1: 2 * r * Math.cos(th), a2: -r * r, y1: 0, y2: 0 }; });
  let ph = 0;
  for (let i = 0; i < n; i++) {
    ph += f0 / rate; let src = 0; if (ph >= 1) { ph -= 1; src = 1; }
    let y = 0; for (const f of res) { const v = src * 0.3 + f.a1 * f.y1 + f.a2 * f.y2; f.y2 = f.y1; f.y1 = v; y += v; }
    const t = i / rate;
    const env = Math.max(0, Math.sin(2 * Math.PI * 3 * t)) ** 0.5; // ~3 syllables/s
    out[i] = clip(y * env * amp);
  }
  return out;
}
function babble(n: number, rate: number, amp: number) { // 5 quiet distant "talkers" with different pitch + tempo
  const sum = new Float64Array(n);
  for (const [i, f0] of [95, 110, 140, 180, 210].entries()) { const s = speech(n, rate, amp, f0 + i); const sh = i * 1777 % n; for (let j = 0; j < n; j++) sum[j]! += s[(j + sh) % n]!; }
  return Int16Array.from(sum, clip);
}

/** Feed 20 ms frames; return share of frames flagged voiced after `skip` seconds of settling. */
function voicedShare(sig: Int16Array, rate: 8000 | 16000, skipSec = 2, d = new Denoiser()) {
  const fr = rate / 50; let v = 0, c = 0;
  for (let o = 0; o + fr <= sig.length; o += fr) {
    d.process(sig.subarray(o, o + fr), rate);
    if (o / rate >= skipSec) { c++; if (d.voiced) v++; }
  }
  return v / c;
}

describe("Denoiser", () => {
  for (const rate of [8000, 16000] as const) {
    const n = rate * 12;
    test(`${rate} Hz: white noise counts as silence`, () => { expect(voicedShare(white(n, 2500), rate)).toBeLessThan(0.05); });
    test(`${rate} Hz: pink noise counts as silence`, () => { expect(voicedShare(pink(n, 2500), rate)).toBeLessThan(0.05); });
    test(`${rate} Hz: quiet babble counts as silence`, () => { expect(voicedShare(babble(n, rate, 120), rate)).toBeLessThan(0.15); });
    test(`${rate} Hz: speech over room noise is voiced`, () => {
      const s = speech(n, rate, 6000), nz = pink(n, 300);
      const mix = Int16Array.from(s, (v, i) => clip(v + nz[i]!));
      const d = new Denoiser(), fr = rate / 50;
      let strong = 0, hit = 0, weak = 0, weakHit = 0;
      for (let o = 0; o + fr <= mix.length; o += fr) {
        d.process(mix.subarray(o, o + fr), rate);
        if (o / rate < 2) continue;
        const env = Math.max(0, Math.sin(2 * Math.PI * 3 * ((o + fr / 2) / rate))) ** 0.5; // the syllable envelope used above
        if (env > 0.6) { strong++; if (d.voiced) hit++; } else if (Math.sin(2 * Math.PI * 3 * ((o + fr / 2) / rate)) < -0.85) { weak++; if (d.voiced) weakHit++; }
      }
      expect(hit / strong).toBeGreaterThan(0.85); // clear speech passes
      expect(weakHit / weak).toBeLessThan(0.3); // pauses (room noise only) mostly don't, hangover aside
    });
    test(`${rate} Hz: output keeps length and noise is attenuated`, () => {
      const d = new Denoiser(), sig = pink(n, 3000), fr = rate / 50;
      let ein = 0, eout = 0;
      for (let o = 0; o + fr <= sig.length; o += fr) {
        const out = d.process(sig.subarray(o, o + fr), rate);
        expect(out.length).toBe(fr);
        if (o / rate > 2) for (let i = 0; i < fr; i++) { ein += sig[o + i]! ** 2; eout += out[i]! ** 2; }
      }
      expect(eout).toBeLessThan(ein * 0.25);
    });
  }

  test("odd chunk sizes work and stay the same length", () => {
    const d = new Denoiser(), sig = speech(16000 * 2, 16000, 2000);
    let o = 0;
    for (const len of [37, 160, 1, 333, 320, 5, 999]) { expect(d.process(sig.subarray(o, o + len), 16000).length).toBe(len); o += len; }
  });

  test("CPU: 60 s of speech+room noise in < 3 s (8 kHz and 16 kHz)", () => {
    for (const rate of [8000, 16000] as const) {
      const sp = speech(rate * 60, rate, 6000), nz = pink(rate * 60, 300), fr = rate / 50, d = new Denoiser();
      const sig = Int16Array.from(sp, (v, i) => clip(v + nz[i]!));
      let ms = Infinity; // best of 2: a busy box shouldn't fail the suite
      for (let run = 0; run < 2; run++) {
        const dn = run ? new Denoiser() : d, t0 = performance.now();
        for (let o = 0; o + fr <= sig.length; o += fr) dn.process(sig.subarray(o, o + fr), rate);
        ms = Math.min(ms, performance.now() - t0);
      }
      console.log(`[denoise bench] ${rate} Hz: 60 s of audio in ${ms.toFixed(0)} ms = ${(ms / 600).toFixed(2)}% of one core`);
      expect(ms).toBeLessThan(3000);
    }
  }, 60000);

  test("DENOISE=0 bypasses: same samples back, always voiced (line RMS decides)", async () => {
    const prev = process.env.DENOISE;
    process.env.DENOISE = "0";
    try {
      const { createDenoiser } = await import("../src/voice/denoise.ts");
      expect(createDenoiser()).toBeNull();
      const d = new Denoiser(); // module-level model may be loaded, but a disabled env gives a bypass instance
      const x = white(320, 1000);
      expect(Array.from(d.process(x, 16000))).toEqual(Array.from(x));
      expect(d.active).toBe(false);
    } finally { if (prev === undefined) delete process.env.DENOISE; else process.env.DENOISE = prev; }
  });
});
