import { useCallback, useEffect, useReducer, useRef } from "react";
import type { CallResult, CallStatus, LiveCommand, LiveEvent, Word } from "../../../shared/contract.ts";
import { api, type LiveState } from "../api/index.ts";

// Folds the live event stream into what the call screen renders.

export interface LiveLine {
  id: string;
  who: "callee" | "agent";
  text: string;
  words: Word[];
  final: boolean;
  at: number;
}

export interface LiveNote {
  text: string;
  level: "info" | "warn";
  at: number;
}

export interface Approval {
  id: string;
  question: string;
  options: string[];
  at: number;
}

export interface LiveCallState {
  connection: LiveState;
  status: CallStatus;
  connectedAt?: number;
  lines: LiveLine[];
  agentTyping: boolean;
  approval?: Approval;
  notes: LiveNote[];
  result?: CallResult;
}

type Act = { kind: "event"; event: LiveEvent } | { kind: "connection"; state: LiveState } | { kind: "answered" };

const init: LiveCallState = { connection: "connecting", status: "dialing", lines: [], agentTyping: false, notes: [] };

function wordsOf(e: Extract<LiveEvent, { type: "transcript" }>): Word[] {
  return e.words ?? e.text.split(/\s+/).filter(Boolean).map((text) => ({ text, confidence: 1 }));
}

function reduce(s: LiveCallState, a: Act): LiveCallState {
  if (a.kind === "connection") return { ...s, connection: a.state };
  if (a.kind === "answered") return { ...s, approval: undefined };
  const e = a.event;
  switch (e.type) {
    case "status":
      return {
        ...s,
        status: e.status,
        connectedAt: e.status === "connected" && !s.connectedAt ? e.at : s.connectedAt,
      };
    case "transcript": {
      const line: LiveLine = { id: e.id, who: e.who, text: e.text, words: wordsOf(e), final: e.final, at: e.at };
      const i = s.lines.findIndex((l) => l.id === e.id);
      const lines = i === -1 ? [...s.lines, line] : s.lines.map((l, j) => (j === i ? line : l));
      return { ...s, lines, agentTyping: e.who === "agent" ? false : s.agentTyping };
    }
    case "agent_typing":
      return { ...s, agentTyping: true };
    case "approval_request":
      // While waiting for the user the AI only holds the line, so drop the typing hint.
      return { ...s, agentTyping: false, approval: { id: e.id, question: e.question, options: e.options, at: e.at } };
    case "note":
      return { ...s, notes: [...s.notes, { text: e.text, level: e.level, at: e.at }] };
    case "result":
      return { ...s, result: e.result, status: "ended", approval: undefined, agentTyping: false };
    case "level":
      // Voice loudness drives the visual through onEvent; it isn't reducer state.
      return s;
  }
}

export function useLiveCall(callId: string, onEvent?: (e: LiveEvent) => void) {
  const [state, dispatch] = useReducer(reduce, init);
  const conn = useRef<ReturnType<typeof api.live> | null>(null);
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const c = api.live(callId, {
      onEvent: (event) => {
        dispatch({ kind: "event", event });
        handler.current?.(event);
      },
      onState: (s) => dispatch({ kind: "connection", state: s }),
    });
    conn.current = c;
    return () => {
      c.close();
      conn.current = null;
    };
  }, [callId]);

  const send = useCallback((cmd: LiveCommand) => {
    conn.current?.send(cmd);
    if (cmd.type === "approval_response") dispatch({ kind: "answered" });
  }, []);

  return { state, send };
}
