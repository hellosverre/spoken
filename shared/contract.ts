// Shared contract between server/ and web/. Change only via the lead.

export type Lang = "no" | "en";

export interface TaskInput {
  text: string; // "Bestill en stor pepperoni fra Domino's Storo til 18:00"
  lang: Lang; // UI language; the call itself uses the callee's language
  phone?: string; // E.164 if the user typed a number
  contactId?: string; // a saved place
}

export interface Question {
  id: string;
  text: string;
  options?: string[]; // quick taps; free text always allowed
}

export interface Clarify {
  taskId: string;
  summary: string; // one line: what Spoken understood
  questions: Question[];
}

export type Shareable = "name" | "phone" | "address" | "email" | "birthdate" | "fnr" | "allergies";

export interface Plan {
  taskId: string;
  callee: { name: string; phone: string; source: "user" | "lookup" | "contact" };
  goal: string;
  opening: string; // the exact first sentence, with the AI disclosure
  willShare: Shareable[];
  needsApprovalFor: string[]; // e.g. ["price over 0 kr", "booking a time"]
  voiceId: string;
  blocked?: { reason: string; alternative?: string }; // e.g. emergency number
}

export type CallStatus = "dialing" | "ringing" | "connected" | "on_hold" | "ended" | "failed";

export interface Word {
  text: string;
  confidence: number; // 0..1; under 0.6 renders grey
}

export type LiveEvent =
  | { type: "status"; status: CallStatus; at: number }
  | { type: "transcript"; id: string; who: "callee" | "agent"; text: string; final: boolean; words?: Word[]; at: number }
  | { type: "agent_typing"; at: number }
  | { type: "approval_request"; id: string; question: string; options: string[]; at: number }
  | { type: "note"; text: string; level: "info" | "warn"; at: number }
  | { type: "result"; result: CallResult };

export type LiveCommand =
  | { type: "approval_response"; id: string; choice: string }
  | { type: "instruction"; text: string }
  | { type: "say_simpler" }
  | { type: "tone"; tone: "friendly" | "firm" | "hurry" }
  | { type: "hangup" };

export type Outcome = "done" | "partial" | "failed" | "refused" | "no_answer";

export interface TranscriptLine {
  who: "callee" | "agent";
  text: string;
  at: number;
}

export interface CallResult {
  callId: string;
  taskId: string;
  outcome: Outcome;
  summary: string; // "Bestilt: 1 stor pepperoni, hentes 18:00, 189 kr"
  details: Record<string, string>; // time, price, reference…
  transcript: TranscriptLine[];
  durationSec: number;
}

export interface Voice {
  id: string; // ElevenLabs voice id
  name: string;
  description: string;
  preset: boolean;
}

export interface Profile {
  name: string;
  phone?: string;
  address?: string;
  email?: string;
  allergies?: string;
  // Preferences only, never diagnoses (GDPR Art. 9)
  hearCall: boolean; // false = read only
  voiceId?: string;
  personality: "warm" | "neutral" | "short";
  lang: Lang;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  kind: "business" | "person";
}
