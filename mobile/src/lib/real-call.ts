import { AppState } from "react-native";
import type { Lang, Row } from "./i18n";
import { startKeepAlive, stopKeepAlive } from "./keep-alive";
import { SCENARIOS, type AskConfig, type CallIO, type Outcome, type Scenario, type ScenarioKey } from "./scenarios";

/* Real calls through the Spoken call server (server/ in this repo). Ported from
   web/src/lib/real-call.ts; the flow is the same: the server's plan fills the plan
   card through a runtime "real" scenario, and the live call drives the same CallIO
   the scripted demos use (say → transcript, ask → approval sheet).

   Phone differences: the server is a full URL (EXPO_PUBLIC_SPOKEN_API, default the
   team's server), and the switch, demo passcode and device id come from the store
   through configureRealCalls() instead of the URL, a browser prompt and localStorage. */

const API = (process.env.EXPO_PUBLIC_SPOKEN_API ?? "https://spoken-api.hellosverre.com").replace(/\/$/, "");

/** Ask the server's clarify questions in the chat before planning. Off on the web too, for now. */
const ASK_QUESTIONS = false;

/** Give up on a REST call after this long (phones drop between networks). */
const TIMEOUT_MS = 20_000;

export const REAL: ScenarioKey = "real" as ScenarioKey;

interface Settings {
  /** Use the server; off = the on-phone scripted demos. */
  enabled: boolean;
  /** Demo passcode for real calls. Empty = the server runs the call in mock mode (no phone rings). */
  passcode: string;
  /** The server said the passcode is wrong; Profile should clear it. */
  onWrongPasscode(): void;
  /** This phone's id for the server (profile, contacts, call history), sent as X-Spoken-Device. */
  deviceId: string;
}

let settings: Settings = { enabled: true, passcode: "", onWrongPasscode: () => {}, deviceId: "" };

/** A random v4 UUID for the device id (Hermes has no crypto.randomUUID). */
export function newDeviceId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** The store keeps these in step with Profile. */
export function configureRealCalls(next: Partial<Settings>) {
  settings = { ...settings, ...next };
}

export function realEnabled(): boolean {
  return !!API && settings.enabled;
}

export const serverUrl = () => API;

