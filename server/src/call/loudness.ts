// The person on the phone is close to the mic; people around them are much quieter.
// Call c_d3457ddfdd92 (a room full of people): the callee peaked at 2800–5700 RMS, background
// voices at 300–1300, and the STT turned the background into callee lines.

const BG_RATIO = Number(process.env.BG_RATIO ?? 0.3); // ~ −10 dB below the speaker = background
const MIN_LEVEL = Number(process.env.BG_MIN_LEVEL ?? 1500); // learn the speaker first
const DECAY = 0.9; // per accepted segment, so one loud shout doesn't set the bar for the call

/** 90th percentile of per-frame RMS: how loud the speech in a segment got. */
export function peakLevel(rms: number[]): number {
  if (!rms.length) return 0;
  const s = [...rms].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]!;
}

export class SpeakerLevel {
  level = 0;
  /** Below this a voice is someone in the background (0 until the speaker is known). */
  floor() { return this.level >= MIN_LEVEL ? this.level * BG_RATIO : 0; }
  isBackground(peak: number) { return peak < this.floor(); }
  /** A segment we kept as the callee's: track their level. */
  accept(peak: number) { this.level = Math.max(peak, this.level * DECAY); }
}
