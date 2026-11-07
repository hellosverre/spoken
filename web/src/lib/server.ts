import type { CallResult, Clarify, LiveCommand, LiveEvent, Plan, TaskInput } from "@shared/contract";

/* Client for the call server (see CONTRACT.md). With no server URL the app
   plays its scripted practice calls instead. */

const trim = (u: string) => u.replace(/\/+$/, "");

/** The server URL: `?api=` in the page URL wins, then NEXT_PUBLIC_API_URL. */
export function serverUrl(): string | null {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(location.search).get("api");
    if (q === "off") return null;
    if (q && /^https?:\/\//.test(q)) return trim(q);
  }
  const env = process.env.NEXT_PUBLIC_API_URL;
  return env ? trim(env) : null;
}

function wsUrl(api: string): string {
  const env = process.env.NEXT_PUBLIC_WS_URL;
  if (env && api === trim(process.env.NEXT_PUBLIC_API_URL ?? "")) return trim(env);
  return api.replace(/^http/, "ws");
}

export class ServerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(api: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ServerError(res.status, (data && (data.error || data.message)) || `HTTP ${res.status}`);
  return data as T;
}

/** A phone number typed in the request, as digits with an optional +. */
export function findPhone(text: string): string | undefined {
  const m = text.match(/\+?\d[\d \-]{6,16}\d/);
  return m ? m[0].replace(/[ \-]/g, "") : undefined;
}

export const api = {
  createTask: (base: string, input: TaskInput) => call<Clarify>(base, "/api/tasks", input),
  answer: (base: string, taskId: string, answers: Record<string, string>) =>
    call<Plan>(base, `/api/tasks/${taskId}/answers`, { answers }),
  startCall: (base: string, taskId: string) => call<{ callId: string }>(base, `/api/tasks/${taskId}/call`, { approved: true }),
  hangup: (base: string, callId: string) => call<{ ok: boolean }>(base, `/api/calls/${callId}/hangup`, {}),
  /** The result, or null while the call is still running (HTTP 202). */
  result: async (base: string, callId: string) => {
    const r = await call<CallResult | { inProgress: true }>(base, `/api/calls/${callId}`);
    return "outcome" in r ? r : null;
  },
};

export interface LiveSocket {
  send(cmd: LiveCommand): void;
  close(): void;
}

/**
 * Opens the live socket for a call and reconnects if it drops.
 * The server replays every past event on connect, so callers must handle repeats.
 */
export function openLive(base: string, callId: string, onEvent: (e: LiveEvent) => void, onLost: () => void): LiveSocket {
  let ws: WebSocket | null = null;
  let closed = false;
  let tries = 0;
  const queue: LiveCommand[] = [];

  const connect = () => {
    ws = new WebSocket(`${wsUrl(base)}/api/calls/${callId}/live`);
    ws.onopen = () => {
      tries = 0;
      while (queue.length) ws!.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(String(m.data)) as LiveEvent);
      } catch {}
    };
    ws.onclose = () => {
      if (closed) return;
      if (++tries > 6) return onLost();
      setTimeout(connect, Math.min(4000, 300 * 2 ** tries));
    };
  };
  connect();

  return {
    send(cmd) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
      else queue.push(cmd);
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
