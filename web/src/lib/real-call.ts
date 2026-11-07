import type { Lang, Row } from "./i18n";
import { SCENARIOS, type AskConfig, type CallIO, type Outcome, type Scenario, type ScenarioKey } from "./scenarios";

/* Real calls through the Spoken call server (server/ in this repo). The app keeps its UI:
   the server's clarify questions arrive as chat messages, the server's plan fills the plan
   card through a runtime "real" scenario, and the live call drives the same CallIO the
   scripted demos use (say → transcript, ask → approval sheet).

   NEXT_PUBLIC_SPOKEN_API: "/" = the server that serves this page; empty = scripted only.
   ?scripted in the URL forces the scripted demos. */

const API = process.env.NEXT_PUBLIC_SPOKEN_API ?? "";

/** Ask the server's clarify questions in the chat before planning. */
const ASK_QUESTIONS = false;

export const REAL: ScenarioKey = "real" as ScenarioKey;

export function realEnabled(): boolean {
  if (!API || typeof window === "undefined") return false;
  return !new URLSearchParams(window.location.search).has("scripted");
}

function base(): string {
  return API === "/" ? window.location.origin : API.replace(/\/$/, "");
}

async function http<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base() + path, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Får ikke kontakt med Spoken-serveren.");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Wire types from shared/contract.ts (kept local so the Next build doesn't reach outside web/).
interface Question { id: string; text: string; options?: string[] }
interface Clarify { taskId: string; summary: string; questions: Question[] }
interface Plan {
  taskId: string;
  callee: { name: string; phone: string; source: string };
  goal: string;
  opening: string;
  willShare: string[];
  needsApprovalFor: string[];
  blocked?: { reason: string; alternative?: string };
}
interface CallResult { outcome: string; summary: string; details: Record<string, string> }
type LiveEvent =
  | { type: "status"; status: string }
  | { type: "transcript"; id: string; who: "callee" | "agent"; text: string; final: boolean }
  | { type: "approval_request"; id: string; question: string; options: string[] }
  | { type: "note"; text: string; level: "info" | "warn" }
  | { type: "result"; result: CallResult }
  | { type: string };

/** What the chat needs to run the clarify step. */
export interface ChatPort {
  bot(text: string): Promise<void>;
  /** Shows a question as a bot message and resolves with the user's next chat message. */
  askUser(text: string): Promise<string>;
}

/** Extra hooks the store gives a real call on top of CallIO. */
export interface LiveIO extends CallIO {
  note(text: string): void;
  connected(): void;
  /** Where the store sends the user's mid-call messages, chips and hang-up. */
  attach(sink: { instruction(text: string): void; hangup(): void } | null): void;
}

const NEGATIVE = /^(nei|no|avslå|decline|legg på)$/i;

/* Demo passcode for real calls. Asked once (a tiny browser prompt) and kept in localStorage;
   without it the server runs the call in mock mode, so anyone opening the link sees the demo.
   ?passcode=… in the URL sets it, ?passcode= clears it. */
const PASS_KEY = "spoken-passcode";

function passcode(): string {
  try {
    const url = new URLSearchParams(window.location.search);
    if (url.has("passcode")) localStorage.setItem(PASS_KEY, url.get("passcode") ?? "");
    const saved = localStorage.getItem(PASS_KEY);
    if (saved !== null) return saved;
    const typed = window.prompt("Demo-kode for ekte samtaler (la stå tom for demo):") ?? "";
    localStorage.setItem(PASS_KEY, typed.trim());
    return typed.trim();
  } catch {
    return "";
  }
}

