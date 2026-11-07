import type { Lang, Outcome, Profile, Question, Shareable } from "../../../shared/contract.ts";

export type Tone = "friendly" | "firm" | "hurry";

export interface HistoryItem {
  role: "agent" | "callee" | "user" | "system";
  text: string;
}

/** What the agent knows during a call. Never contains fnr/card numbers: those live only in the TTS step. */
export interface AgentContext {
  goal: string;
  calleeName: string;
  userName: string;
  willShare: Shareable[];
  needsApprovalFor: string[];
  profileFacts: Record<string, string>; // only facts the user allowed for this call
  tone: Tone;
  simpler: boolean;
  history: HistoryItem[];
}

export interface ClarifyOut {
  summary: string;
  questions: Question[];
}

export interface PlanOut {
  calleeName: string;
  phone?: string;
  goal: string;
  willShare: Shareable[];
  needsApprovalFor: string[];
}

export interface SummaryOut {
  outcome: Outcome;
  summary: string;
  details: Record<string, string>;
}

export interface TaskForLlm {
  text: string;
  lang: Lang;
  phone?: string;
  profile: Profile;
}

/**
 * Agent replies are plain Norwegian speech plus optional control tags the server parses:
 *   [[ASK: question | option | option]]  ask the user (approval or a choice), then wait
 *   [[END: outcome | summary]]           finish the call after speaking
 *   [[NOTE: text]]                       show a note to the user
 */
export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUsd?: number; // OpenRouter reports it per request
}

export interface LlmProvider {
  name: string;
  /** Model id, for the latency panel. */
  model?: string;
  /** Open the TLS connection early (call start), so the first turn doesn't pay for it. */
  warm?(): Promise<void>;
  clarify(task: TaskForLlm): Promise<ClarifyOut>;
  plan(task: TaskForLlm, answers: Record<string, string>): Promise<PlanOut>;
  reply(ctx: AgentContext, signal: AbortSignal, onUsage?: (u: Usage) => void): AsyncIterable<string>;
  summarize(ctx: AgentContext, onUsage?: (u: Usage) => void): Promise<SummaryOut>;
}
