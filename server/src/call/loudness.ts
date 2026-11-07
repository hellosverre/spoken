// The person on the phone is usually much louder than people around them.
// c_d3457ddfdd92 (full room): callee 2800–5700 RMS, background voices 300–1300.
// c_73b6b5529e9b: the callee said «Jeg vil ha pizza» at 604 — quieter than a background
// voice (751). So only very faint speech is dropped; quiet speech goes to the LLM marked
// ⟨svak stemme⟩, and it decides whether it belongs to the call.

const FAINT = Number(process.env.BG_RATIO ?? 0.3); // quieter than this share of the callee: marked, can't barge in
const DROP = Number(process.env.BG_DROP_RATIO ?? 0.1); // quieter than this: dropped
const MIN_LEVEL = Number(process.env.BG_MIN_LEVEL ?? 1500); // learn the callee first
const KEEP = 5; // median of the last 5 kept lines, so one shout doesn't set the bar

/** 90th percentile of per-frame RMS: how loud the speech in a segment got. */
export function peakLevel(rms: number[]): number {
  if (!rms.length) return 0;
  const s = [...rms].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!;
}

export class SpeakerLevel {
  private peaks: number[] = [];
  /** The callee's typical loudness (0 until known). */
  get level() {
    if (!this.peaks.length) return 0;
    const s = [...this.peaks].sort((a, b) => a - b);
    const m = s.length >> 1;
    const med = s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
    return med >= MIN_LEVEL ? med : 0;
  }
  /** Below this a voice can't barge in and is marked faint. */
  floor() { return this.level * FAINT; }
  isFaint(peak: number) { return peak < this.floor(); }
  /** So quiet it's almost surely someone else in the room. */
  isBackground(peak: number) { return peak < this.level * DROP; }
  /** A line we took as the callee's at normal loudness. */
  accept(peak: number) { this.peaks.push(peak); if (this.peaks.length > KEEP) this.peaks.shift(); }
}
