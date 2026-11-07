// The audio side of a call. A line dials, plays agent speech and reports what the
// callee says. Mock and Telnyx implement it; CallSession never knows which one it has.

import type { CallStatus, Word } from "../../../shared/contract.ts";

export type SpeakKind = "say" | "filler";

export interface LineEvents {
  status(status: CallStatus, detail?: string): void;
  /** Callee started talking (VAD/partial): used for barge-in. */
  calleeSpeech(): void;
  calleePartial(segmentId: string, text: string): void;
  calleeFinal(segmentId: string, text: string, words?: Word[]): void;
  /** Same segment again once word confidences arrive. */
  calleeWords?(segmentId: string, text: string, words: Word[]): void;
  ended(reason: string): void;
}

export interface CallLine {
  start(events: LineEvents): Promise<void>;
  /** Resolves when playback finished, or early with interrupted=true after stopSpeaking(). */
  speak(text: string, kind: SpeakKind): Promise<{ interrupted: boolean }>;
  stopSpeaking(): void;
  startWaitingSound(): void;
  stopWaitingSound(): void;
  hangup(): Promise<void>;
  /** Optional: warm the TTS cache for lines we know we will say (while it rings). */
  prefetch?(texts: string[]): void;
}
