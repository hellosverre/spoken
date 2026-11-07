// Per-call noise suppression on the callee audio: RNNoise (WASM) + an adaptive gate.
// RNNoise wants 48 kHz s16-range floats in 480-sample (10 ms) frames, so 8/16 kHz input is
// upsampled (linear), denoised, and box-filtered back. A fixed 10 ms of output is held back so
// any chunk size works; 20 ms line frames are exactly two RNNoise frames.
// The gate decides "voiced" for the line's VAD / barge-in: RNNoise VAD prob >= 0.5 AND frame
// energy above a slow-moving noise floor (percentile of recent frame RMS) plus margin.
// DENOISE=0 bypasses everything; so does a failed WASM load.
// @jitsi/rnnoise-wasm: sync-loadable (wasm inlined), runs in Bun without a window shim, no native build.
// @ts-expect-error no type declarations shipped
import createRNN from "@jitsi/rnnoise-wasm/dist/rnnoise-sync.js";

const FRAME = 480;
const NUM = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== undefined && process.env[k] !== "" ? v : d; };
const VAD_MIN = NUM("DENOISE_VAD", 0.5);
const MARGIN = NUM("DENOISE_MARGIN", 2); // frame RMS must exceed floor * MARGIN
const MIN_ABOVE = NUM("DENOISE_MIN_RMS", 150); // …and floor + this, so a dead-quiet line doesn't gate on dither
const FLOOR_PCT = NUM("DENOISE_FLOOR_PCT", 0.2);
const HANG_FRAMES = NUM("DENOISE_HANG", 6); // 60 ms hangover so word tails aren't clipped
const QUIET_GAIN = NUM("DENOISE_QUIET_GAIN", 0.1); // frames under the gate skip RNNoise (CPU) and are just turned down
const WINDOW = 1000; // 10 s of 10 ms frames

export const denoiseEnabled = () => process.env.DENOISE !== "0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let wasm: any = null;
try { if (denoiseEnabled()) wasm = await (createRNN as () => Promise<unknown>)(); } catch (e) { console.warn("[denoise] rnnoise load failed, bypassing:", (e as Error).message); }

export class Denoiser {
  private st: number | null = null; private ptr = 0;
  private inBuf = new Float32Array(FRAME * 4); private inLen = 0; // 48 kHz awaiting a full frame
  private outBuf = new Float32Array(FRAME * 8); private outLen = FRAME; // 48 kHz, prefilled with 10 ms silence
  private frameIn = new Float32Array(FRAME);
  private prev = 0; // last input sample, for interpolation across chunks
  private rmsRing = new Float32Array(WINDOW); private ringN = 0; private ringPos = 0;
  private sinceFloor = 0;
  private floorRms = 0;
  private hang = 0;
  private lastVad = 0;
  /** Gate verdict for the most recent process() call. */
  voiced = false;
  /** Slow-moving noise floor (input RMS). */
  get floor() { return this.floorRms; }
  /** Max RNNoise VAD probability over the last chunk. */
  get vad() { return this.lastVad; }
  get active() { return this.st !== null; }

  constructor() {
    if (wasm && denoiseEnabled()) { this.st = wasm._rnnoise_create(0); this.ptr = wasm._malloc(FRAME * 4); }
  }

  destroy() { if (this.st !== null) { wasm._rnnoise_destroy(this.st); wasm._free(this.ptr); } this.st = null; }

  process(pcm16: Int16Array, rate: 8000 | 16000): Int16Array {
    if (!this.st) { this.voiced = true; this.lastVad = 1; return pcm16; } // bypass: the line's own RMS threshold decides
    const k = 48000 / rate;
    const n = pcm16.length;
    // upsample (linear) into the 48 kHz input queue
    this.ensure(this.inLen + n * k, "in");
    let p = this.prev;
    for (let i = 0; i < n; i++) {
      const s = pcm16[i]!;
      for (let j = 1; j <= k; j++) this.inBuf[this.inLen++] = p + (s - p) * (j / k);
      p = s;
    }
    this.prev = p;
    // run whole 10 ms frames
    let off = 0, vadMax = 0, anyFrame = false, frameVoiced = false;
    while (this.inLen - off >= FRAME) {
      this.frameIn.set(this.inBuf.subarray(off, off + FRAME));
      off += FRAME;
      let e = 0;
      for (let i = 0; i < FRAME; i += 4) e += this.frameIn[i]! * this.frameIn[i]!;
      const inRms = Math.sqrt(e / (FRAME / 4));
      let vad = 0;
      if (this.hang > 0 || this.ringN < 200 || inRms > this.openAt()) {
        const h: Float32Array = wasm.HEAPF32, base = this.ptr >> 2;
        h.set(this.frameIn, base);
        vad = wasm._rnnoise_process_frame(this.st, this.ptr, this.ptr) as number;
        this.frameIn.set(h.subarray(base, base + FRAME));
      } else for (let i = 0; i < FRAME; i++) this.frameIn[i] = this.frameIn[i]! * QUIET_GAIN;
      this.ensure(this.outLen + FRAME, "out");
      this.outBuf.set(this.frameIn, this.outLen); this.outLen += FRAME;
      if (vad > vadMax) vadMax = vad;
      anyFrame = true;
      if (this.gate(inRms, vad)) frameVoiced = true;
    }
    if (off) { this.inBuf.copyWithin(0, off, this.inLen); this.inLen -= off; }
    if (anyFrame) { this.voiced = frameVoiced; this.lastVad = vadMax; }
    // box-filter downsample the oldest n*k output samples
    const out = new Int16Array(n);
    const o = this.outBuf;
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (let j = 0; j < k; j++) a += o[i * k + j]!;
      const v = Math.round(a / k);
      out[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
    }
    const used = n * k;
    o.copyWithin(0, used, this.outLen); this.outLen -= used;
    return out;
  }

  private openAt() { return Math.max(this.floorRms * MARGIN, this.floorRms + MIN_ABOVE); }

  private gate(inRms: number, vad: number): boolean {
    this.rmsRing[this.ringPos] = inRms;
    this.ringPos = (this.ringPos + 1) % WINDOW;
    if (this.ringN < WINDOW) this.ringN++;
    if (++this.sinceFloor >= (this.floorRms ? 100 : 20)) { // refresh each second (faster while learning)
      this.sinceFloor = 0;
      const s = Array.from(this.rmsRing.subarray(0, this.ringN)).sort((a, b) => a - b);
      this.floorRms = s[Math.floor(s.length * FLOOR_PCT)]!;
    }
    const loud = inRms > this.openAt();
    if (vad >= VAD_MIN && loud) this.hang = HANG_FRAMES;
    else if (this.hang > 0) { this.hang--; return true; }
    return vad >= VAD_MIN && loud;
  }

  private ensure(need: number, which: "in" | "out") {
    const cur = which === "in" ? this.inBuf : this.outBuf;
    if (need <= cur.length) return;
    const nb = new Float32Array(Math.max(need, cur.length * 2));
    nb.set(cur.subarray(0, which === "in" ? this.inLen : this.outLen));
    if (which === "in") this.inBuf = nb; else this.outBuf = nb;
  }
}


/** One Denoiser per call; null when DENOISE=0 so callers keep their original path. */
export function createDenoiser(): Denoiser | null { return denoiseEnabled() ? new Denoiser() : null; }
