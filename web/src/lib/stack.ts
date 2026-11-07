import { IS_MOCK } from "../api/index.ts";

// Content for the "Built with ElevenLabs" panel. The contract has no latency
// fields yet, so real mode shows a dash until the server reports timings.
// Model names are set here in one place; update them after Saturday's A/B test.

export interface StackStep {
  key: "stt" | "llm" | "tts";
  model: string;
  vendor: string;
  latencyMs?: number;
}

export const STACK: StackStep[] = [
  { key: "stt", model: "Scribe (realtime)", vendor: "ElevenLabs", latencyMs: IS_MOCK ? 180 : undefined },
  { key: "llm", model: "Language model (picked on the server)", vendor: "", latencyMs: IS_MOCK ? 420 : undefined },
  { key: "tts", model: "Flash", vendor: "ElevenLabs", latencyMs: IS_MOCK ? 95 : undefined },
];
