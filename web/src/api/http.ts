import type { LiveCommand, LiveEvent } from "../../../shared/contract.ts";
import { API_URL, WS_URL } from "./config.ts";
import { ApiError, type Api, type LiveConnection, type LiveHandlers } from "./types.ts";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("network", 0);
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // body was not JSON; keep the status line
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;

/** Live socket with bounded reconnects. Commands sent while down are queued. */
function openLive(callId: string, h: LiveHandlers): LiveConnection {
  let ws: WebSocket | null = null;
  let closedByUs = false;
  let attempt = 0;
  let ended = false;
  const queue: LiveCommand[] = [];

  const connect = () => {
    h.onState(attempt === 0 ? "connecting" : "reconnecting");
    ws = new WebSocket(`${WS_URL}/api/calls/${enc(callId)}/live`);
    ws.onopen = () => {
      attempt = 0;
      h.onState("open");
      while (queue.length) ws?.send(JSON.stringify(queue.shift()));
    };
    ws.onmessage = (msg) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(String(msg.data)) as LiveEvent;
      } catch {
        console.warn("live: dropped a message that was not JSON");
        return;
      }
      if (event.type === "result") ended = true;
      h.onEvent(event);
    };
    ws.onclose = () => {
      if (closedByUs || ended || attempt >= 6) {
        h.onState("closed");
        return;
      }
      attempt += 1;
      h.onState("reconnecting");
      setTimeout(connect, Math.min(500 * 2 ** attempt, 5000));
    };
  };
  connect();

  return {
    send(command) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(command));
      else queue.push(command);
    },
    close() {
      closedByUs = true;
      ws?.close();
    },
  };
}

export const httpApi: Api = {
  createTask: (input) => request("POST", "/api/tasks", input),
  answer: (taskId, answers) => request("POST", `/api/tasks/${enc(taskId)}/answers`, { answers }),
  startCall: (taskId) => request("POST", `/api/tasks/${enc(taskId)}/call`, { approved: true }),
  hangup: (callId) => request("POST", `/api/calls/${enc(callId)}/hangup`),
  getCall: (callId) => request("GET", `/api/calls/${enc(callId)}`),
  voices: () => request("GET", "/api/voices"),
  designVoice: (description) => request("POST", "/api/voices/design", { description }),
  getProfile: () => request("GET", "/api/profile"),
  putProfile: (profile) => request("PUT", "/api/profile", profile),
  live: openLive,
};
