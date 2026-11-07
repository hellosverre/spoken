import type {
  CallResult,
  Clarify,
  LiveCommand,
  LiveEvent,
  Plan,
  Profile,
  TaskInput,
  Voice,
} from "../../../shared/contract.ts";

/** Everything the UI needs from the server. Implemented by http.ts and mock.ts. */
export interface Api {
  createTask(input: TaskInput): Promise<Clarify>;
  answer(taskId: string, answers: Record<string, string>): Promise<Plan>;
  startCall(taskId: string): Promise<{ callId: string }>;
  hangup(callId: string): Promise<{ ok: boolean }>;
  getCall(callId: string): Promise<CallResult>;
  voices(): Promise<Voice[]>;
  designVoice(description: string): Promise<Voice>;
  getProfile(): Promise<Profile>;
  putProfile(profile: Profile): Promise<Profile>;
  /** Opens the live channel for a call. */
  live(callId: string, handlers: LiveHandlers): LiveConnection;
}

export type LiveState = "connecting" | "open" | "reconnecting" | "closed";

export interface LiveHandlers {
  onEvent(event: LiveEvent): void;
  onState(state: LiveState): void;
}

export interface LiveConnection {
  send(command: LiveCommand): void;
  close(): void;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}