function pickOption(answer: string, options?: string[]): string {
  if (!options?.length) return answer;
  const a = answer.trim().toLowerCase();
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!;
  return options.find((o) => o.toLowerCase() === a || o.toLowerCase().startsWith(a)) ?? answer;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const prettyPhone = (p: string) => p.replace(/^\+47(\d{2})(\d{2})(\d{2})(\d{2})$/, "+47 $1 $2 $3 $4");

/**
 * Chat step: task → server clarify questions (answered in the chat) → plan. Returns the
 * scenario key to show in the plan card, or null if the server blocked the task.
 */
export async function planRealCall(text: string, lang: Lang, chat: ChatPort): Promise<ScenarioKey | null> {
  const phone = text.match(/\+?\d[\d \-]{6,16}\d/)?.[0].replace(/[ \-]/g, "");
  const c = await http<Clarify>("POST", "/api/tasks", { text, lang, ...(phone ? { phone } : {}) });
  const answers: Record<string, string> = {};
  // Questions are off for now: the server plans from the request alone.
  if (ASK_QUESTIONS && c.questions.length) {
    await chat.bot(c.summary);
    for (const q of c.questions) {
      const opts = q.options?.length ? `\n${q.options.map((o, i) => `${i + 1}. ${o}`).join("   ")}` : "";
      answers[q.id] = pickOption(await chat.askUser(q.text + opts), q.options);
    }
  }
  const plan = await http<Plan>("POST", `/api/tasks/${encodeURIComponent(c.taskId)}/answers`, { answers });
  if (plan.blocked) {
    await chat.bot([plan.blocked.reason, plan.blocked.alternative].filter(Boolean).join(" "));
    return null;
  }
  registerReal(plan, text);
  return REAL;
}

function registerReal(plan: Plan, request: string) {
  const lines = {
    contact: plan.callee.name || prettyPhone(plan.callee.phone),
    request,
    goal: plan.goal.charAt(0).toUpperCase() + plan.goal.slice(1),
    checks: plan.needsApprovalFor.slice(0, 3),
    opening: plan.opening,
  };
  const sc: Scenario & { live: true } = {
    live: true,
    init: initials(plan.callee.name),
    number: prettyPhone(plan.callee.phone),
    en: lines,
    no: lines,
    run: (lang, io) => runRealCall(plan.taskId, lang, io as LiveIO),
  };
  (SCENARIOS as Record<string, Scenario>).real = sc;
}

export function isLive(key: ScenarioKey): boolean {
  return !!(SCENARIOS as Record<string, Scenario & { live?: boolean }>)[key]?.live;
}

/** The live call: server events → say/ask; the user's messages → the server. */
async function runRealCall(taskId: string, lang: Lang, io: LiveIO): Promise<Outcome> {
  const code = passcode();
  const { callId, mode, passcode: pc } = await http<{ callId: string; mode?: string; passcode?: string }>(
    "POST", `/api/tasks/${encodeURIComponent(taskId)}/call`, { approved: true }, code ? { "X-Spoken-Passcode": code } : {},
  );
  if (pc === "wrong") {
    try { localStorage.removeItem(PASS_KEY); } catch {}
    io.note(lang === "no" ? "Feil demo-kode, så dette er en demosamtale." : "Wrong demo code, so this is a demo call.");
  } else if (mode === "mock") {
    io.note(lang === "no" ? "Demosamtale: ingen ekte telefon ringer." : "Demo call: no real phone is ringing.");
  }
  const ws = new WebSocket(`${base().replace(/^http/, "ws")}/api/calls/${encodeURIComponent(callId)}/live`);
  const send = (cmd: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)); };
  io.attach({ instruction: (text) => send({ type: "instruction", text }), hangup: () => send({ type: "hangup" }) });

  // Lines are shown one after another (say animates word by word); the approval sheet runs beside them.
  let chain: Promise<void> = Promise.resolve();
  const queue = (fn: () => Promise<void>) => { chain = chain.then(fn).catch(() => {}); };
  const shown = new Set<string>();
  let connected = false;

  let finished = false;
  const result = await new Promise<CallResult>((resolve, reject) => {
    ws.onmessage = (m) => {
      let e: LiveEvent;
      try { e = JSON.parse(String(m.data)); } catch { return; }
      switch (e.type) {
        case "status": {
          const s = (e as { status: string }).status;
          if (s === "connected" && !connected) { connected = true; io.connected(); }
          break;
        }
        case "transcript": {
          const t = e as Extract<LiveEvent, { type: "transcript" }>;
          // Agent: show when it starts speaking. Callee: the first final version (later STT
          // corrections reuse the id; this UI appends lines, so they are skipped).
          const ready = t.who === "agent" ? !t.final : t.final;
          if (!ready || shown.has(t.id) || !t.text.trim()) break;
          shown.add(t.id);
          queue(() => io.say(t.who === "agent" ? "ai" : "them", t.text));
          break;
        }
        case "approval_request": {
          const a = e as Extract<LiveEvent, { type: "approval_request" }>;
          const neg = a.options.find((o) => NEGATIVE.test(o));
          const pos = a.options.filter((o) => o !== neg);
          const yesNo = pos.length === 1 && /^(ja|yes)$/i.test(pos[0]!);
          const cfg: AskConfig = {
            title: a.question,
            rows: [] as Row[],
            hold: lang === "no" ? "Et lite øyeblikk, jeg sjekker med deg." : "One moment, I'm checking with you.",
            options: pos.map((o) => ({ v: o, label: yesNo ? (lang === "no" ? "Godta" : "Approve") : o })),
            decline: neg ?? (lang === "no" ? "Avslå" : "Decline"),
          };
          io.ask(cfg)
            .then((v) => send({ type: "approval_response", id: a.id, choice: v === "no" ? (neg ?? "NEI") : v }))
            .catch(() => { /* hung up while the sheet was open */ });
          break;
        }
        case "note":
          io.note((e as { text: string }).text);
          break;
        case "result":
          finished = true;
          resolve((e as { result: CallResult }).result);
          break;
      }
    };
    ws.onerror = () => reject(new Error("Mistet forbindelsen til samtalen."));
    ws.onclose = () => {
      if (finished) return;
      // Socket gone before the result: ask the server (202 while the call is still running).
      void (async () => {
        for (let i = 0; i < 30; i++) {
          const r = await http<CallResult & { inProgress?: boolean }>("GET", `/api/calls/${encodeURIComponent(callId)}`).catch(() => null);
          if (r && !r.inProgress) return resolve(r);
          await new Promise((ok) => setTimeout(ok, 2000));
        }
        reject(new Error("Fikk ikke resultatet fra samtalen."));
      })();
    };
  });

  await chain;
  io.attach(null);
  try { ws.close(); } catch {}
  const rows = Object.entries(result.details ?? {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v] as Row);
  return { ok: result.outcome === "done", title: result.summary, rows };
}
