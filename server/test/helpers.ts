import type { LiveEvent } from "../../shared/contract.ts";
import { createApp } from "../src/app.ts";
import { config } from "../src/config.ts";
import { resetLimits } from "../src/store.ts";

// Tests always run the keyless mock path, fast.
config.callProvider = "mock";
config.llmProvider = "mock";
config.mockSpeed = 0.02;

export function startServer() {
  resetLimits();
  const app = createApp();
  const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  const base = `http://localhost:${server.port}`;
  const post = async (path: string, body?: unknown) => {
    const r = await fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: (await r.json()) as any };
  };
  const get = async (path: string) => {
    const r = await fetch(base + path);
    return { status: r.status, data: (await r.json()) as any };
  };
  return { server, base, post, get, stop: () => server.stop(true) };
}

/** Opens the live socket; auto-answers approvals with `choose` and resolves on `result`. */
export function watchCall(base: string, callId: string, choose: (q: string) => string = () => "JA") {
  const events: LiveEvent[] = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/api/calls/${callId}/live`);
  const done = new Promise<LiveEvent[]>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("call did not finish: " + JSON.stringify(events.map((e) => e.type)))), 15_000);
    ws.onmessage = (m) => {
      const ev = JSON.parse(String(m.data)) as LiveEvent;
      events.push(ev);
      if (ev.type === "approval_request") ws.send(JSON.stringify({ type: "approval_response", id: ev.id, choice: choose(ev.question) }));
      if (ev.type === "result") { clearTimeout(t); ws.close(); resolve(events); }
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
  return { ws, events, done };
}