async function http<T>(method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(settings.deviceId ? { "X-Spoken-Device": settings.deviceId } : {}),
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch {
    throw new Error("Får ikke kontakt med Spoken-serveren.");
  } finally {
    clearTimeout(timer);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// Wire types from shared/contract.ts (kept local, as on the web).
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
  /** Appends words to the speaker's last line (one agent turn arrives clause by clause). */
  sayMore(who: "ai" | "them", text: string): Promise<void>;
  note(text: string): void;
  connected(): void;
  /** Where the store sends the user's mid-call messages, chips and hang-up. */
  attach(sink: { instruction(text: string): void; hangup(): void } | null): void;
}

// Batch STT second opinion lands ~0.5–0.9 s after a callee line; wait this long for it.
const REVISION_WAIT_MS = 1200;
const NEGATIVE = /^(nei|no|avslå|decline|legg på)$/i;

function pickOption(answer: string, options?: string[]): string {
  if (!options?.length) return answer;
  const a = answer.trim().toLowerCase();
  const n = Number(a);
  if (Number.isInteger(n) && n >= 1 && n <= options.length) return options[n - 1]!;
  return options.find((o) => o.toLowerCase() === a || o.toLowerCase().startsWith(a)) ?? answer;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const prettyPhone = (p: string) => p.replace(/^\+47(\d{2})(\d{2})(\d{2})(\d{2})$/, "+47 $1 $2 $3 $4");

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

/**
 * Chat step: task → server clarify questions (answered in the chat) → plan. Returns the
 * scenario key to show in the plan card, or null if the server blocked the task.
 * A preset's contact number wins; otherwise a number typed in the text, and without
 * either the server looks the number up.
 */
export async function planRealCall(
  text: string, lang: Lang, chat: ChatPort,
  opts: { profile?: { name: string; phone: string }; contact?: { name: string; phone: string } | null } = {},
): Promise<ScenarioKey | null> {
  if (opts.profile) await syncProfile(opts.profile, lang);
  const typed = text.match(/\+?\d[\d \-]{6,16}\d/)?.[0];
  const number = (opts.contact?.phone || typed || "").replace(/[ \-]/g, "");
  const c = await http<Clarify>("POST", "/api/tasks", { text, lang, ...(number ? { phone: number } : {}) });
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
  registerReal(plan, text, opts.contact?.name);
  return REAL;
}

function registerReal(plan: Plan, request: string, contactName?: string) {
  const name = contactName || plan.callee.name;
  const lines = {
    contact: name || prettyPhone(plan.callee.phone),
    request,
    goal: plan.goal.charAt(0).toUpperCase() + plan.goal.slice(1),
    checks: plan.needsApprovalFor.slice(0, 3),
    opening: plan.opening,
  };
  const sc: Scenario & { live: true } = {
    live: true,
    init: initials(name),
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
  const code = settings.passcode.trim();
  const { callId, mode, passcode: pc } = await http<{ callId: string; mode?: string; passcode?: string }>(
    "POST", `/api/tasks/${encodeURIComponent(taskId)}/call`, { approved: true }, code ? { "X-Spoken-Passcode": code } : {},
  );
  if (pc === "wrong") {
    settings.onWrongPasscode();
    io.note(lang === "no" ? "Feil demo-kode, så dette er en øvingssamtale: ingen telefon ringer, og svarene er skriptet." : "Wrong demo code, so this is a practice call: no phone is ringing and the replies are scripted.");
  } else if (mode === "mock") {
    io.note(lang === "no" ? "Øvingssamtale: ingen telefon ringer, og svarene er skriptet. Legg inn demo-koden under Profil for ekte samtaler." : "Practice call: no phone is ringing and the replies are scripted. Add the demo code in Profile for real calls.");
  }
  const url = `${API.replace(/^http/, "ws")}/api/calls/${encodeURIComponent(callId)}/live`;
  let reconnectOnFocus: { remove(): void } | undefined;
  // Keep the app awake while you're in another app, so the socket stays up and approvals notify.
  void startKeepAlive({ title: "Spoken", artist: lang === "no" ? "Samtale pågår" : "Call in progress" });

  // The call runs on the server whatever happens to this socket, and the server replays every
  // event to a new socket. So a dropped socket (iOS suspends backgrounded apps) is reconnected,
  // and the replay is de-duplicated below: shown lines, notes and approvals aren't repeated.
  let ws: WebSocket | null = null;
  let finished = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retries = 0;
  let downSince = 0;
  // Anything sent while the socket is down (a quick hang-up, a message) goes out when it's back.
  const outbox: string[] = [];
  const send = (cmd: object) => {
    const raw = JSON.stringify(cmd);
    if (ws?.readyState === WebSocket.OPEN) ws.send(raw);
    else outbox.push(raw);
  };
  io.attach({ instruction: (text) => send({ type: "instruction", text }), hangup: () => send({ type: "hangup" }) });

  // Lines are shown one after another (say animates word by word); the approval sheet runs beside them.
  let chain: Promise<void> = Promise.resolve();
  const queue = (fn: () => Promise<void>) => { chain = chain.then(fn).catch(() => {}); };
  const shown = new Map<string, string>(); // transcript id → text shown so far
  const them = new Map<string, { first: string; text: string; revised: boolean }>(); // callee lines
  const asked = new Set<string>(); // approval ids already shown
  const noted = new Set<string>(); // notes already shown (at + text)
  let connected = false;

  const result = await new Promise<CallResult>((resolve, reject) => {
    const done = (r: CallResult) => {
      if (finished) return;
      finished = true;
      resolve(r);
    };
    const onMessage = (m: { data: unknown }) => {
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
          if (asked.has(a.id)) break; // replayed after a reconnect
          asked.add(a.id);
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
        case "note": {
          // In line with the transcript, or a refusal shows up before what it refused.
          const n = e as { text: string; at?: number };
          const key = `${n.at ?? ""}|${n.text}`;
          if (noted.has(key)) break;
          noted.add(key);
          queue(async () => io.note(n.text));
          break;
        }
        case "result":
          done((e as { result: CallResult }).result);
          break;
      }
    };

    // The server no longer knows the call (it restarted): ask for the result instead.
    const fetchResult = async () => {
      for (let i = 0; i < 30 && !finished; i++) {
        const r = await http<CallResult & { inProgress?: boolean }>("GET", `/api/calls/${encodeURIComponent(callId)}`).catch(() => null);
        if (r && !r.inProgress) return done(r);
        await new Promise((ok) => setTimeout(ok, 2000));
      }
      if (!finished) reject(new Error("Fikk ikke resultatet fra samtalen."));
    };

    const connect = () => {
      clearTimeout(retryTimer);
      if (finished || ws) return;
      const sock = new WebSocket(url);
      ws = sock;
      sock.onopen = () => {
        retries = 0;
        downSince = 0;
        while (outbox.length && sock.readyState === WebSocket.OPEN) sock.send(outbox.shift()!);
      };
      sock.onmessage = onMessage;
      sock.onerror = () => {};
      sock.onclose = (ev) => {
        if (ws === sock) ws = null;
        if (finished) return;
        if (ev.code === 1008) return void fetchResult(); // unknown call
        downSince ||= Date.now();
        // Calls last at most 10 min; after 12 min of trying, settle it over REST.
        if (Date.now() - downSince > 12 * 60_000) return void fetchResult();
        retryTimer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** retries++));
      };
    };
    connect();
    // Coming back to the app: reconnect at once instead of waiting for the backoff.
    reconnectOnFocus = AppState.addEventListener("change", (state) => {
      if (state === "active" && !finished && !ws) connect();
    });
  }).finally(() => {
    finished = true;
    clearTimeout(retryTimer);
    reconnectOnFocus?.remove();
    stopKeepAlive();
  });

  await chain;
  io.attach(null);
  // ws is reassigned inside the callbacks, which TypeScript's narrowing can't see.
  try { (ws as WebSocket | null)?.close(); } catch {}
  const rows = Object.entries(result.details ?? {}).map(([k, v]) => [k.charAt(0).toUpperCase() + k.slice(1), v] as Row);
  return { ok: result.outcome === "done", title: result.summary, rows };
}

/** Feedback after a call or from Profile. Without real calls switched on there is no server to send to. */
export async function sendFeedback(input: { rating?: "up" | "down"; comment?: string; source: "call" | "profile"; callId?: string }): Promise<void> {
  if (!realEnabled()) return;
  await http("POST", "/api/feedback", input);
}
