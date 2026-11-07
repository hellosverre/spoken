// The audio side of a call. A line dials, plays agent speech and reports what the
// callee says. Mock and Telnyx implement it; CallSession never knows which one it has.

import type { CallStatus, Word } from "../../../shared/contract.ts";

export type SpeakKind = "say" | "filler";

export type LineMetric =
  | { kind: "tts_first_byte"; ms: number }
  | { kind: "first_audio"; at: number };

export interface LineEvents {
  status(status: CallStatus, detail?: string): void;
  /** Callee started talking (VAD/partial): used for barge-in. */
  calleeSpeech(): void;
  calleePartial(segmentId: string, text: string): void;
  /** speechEndAt: when the callee's audio last had voice (local VAD), for the STT latency figure. */
  calleeFinal(segmentId: string, text: string, words?: Word[], meta?: { speechEndAt?: number }): void;
  /** Same segment again once word confidences arrive. */
  calleeWords?(segmentId: string, text: string, words: Word[]): void;
  /** A slower, more accurate transcript of the same segment (batch STT). */
  calleeRevised?(segmentId: string, text: string, words: Word[]): void;
  /** Batch STT heard only background noise in this segment: the realtime line was made up. */
  calleeNoise?(segmentId: string): void;
  ended(reason: string): void;
  /** Line-level facts for the per-call debug log (latency, webhooks, media format). */
  debug?(kind: string, data: Record<string, unknown>): void;
  /** Timing facts for the latency panel. */
  metric?(m: LineMetric): void;
  /** Usage this line caused, reported once at the end. */
  cost?(c: { ttsChars: number; sttSec: number }): void;
  /** Voice loudness 0..1 at ~15 Hz while someone talks (live visual). */
  level?(who: "callee" | "agent", rms: number): void;
}

export interface CallLine {
  start(events: LineEvents): Promise<void>;
  /** Resolves when playback finished, or early with interrupted=true after stopSpeaking(). */
  speak(text: string, kind: SpeakKind): Promise<{ interrupted: boolean }>;
  stopSpeaking(): void;
  /** typing = soft keyboard while the user decides; music = hold music while the callee holds. */
  startWaitingSound(kind?: "typing" | "music"): void;
  stopWaitingSound(): void;
  hangup(): Promise<void>;
  /** Optional: warm the TTS cache for lines we know we will say (while it rings). */
  prefetch?(texts: string[]): void;
  /** ms since the callee's audio last had voice energy (Infinity if unknown). */
  silenceMs?(): number;
  /** True if this line sends calleeRevised for segments. */
  readonly revises?: boolean;
  /** True on a real phone line: the person answering speaks first, so we wait for their greeting. */
  readonly answersFirst?: boolean;
}
