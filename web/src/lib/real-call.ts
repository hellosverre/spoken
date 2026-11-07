import { authHeader } from "./account";
import type { Lang, Row } from "./i18n";
import { SCENARIOS, type AskConfig, type CallIO, type Outcome, type Scenario, type ScenarioKey } from "./scenarios";
import { resetFacts, setFacts, type FactItem } from "@/components/FactStrip";
import { setReceipt, type ReceiptData } from "@/components/Receipt";

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

/** This phone's id for the server (profile, contacts, call history). Made once, kept in localStorage. */
const DEVICE_KEY = "spoken-device";
function deviceId(): string {
  try {
    let d = localStorage.getItem(DEVICE_KEY);
    if (!d) { d = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, d); }
    return d;
  } catch {
    return "";
  }
}

async function http<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  let res: Response;
  try {
    const device = deviceId();
    res = await fetch(base() + path, {
      method,
      headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(device ? { "X-Spoken-Device": device } : {}), ...authHeader(), ...extra },
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
  targets?: { name: string; phone: string }[];
  blocked?: { reason: string; alternative?: string };
}
interface CallResult { outcome: string; summary: string; details: Record<string, string>; receipt?: ReceiptData }
type LiveEvent =
  | { type: "status"; status: string }
  | { type: "transcript"; id: string; who: "callee" | "agent"; text: string; final: boolean }
  | { type: "approval_request"; id: string; question: string; options: string[] }
  | { type: "note"; text: string; level: "info" | "warn" }
  | { type: "on_hold"; since: number }
  | { type: "hold_over" }
  | { type: "chips"; items: string[] }
  | { type: "result"; result: CallResult }
  | { type: "facts"; items: FactItem[] }
  | { type: string };

/** What the chat needs to run the clarify step. */
export interface ChatPort {
  bot(text: string): Promise<void>;
  /** Shows a question as a bot message and resolves with the user's next chat message. */
  askUser(text: string): Promise<string>;
}

/** Extra hooks the store gives a real call on top of CallIO. */
export interface LiveIO extends CallIO {
  /** Appends words to the speaker's last line (one agent turn arrives clause by clause). */
  sayMore(who: "ai" | "them", text: string): Promise<void>;
  note(text: string): void;
  /** The shop put us on hold (since = epoch ms) or a person is back (null). */
  hold?(since: number | null): void;
  /** Suggested next instructions. */
  chips?(items: string[]): void;
  connected(): void;
  /** Where the store sends the user's mid-call messages, chips and hang-up. */
  attach(sink: { instruction(text: string): void; hangup(): void } | null): void;
}

// Batch STT second opinion lands ~0.5–0.9 s after a callee line; wait this long for it.
const REVISION_WAIT_MS = 1200;
const NEGATIVE = /^(nei|no|avslå|decline|legg på)$/i;

/* Demo passcode for real calls. Asked once (a tiny browser prompt) and kept in localStorage;
   without it the server runs the call in mock mode, so anyone opening the link sees the demo.
   ?passcode=… in the URL sets it, ?passcode= clears it. */
const PASS_KEY = "spoken-passcode";

export function passcode(): string {
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
/** The app's profile tab (name, phone) merged into the server profile, so the call says the right name. */
async function syncProfile(app: { name: string; phone: string }, lang: Lang) {
  if (!app.name.trim()) return;
  try {
    const cur = await http<Record<string, unknown>>("GET", "/api/profile");
    await http("PUT", "/api/profile", {
      hearCall: true, personality: "warm", ...cur, lang,
      name: app.name.trim(), ...(app.phone.trim() ? { phone: app.phone.trim() } : {}),
    });
  } catch { /* the call still works with the server's default profile */ }
}

export async function planRealCall(
  text: string, lang: Lang, chat: ChatPort,
  opts: { profile?: { name: string; phone: string }; contact?: { name: string; phone: string } | null } = {},
): Promise<ScenarioKey | null> {
  if (opts.profile) await syncProfile(opts.profile, lang);
  // A preset's contact number wins; otherwise a number typed in the task text.
  const phone = opts.contact?.phone?.replace(/[ \-]/g, "") || text.match(/\+?\d[\d \-]{6,16}\d/)?.[0].replace(/[ \-]/g, "");
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
  const sc: Scenario & { live: true; targets?: { name: string; phone: string }[] } = {
    live: true,
    init: initials(plan.callee.name),
    number: prettyPhone(plan.callee.phone),
    en: lines,
    no: lines,
    ...(plan.targets && plan.targets.length > 1 ? { targets: plan.targets } : {}),
    run: (lang, io) => runRealCall(plan.taskId, lang, io as LiveIO),
  };
  (SCENARIOS as Record<string, Scenario>).real = sc;
}

/** 2–3 places when the plan asks them in parallel (info only); undefined for a normal single call. */
export function planTargets(key: ScenarioKey): { name: string; phone: string }[] | undefined {
  return (SCENARIOS as Record<string, { targets?: { name: string; phone: string }[] }>)[key]?.targets;
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
  resetFacts();
  setReceipt(null);
  const ws = new WebSocket(`${base().replace(/^http/, "ws")}/api/calls/${encodeURIComponent(callId)}/live`);
  const send = (cmd: object) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd)); };
  io.attach({ instruction: (text) => send({ type: "instruction", text }), hangup: () => send({ type: "hangup" }) });

  // Lines are shown one after another (say animates word by word); the approval sheet runs beside them.
  let chain: Promise<void> = Promise.resolve();
  const queue = (fn: () => Promise<void>) => { chain = chain.then(fn).catch(() => {}); };
  const shown = new Map<string, string>(); // transcript id → text shown so far
  const them = new Map<string, { first: string; text: string; revised: boolean }>(); // callee lines
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
          // Agent: show when it starts speaking. Callee: the first final, held briefly in queue
          // order so the batch STT correction (same id, ~0.5–0.9 s later) can replace it; "" = noise.
          if (t.who === "callee" && t.final && them.has(t.id)) {
            const h = them.get(t.id)!;
            if (t.text.trim() !== h.first) { h.text = t.text.trim(); h.revised = true; }
            break;
          }
          if (!t.text.trim()) break;
          if (t.who === "agent") {
            // One id per agent turn: the first clause opens the bubble, later clauses extend it.
            const before = shown.get(t.id);
            if (before === undefined) { shown.set(t.id, t.text); queue(() => io.say("ai", t.text)); }
            else if (t.text.length > before.length && t.text.startsWith(before)) {
              const more = t.text.slice(before.length).trim();
              shown.set(t.id, t.text);
              if (more) queue(() => io.sayMore("ai", more));
            }
            break;
          }
          if (!t.final || shown.has(t.id)) break;
          shown.set(t.id, t.text);
          const h = { first: t.text.trim(), text: t.text.trim(), revised: false };
          them.set(t.id, h);
          const until = Date.now() + REVISION_WAIT_MS;
          queue(async () => {
            while (!h.revised && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
            if (h.text) await io.say("them", h.text);
          });
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
        case "facts": {
          const items = (e as { items: FactItem[] }).items;
          queue(async () => setFacts(items));
          break;
        }
        case "on_hold":
          io.hold?.((e as { since: number }).since);
          break;
        case "hold_over":
          io.hold?.(null);
          break;
        case "chips":
          io.chips?.((e as { items: string[] }).items);
          break;
        case "result":
          finished = true;
          setReceipt((e as { result: CallResult }).result.receipt);
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
          if (r && !r.inProgress) { setReceipt(r.receipt); return resolve(r); }
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

/** Feedback after a call or from Profile. In the recorded demo there is no server, so it just resolves. */
export async function sendFeedback(input: { rating?: "up" | "down"; comment?: string; source: "call" | "profile"; callId?: string }): Promise<void> {
  if (!realEnabled()) return;
  await http("POST", "/api/feedback", input);
}
