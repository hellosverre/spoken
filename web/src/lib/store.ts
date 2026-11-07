import type { CallResult, Clarify, LiveEvent, Plan } from "@shared/contract";
import { COPY, fill, type Copy, type Lang, type Row } from "./i18n";
import { SCENARIOS, detect, type AskConfig, type Outcome, type ScenarioKey, type Who } from "./scenarios";
<<<<<<< Updated upstream
import { isLive, planRealCall, realEnabled, type LiveIO } from "./real-call";
||||||| Stash base
=======
import { api, findPhone, openLive, serverUrl, type LiveSocket } from "./server";
>>>>>>> Stashed changes

export type Screen = "intro" | "home" | "call";
export type Tab = "chat" | "demo" | "settings";
export type Pill = "ringing" | "live" | "hold" | "ended";
export type Chip = "repeat" | "thanks";

/** Who the call goes to, as shown on the plan card and the call screen. */
export interface Callee {
  name: string;
  number: string;
  init: string;
}

/** A plan from the call server. */
export interface LivePlan {
  taskId: string;
  callee: Callee;
  goal: string;
  checks: string[];
  share: string[];
  opening: string;
}

export type ThreadItem =
  | { id: number; kind: "me" | "bot"; text: string }
  | { id: number; kind: "dots" }
  | { id: number; kind: "q"; text: string; options: string[]; answered: boolean }
  | { id: number; kind: "plan"; scenario: ScenarioKey; live?: LivePlan; request: string; pressed: boolean };

export type Line =
  | { id: number; kind: Who; words: string[]; unsure?: boolean[] }
  | { id: number; kind: "you"; text: string }
  | { id: number; kind: "sys"; text: string };

export type Sheet =
  | { kind: "ask"; cfg: AskConfig; pressed: string | null }
  | { kind: "result"; ok: boolean; title: string; rows: Row[] };

export interface IntroState {
  drop: boolean;
  morph: boolean;
  /** Reduced motion: show the bubble without the drop animation. */
  still: boolean;
  width: number | null;
  typed: string;
  caret: boolean;
  pops: boolean;
  word: boolean;
}

export interface State {
  lang: Lang;
  screen: Screen;
  tab: Tab;
  intro: IntroState;
  threaded: boolean;
  thread: ThreadItem[];
  draft: string;
  /** Bumped when the chat input should take focus. */
  focusTick: number;
  scenario: ScenarioKey;
  /** Set for server calls; scripted calls take the callee from the scenario. */
  callee: Callee | null;
  /** The call server in use, or null for scripted practice calls. */
  server: string | null;
  /** Spoken asked a question in the chat and waits for the answer. */
  asking: boolean;
  pill: Pill;
  speaker: Who | null;
  speakerNote: "ringing" | "listening" | "ended";
  transcript: Line[];
  elapsed: string;
  callEnded: boolean;
  sheet: Sheet | null;
  sheetOpen: boolean;
  /** Bumped to flash the device frame when Spoken needs you. */
  flashTick: number;
}

type Pending = { type: "repeat" } | { type: "thanks" } | { type: "text"; text: string };

const INTRO_RESET: IntroState = {
  drop: false, morph: false, still: false, width: null, typed: "", caret: false, pops: false, word: false,
};

const INITIAL: State = {
  lang: "en",
  screen: "intro",
  tab: "chat",
  intro: INTRO_RESET,
  threaded: false,
  thread: [],
  draft: "",
  focusTick: 0,
  scenario: "pizza",
  callee: null,
  server: null,
  asking: false,
  pill: "ringing",
  speaker: null,
  speakerNote: "listening",
  transcript: [],
  elapsed: "0:00",
  callEnded: false,
  sheet: null,
  sheetOpen: false,
  flashTick: 0,
};

const HANG = Symbol("hang");
const ABORT = Symbol("abort");
const LANG_KEY = "spoken-lang";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Wait two frames so a reset class is painted before the next one is added. */
const nextPaint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
/** Drop the server's internal hints, like «⟨tid: 18:00⟩». */
const clean = (s: string) => s.replace(/\s*⟨[^⟩]*⟩/g, "").trim();
const initials = (name: string) =>
  name.split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, "")[0] ?? "").join("").slice(0, 2).toUpperCase() || "?";
/** +4722000001 → +47 22 00 00 01 */
const prettyPhone = (n: string) => {
  const m = n.match(/^\+47(\d{2})(\d{2})(\d{2})(\d{2})$/);
  return m ? `+47 ${m.slice(1).join(" ")}` : n;
};

/**
 * All app state plus the scripted flows (intro, chat, call).
 * Every flow takes a run id and stops when a newer flow replaces it.
 */
export class SpokenStore {
  private state: State = INITIAL;
  private listeners = new Set<() => void>();
  private uid = 1;

  private demo = false;
  private introId = 0;
  private homeId = 0;
  private callId = 0;
  private hangup = false;
  private pending: Pending[] = [];
  private flushing = false;
  private lastThem = "";
  private askResolve: ((v: string) => void) | null = null;
  /** Real calls: the chat is waiting for an answer to a server question. */
  private chatAnswer: ((text: string) => void) | null = null;
  /** Real calls: where mid-call messages and hang-up go. */
  private realSink: { instruction(text: string): void; hangup(): void } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;

  /* Chat with the call server */
  private api: string | null = null;
  private answerResolve: ((v: string) => void) | null = null;
  private plan: LivePlan | null = null;

  /* Live call through the call server */
  private live: LiveSocket | null = null;
  private liveCall: string | null = null;
  private liveMode = false;
  private connected = false;
  private ended = false;
  private resultShown = false;
  private approval: { id: string; choices: Record<string, string>; decline: string } | null = null;
  private seen = new Set<string>();
  private lineIds = new Map<string, number>();
  /** Agent lines still being revealed word by word, with a way to show them whole. */
  private reveals = new Map<number, { timer: ReturnType<typeof setInterval>; finish: () => void }>();
  private quiet: ReturnType<typeof setTimeout> | undefined;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  getServerSnapshot = () => INITIAL;

  private set(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const p = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }
  private get t(): Copy {
    return COPY[this.state.lang];
  }
  private get reduce() {
    return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  private async typeInto(write: (s: string) => void, text: string, speed: number, stop: () => boolean) {
    let acc = "";
    for (const ch of text) {
      if (stop()) return;
      acc += ch;
      write(acc);
      await sleep(this.reduce ? 0 : speed + (ch === " " ? 18 : 0) + (/[.,!?]/.test(ch) ? 150 : 0));
    }
  }

  /* ---------- lifecycle ---------- */

  start() {
    let lang: Lang = this.state.lang;
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === "en" || saved === "no") lang = saved;
    } catch {}
    this.setLang(lang);
    this.api = serverUrl();
    this.set({ server: this.api });
    this.intro();
  }

  stop() {
    this.introId++;
    this.homeId++;
    this.callId++;
    this.stopTimer();
    this.closeLive();
  }

  setLang(lang: Lang) {
    this.set({ lang });
    document.documentElement.lang = lang === "no" ? "nb" : "en";
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {}
  }

  toggleLang() {
    this.setLang(this.state.lang === "en" ? "no" : "en");
  }

  /* ---------- intro ---------- */

  private patchIntro(p: Partial<IntroState>) {
    this.set((s) => ({ intro: { ...s.intro, ...p } }));
  }

  private measureLine() {
    const m = document.createElement("span");
    m.style.cssText =
      "position:absolute;visibility:hidden;white-space:nowrap;font:500 22px var(--display);letter-spacing:-.015em";
    m.textContent = this.t.introLine;
    document.body.appendChild(m);
    const w = m.getBoundingClientRect().width;
    m.remove();
    return Math.min(w + 48, Math.min(window.innerWidth, 400) - 40);
  }

  async intro() {
    const id = ++this.introId;
    const stop = () => id !== this.introId;
    this.set({ screen: "intro", intro: INTRO_RESET });
    await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), sleep(1200)]);
    await nextPaint();
    if (stop()) return;
    const width = this.measureLine();
    const line = this.t.introLine;

    if (this.reduce) {
      this.patchIntro({ width, morph: true, still: true, typed: line, pops: true, word: true });
      await sleep(1400);
      if (!stop()) this.goHome();
      return;
    }

    this.patchIntro({ width, drop: true });
    await sleep(900);
    if (stop()) return;
    this.patchIntro({ morph: true });
    await sleep(380);
    if (stop()) return;
    this.patchIntro({ caret: true });
    await this.typeInto((typed) => this.patchIntro({ typed }), line, 34, stop);
    if (stop()) return;
    this.patchIntro({ pops: true });
    await sleep(500);
    if (stop()) return;
    this.patchIntro({ caret: false, word: true });
    await sleep(1500);
    if (!stop()) this.goHome();
  }

  skipIntro() {
    this.introId++;
    this.goHome();
  }

  replay() {
    this.demo = false;
    this.callId++;
    this.homeId++;
    this.stopTimer();
    this.closeLive();
    this.answerResolve = null;
    this.set({ sheetOpen: false });
    this.intro();
  }

  /* ---------- home ---------- */

  goHome() {
    this.chatAnswer = null;
    this.introId++;
    this.homeId++;
    this.callId++;
    this.askResolve = null;
    this.answerResolve = null;
    this.plan = null;
    this.stopTimer();
    this.closeLive();
    this.set({ sheetOpen: false, threaded: false, thread: [], tab: "chat", screen: "home", asking: false });
  }

  newChat() {
    this.demo = false;
    this.goHome();
    this.set((s) => ({ focusTick: s.focusTick + 1 }));
  }

  setTab(tab: Tab) {
    this.set({ tab });
  }

  setDraft(draft: string) {
    this.set({ draft });
  }

  submitDraft() {
    this.demo = false;
<<<<<<< Updated upstream
    if (this.chatAnswer) {
      const text = this.state.draft.trim();
      if (!text) return;
      const answer = this.chatAnswer;
      this.chatAnswer = null;
      this.set({ draft: "" });
      this.pushThread({ id: this.uid++, kind: "me", text });
      answer(text);
      return;
    }
||||||| Stash base
=======
    if (this.answerResolve) return this.answer(this.state.draft);
>>>>>>> Stashed changes
    this.sendRequest(this.state.draft);
  }

  /** Answer the question Spoken asked in the chat. */
  answer(raw: string) {
    const text = raw.trim();
    if (!text || !this.answerResolve) return;
    this.set({ draft: "" });
    this.answerResolve(text);
  }

  preset(key: ScenarioKey) {
    this.demo = false;
    this.sendRequest(SCENARIOS[key][this.state.lang].request, true);
  }

  /** Real call: the server asks its clarify questions in the chat, then its plan fills the card. */
  private async sendRealRequest(text: string) {
    const id = ++this.homeId;
    const stop = () => id !== this.homeId;
    this.chatAnswer = null;
    this.set({ threaded: true, thread: [{ id: this.uid++, kind: "me", text }], draft: "" });
    const dots = this.uid++;
    this.pushThread({ id: dots, kind: "dots" });
    const dropDots = () => this.set((s) => ({ thread: s.thread.filter((i) => i.id !== dots) }));
    const bot = async (line: string) => {
      if (stop()) return;
      dropDots();
      const b = this.uid++;
      this.pushThread({ id: b, kind: "bot", text: "" });
      await this.typeInto((t) => this.patchThread(b, { text: t }), line, 10, stop);
    };
    try {
      const key = await planRealCall(text, this.state.lang, {
        bot,
        askUser: async (q) => {
          await bot(q);
          this.set((s) => ({ focusTick: s.focusTick + 1 }));
          return new Promise<string>((resolve) => { this.chatAnswer = resolve; });
        },
      });
      if (stop()) return;
      dropDots();
      if (!key) return;
      await bot(this.t.planIntro);
      if (stop()) return;
      this.set({ scenario: key });
      this.pushThread({ id: this.uid++, kind: "plan", scenario: key, request: text, pressed: false });
    } catch (e) {
      if (!stop()) await bot(e instanceof Error ? e.message : String(e));
    }
  }

  editPlan(text: string) {
    this.homeId++;
    this.answerResolve = null;
    this.plan = null;
    this.set((s) => ({ threaded: false, thread: [], draft: text, asking: false, focusTick: s.focusTick + 1 }));
  }

  private pushThread(item: ThreadItem) {
    this.set((s) => ({ thread: [...s.thread, item] }));
  }

  private patchThread(id: number, patch: Partial<Omit<ThreadItem, "id" | "kind">>) {
    this.set((s) => ({
      thread: s.thread.map((i) => (i.id === id ? ({ ...i, ...patch } as ThreadItem) : i)),
    }));
  }

<<<<<<< Updated upstream
||||||| Stash base
  async sendRequest(raw: string) {
=======
  private dots() {
    const id = this.uid++;
    this.pushThread({ id, kind: "dots" });
    return () => this.set((s) => ({ thread: s.thread.filter((i) => i.id !== id) }));
  }

  private async botSay(text: string, stop: () => boolean) {
    const bot = this.uid++;
    this.pushThread({ id: bot, kind: "bot", text: "" });
    await this.typeInto((t) => this.patchThread(bot, { text: t }), text, 14, stop);
  }

  /** Scripted practice calls skip the server; the demo key always uses them. */
>>>>>>> Stashed changes
  async sendRequest(raw: string, scripted = false) {
    const text = raw.trim();
    if (!text) return;
    if (!scripted && !this.demo && realEnabled()) return this.sendRealRequest(text);
    const id = ++this.homeId;
    const stop = () => id !== this.homeId;
    this.plan = null;
    this.answerResolve = null;

    this.set({ scenario: detect(text), threaded: true, thread: [{ id: this.uid++, kind: "me", text }], draft: "", asking: false });
    await sleep(350);
    if (stop()) return;
    if (this.api && !scripted) return this.chatWithServer(this.api, text, stop);
    await this.scriptedPlan(text, stop);
  }

  private async chatWithServer(base: string, text: string, stop: () => boolean) {
    const t = this.t;
    let undots = this.dots();
    let clarify: Clarify;
    try {
      clarify = await api.createTask(base, { text, lang: this.state.lang, phone: findPhone(text) });
    } catch (e) {
      console.warn("[spoken] call server unreachable, using a practice call", e);
      if (stop()) return;
      undots();
      await this.botSay(t.offline, stop);
      if (stop()) return;
      await sleep(300);
      return this.scriptedPlan(text, stop);
    }
    if (stop()) return;
    undots();
    if (clarify.summary) await this.botSay(clarify.summary, stop);

    const answers: Record<string, string> = {};
    for (const q of clarify.questions) {
      if (stop()) return;
      await sleep(250);
      const qid = this.uid++;
      this.pushThread({ id: qid, kind: "q", text: "", options: [], answered: false });
      await this.typeInto((x) => this.patchThread(qid, { text: x }), q.text, 12, stop);
      if (stop()) return;
      // Quick answers only show once Spoken is ready to take them.
      const a = new Promise<string>((resolve) => (this.answerResolve = resolve));
      this.patchThread(qid, { options: q.options ?? [] });
      this.set((s) => ({ asking: true, focusTick: q.options?.length ? s.focusTick : s.focusTick + 1 }));
      const answer = await a;
      this.answerResolve = null;
      if (stop()) return;
      this.patchThread(qid, { answered: true });
      this.set({ asking: false });
      this.pushThread({ id: this.uid++, kind: "me", text: answer });
      answers[q.id] = answer;
    }

    await sleep(250);
    if (stop()) return;
    undots = this.dots();
    let plan: Plan;
    try {
      plan = await api.answer(base, clarify.taskId, answers);
    } catch (e) {
      if (stop()) return;
      undots();
      return this.botSay(`${t.callErr}: ${(e as Error).message}`, stop);
    }
    if (stop()) return;
    undots();
    if (plan.blocked) {
      return this.botSay([t.blocked, plan.blocked.reason, plan.blocked.alternative].filter(Boolean).join(" "), stop);
    }
    await this.botSay(t.planIntro, stop);
    if (stop()) return;
    await sleep(180);
    if (stop()) return;
    this.plan = {
      taskId: plan.taskId,
      callee: { name: plan.callee.name, number: prettyPhone(plan.callee.phone), init: initials(plan.callee.name) },
      goal: cap(clean(plan.goal)),
      checks: plan.needsApprovalFor.map((x) => cap(clean(x))),
      share: plan.willShare.map((x) => t.share[x] ?? x),
      opening: plan.opening,
    };
    this.pushThread({ id: this.uid++, kind: "plan", scenario: this.state.scenario, live: this.plan, request: text, pressed: false });
  }

  private async scriptedPlan(text: string, stop: () => boolean) {
    const scenario = this.state.scenario;
    const undots = this.dots();
    await sleep(800);
    if (stop()) return;
    undots();
    await this.botSay(this.t.planIntro, stop);
    if (stop()) return;
    await sleep(180);
    if (stop()) return;

    const plan = this.uid++;
    this.pushThread({ id: plan, kind: "plan", scenario, request: text, pressed: false });

    if (this.demo) {
      await sleep(2000);
      if (stop()) return;
      this.patchThread(plan, { pressed: true });
      await sleep(220);
      if (stop()) return;
      this.startCall();
    }
  }

  async playDemo(which: ScenarioKey = "pizza") {
    this.goHome();
    this.demo = true;
    const id = this.homeId;
    const stop = () => id !== this.homeId;
    await sleep(600);
    if (stop()) return;
    this.set({ draft: "" });
    await this.typeInto((draft) => this.set({ draft }), SCENARIOS[which][this.state.lang].request, 22, stop);
    if (stop()) return;
    await sleep(350);
    if (stop()) return;
    this.sendRequest(this.state.draft, true);
  }

  /* ---------- call ---------- */

  private sys(text: string) {
    this.set((s) => ({ transcript: [...s.transcript, { id: this.uid++, kind: "sys", text }] }));
  }

  private startTimer(t0 = Date.now()) {
    this.stopTimer();
    this.timer = setInterval(() => this.set({ elapsed: fmt(Date.now() - t0) }), 500);
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async startCall() {
    if (this.plan && this.api) return this.startLive(this.api, this.plan);
    const id = ++this.callId;
    this.homeId++;
    this.liveMode = false;
    const lang = this.state.lang;
    const sc = SCENARIOS[this.state.scenario];
    const L = sc[lang];
    this.hangup = false;
    this.pending = [];
    this.flushing = false;
    this.lastThem = "";
    this.askResolve = null;
    this.stopTimer();

    this.set({
      transcript: [], sheetOpen: false, elapsed: "0:00", callEnded: false, callee: null,
      pill: "ringing", speaker: null, speakerNote: "ringing", screen: "call",
    });
    this.sys(`${this.t.calling} ${L.contact} · ${sc.number}`);
    const live = isLive(this.state.scenario);
    const connected = () => {
      this.set({ pill: "live", speakerNote: "listening" });
      this.startTimer();
      this.sys(this.t.connected);
    };
    if (!live) {
      await sleep(2300);
      if (id !== this.callId) return;
      if (this.hangup) return this.finish(id, { hung: true });
      connected();
    }

    const guard = () => {
      if (id !== this.callId) throw ABORT;
    };

    const say = async (who: Who, text: string, force = false): Promise<void> => {
      guard();
      if (this.hangup && !force) throw HANG;
      // Pass on anything you sent before Spoken's next line.
      if (who === "ai" && !force && this.pending.length && !this.flushing) {
        this.flushing = true;
        try {
          while (this.pending.length) {
            const p = this.pending.shift()!;
            const t = this.t;
            if (p.type === "repeat") {
              await say("ai", t.repeatAsk);
              await say("them", `${t.repeatReply} ${this.lastThem}`);
            } else if (p.type === "thanks") {
              await say("ai", t.thanksAsk);
              await say("them", t.thanksReply);
            } else {
              await say("ai", `${t.relayPrefix} ${p.text}`);
              await say("them", t.relayReply);
            }
          }
        } finally {
          this.flushing = false;
        }
      }
      if (who === "them") this.lastThem = text;
      await sleep(who === "them" ? 500 : 350);
      guard();

      const lineId = this.uid++;
      this.set((s) => ({ transcript: [...s.transcript, { id: lineId, kind: who, words: [] }], speaker: who }));
      const words = text.split(" ");
      for (let i = 0; i < words.length; i++) {
        guard();
        const shown = words.slice(0, i + 1);
        this.set((s) => ({
          transcript: s.transcript.map((l) => (l.id === lineId ? { id: lineId, kind: who, words: shown } : l)),
        }));
        await sleep((who === "them" ? 105 : 90) + (/[.,!?]$/.test(words[i]) ? 140 : 0));
      }
      this.set({ speaker: null, speakerNote: "listening" });
    };

    const ask = (cfg: AskConfig): Promise<string> => {
      guard();
      return new Promise<string>((resolve) => {
        this.set((s) => ({
          pill: "hold", flashTick: s.flashTick + 1, sheet: { kind: "ask", cfg, pressed: null }, sheetOpen: true,
        }));
        try {
          navigator.vibrate?.([120, 80, 120]);
        } catch {}
        const done = (v: string) => {
          this.askResolve = null;
          this.set({ sheetOpen: false, pill: "live" });
          resolve(v);
        };
        this.askResolve = done;
        if (this.demo) {
          setTimeout(() => {
            if (this.askResolve !== done) return;
            const v = cfg.options[0].v;
            this.set((s) => ({ sheet: s.sheet?.kind === "ask" ? { ...s.sheet, pressed: v } : s.sheet }));
            setTimeout(() => this.askResolve === done && done(v), 260);
          }, 3000);
        }
      }).then((v) => {
        if (v === "hang") throw HANG;
        return v;
      });
    };

    let outcome: Outcome;
    try {
      const io: LiveIO = {
        say,
        ask,
        note: (text) => id === this.callId && this.sys(text),
        connected: () => id === this.callId && connected(),
        attach: (sink) => { this.realSink = sink; },
      };
      outcome = await sc.run(lang, io);
    } catch (e) {
      this.realSink = null;
      if (e === ABORT) return;
      if (live && e !== HANG) {
        // Server or network problem on a real call: say so, don't fake a line.
        this.sys(e instanceof Error ? e.message : String(e));
        return this.finish(id, { ok: false, title: e instanceof Error ? e.message : "Samtalen feilet", rows: [] });
      }
      if (e !== HANG) throw e;
      try {
        await say("ai", this.t.hang, true);
      } catch {
        return;
      }
      outcome = { hung: true };
    }
    this.finish(id, outcome);
  }

  private async finish(id: number, o: Outcome) {
    if (id !== this.callId) return;
    this.stopTimer();
    const dur = this.state.elapsed;
    this.set({ pill: "ended", speaker: null, speakerNote: "ended", callEnded: true });
    this.sys(`${this.t.ended} · ${dur}`);
    await sleep(700);
    if (id !== this.callId) return;
    const t = this.t;
    const sheet: Sheet =
      o.hung === true
        ? { kind: "result", ok: false, title: t.hungTitle, rows: [...t.hungRows, [t.dur, dur]] }
        : { kind: "result", ok: o.ok, title: o.title, rows: [...o.rows, [t.dur, dur]] };
    this.set({ sheet, sheetOpen: true });
    this.demo = false;
  }

  choose(v: string) {
    if (this.liveMode) return this.answerApproval(v);
    this.askResolve?.(v);
  }

  closeSheet() {
    this.set({ sheetOpen: false });
  }

  endCall() {
    if (this.realSink) {
      // The server says goodbye and hangs up; its result ends the call screen.
      this.realSink.hangup();
      this.demo = false;
      this.askResolve?.("hang");
      return;
    }
    this.hangup = true;
    this.demo = false;
    if (this.liveMode) return this.hangupLive();
    this.askResolve?.("hang");
  }

  private noteYou(text: string) {
    this.set((s) => ({ transcript: [...s.transcript, { id: this.uid++, kind: "you", text }] }));
    // The server confirms instructions itself with a note.
    if (!this.liveMode) this.sys(this.t.noted);
  }

  sendInstruction(raw: string) {
    const text = raw.trim();
    if (!text) return;
    this.noteYou(text);
<<<<<<< Updated upstream
    if (this.realSink) return this.realSink.instruction(text);
||||||| Stash base
=======
    if (this.liveMode) return this.live?.send({ type: "instruction", text });
>>>>>>> Stashed changes
    this.pending.push({ type: "text", text });
  }

  chip(type: Chip) {
    this.noteYou(type === "repeat" ? this.t.chipRepeat : this.t.chipThanks);
<<<<<<< Updated upstream
    if (this.realSink) {
      return this.realSink.instruction(type === "repeat" ? "Be dem gjenta det de sa." : "Takk dem.");
||||||| Stash base
=======
    if (this.liveMode) {
      // The call itself is in Norwegian, so the instruction to the AI is too.
      const text = type === "repeat" ? "Be dem gjenta det de sa." : "Si tusen takk for hjelpen.";
      return this.live?.send({ type: "instruction", text });
>>>>>>> Stashed changes
    }
    this.pending.push({ type });
  }

  /* ---------- live call through the call server ---------- */

  private async startLive(base: string, plan: LivePlan) {
    const id = ++this.callId;
    this.homeId++;
    this.closeLive();
    this.liveMode = true;
    this.hangup = false;
    this.connected = false;
    this.ended = false;
    this.resultShown = false;
    this.approval = null;
    this.liveCall = null;
    this.seen.clear();
    this.lineIds.clear();
    this.set({
      transcript: [], sheetOpen: false, elapsed: "0:00", callEnded: false, callee: plan.callee,
      pill: "ringing", speaker: null, speakerNote: "ringing", screen: "call",
    });
    this.sys(`${this.t.calling} ${plan.callee.name} · ${plan.callee.number}`);

    let callId: string;
    try {
      ({ callId } = await api.startCall(base, plan.taskId));
    } catch (e) {
      return this.failLive(id, this.t.callErr, (e as Error).message);
    }
    if (id !== this.callId) {
      api.hangup(base, callId).catch(() => {});
      return;
    }
    this.liveCall = callId;
    this.live = openLive(base, callId, (e) => this.onLive(id, e), () => this.lostLive(id));
    if (this.hangup) this.hangupLive();
  }

  private onLive(id: number, e: LiveEvent) {
    if (id !== this.callId) return;
    switch (e.type) {
      case "status":
        if (e.status === "connected" && !this.connected) {
          this.connected = true;
          this.set({ pill: "live", speakerNote: "listening" });
          this.startTimer(e.at);
          this.sys(this.t.connected);
        } else if (e.status === "on_hold") {
          this.set({ pill: "hold" });
        } else if (e.status === "ended" || e.status === "failed") {
          this.markEnded();
          // The result normally follows right away; ask for it if it doesn't.
          setTimeout(() => this.fetchResult(id), 4000);
        }
        return;
      case "transcript":
        return this.onTranscript(e);
      case "level":
        if (e.rms > 0.08) this.talking(e.who === "callee" ? "them" : "ai");
        return;
      case "approval_request":
        return this.onApproval(e);
      case "note": {
        const key = `n${e.at}${e.text}`;
        if (this.seen.has(key)) return;
        this.seen.add(key);
        return this.sys(e.text);
      }
      case "result":
        return this.showResult(id, e.result);
    }
  }

  /** Show who is talking, and go back to "listening" after a short quiet spell. */
  private talking(who: Who) {
    if (this.ended) return;
    if (this.state.speaker !== who) this.set({ speaker: who });
    clearTimeout(this.quiet);
    this.quiet = setTimeout(() => this.set({ speaker: null }), 900);
  }

  private onTranscript(e: Extract<LiveEvent, { type: "transcript" }>) {
    const kind: Who = e.who === "callee" ? "them" : "ai";
    const words = e.words?.length ? e.words.map((w) => w.text) : clean(e.text).split(/\s+/).filter(Boolean);
    const unsure = e.words?.length ? e.words.map((w) => w.confidence < 0.6) : undefined;
    let lineId = this.lineIds.get(e.id);
    const isNew = lineId === undefined;
    if (lineId === undefined) {
      lineId = this.uid++;
      this.lineIds.set(e.id, lineId);
    }
    const id = lineId;
    const put = (shown: string[]) =>
      this.set((s) => ({
        transcript: isNew && !s.transcript.some((l) => l.id === id)
          ? [...s.transcript, { id, kind, words: shown, unsure }]
          : s.transcript.map((l) => (l.id === id ? { id, kind, words: shown, unsure } : l)),
      }));

    this.stopReveal(id);
    this.talking(kind);
    // The agent's lines arrive whole; reveal them word by word like speech.
    if (kind === "ai" && isNew && !this.reduce && words.length > 1) {
      let n = 1;
      put(words.slice(0, 1));
      const timer = setInterval(() => {
        n++;
        put(words.slice(0, n));
        this.talking("ai");
        if (n >= words.length) this.stopReveal(id);
      }, 95);
      this.reveals.set(id, { timer, finish: () => put(words) });
    } else put(words);

    // Fill in what Spoken told them while the approval sheet is up.
    const sh = this.state.sheet;
    if (kind === "ai" && e.final && this.approval && sh?.kind === "ask" && !sh.cfg.hold) {
      this.set({ sheet: { ...sh, cfg: { ...sh.cfg, hold: clean(e.text) } } });
    }
  }

  private onApproval(e: Extract<LiveEvent, { type: "approval_request" }>) {
    if (this.seen.has(e.id) || this.ended) return;
    this.seen.add(e.id);
    const t = this.t;
    const opts = e.options.length ? e.options : ["JA", "NEI"];
    const no = opts.findIndex((o) => /^(nei|no)$/i.test(o.trim()));
    const di = no >= 0 ? no : opts.length > 1 ? opts.length - 1 : -1;
    const pos = opts.filter((_, i) => i !== di);
    const label = (o: string) => (/^(ja|yes)$/i.test(o.trim()) ? t.approve : /^(nei|no)$/i.test(o.trim()) ? t.decline : cap(o));
    this.approval = {
      id: e.id,
      choices: Object.fromEntries(pos.map((o, i) => [`o${i}`, o])),
      decline: di >= 0 ? opts[di] : "NEI",
    };
    const cfg: AskConfig = {
      title: clean(e.question),
      rows: [],
      hold: "",
      options: pos.map((o, i) => ({ v: `o${i}`, label: label(o) })),
      decline: di >= 0 ? label(opts[di]) : t.decline,
    };
    this.set((s) => ({ pill: "hold", flashTick: s.flashTick + 1, sheet: { kind: "ask", cfg, pressed: null }, sheetOpen: true }));
    try {
      navigator.vibrate?.([120, 80, 120]);
    } catch {}
  }

  private answerApproval(v: string) {
    const a = this.approval;
    if (!a) return;
    this.approval = null;
    const choice = v === "no" ? a.decline : a.choices[v];
    this.live?.send({ type: "approval_response", id: a.id, choice });
    this.set({ sheetOpen: false, pill: this.ended ? "ended" : "live" });
  }

  private hangupLive() {
    this.approval = null;
    this.set({ sheetOpen: false });
    if (!this.liveCall || this.ended) return;
    this.live?.send({ type: "hangup" });
    if (this.api) api.hangup(this.api, this.liveCall).catch(() => {});
  }

  private stopReveal(id: number) {
    const r = this.reveals.get(id);
    if (!r) return;
    clearInterval(r.timer);
    this.reveals.delete(id);
  }

  /** Show any half-revealed agent lines in full. */
  private flushReveals() {
    this.reveals.forEach((r) => {
      clearInterval(r.timer);
      r.finish();
    });
    this.reveals.clear();
  }

  private markEnded() {
    if (this.ended) return;
    this.ended = true;
    this.flushReveals();
    this.approval = null;
    this.stopTimer();
    clearTimeout(this.quiet);
    this.set({ pill: "ended", speaker: null, speakerNote: "ended", callEnded: true, sheetOpen: false });
    this.sys(`${this.t.ended} · ${this.state.elapsed}`);
  }

  private async fetchResult(id: number) {
    if (id !== this.callId || this.resultShown || !this.api || !this.liveCall) return;
    try {
      const r = await api.result(this.api, this.liveCall);
      if (r) return this.showResult(id, r);
    } catch {}
    this.failLive(id, this.t.callLost, "–");
  }

  private lostLive(id: number) {
    if (id !== this.callId || this.resultShown) return;
    this.fetchResult(id);
  }

  private async showResult(id: number, r: CallResult) {
    if (id !== this.callId || this.resultShown) return;
    this.resultShown = true;
    this.markEnded();
    this.closeLive();
    await sleep(700);
    if (id !== this.callId) return;
    const t = this.t;
    const rows: Row[] = Object.entries(r.details).map(([k, v]) => [cap(k), v]);
    rows.push([t.dur, fmt(r.durationSec * 1000)]);
    const title = this.hangup && r.outcome !== "done" ? t.hungTitle : clean(r.summary) || t.ended;
    this.set({ sheet: { kind: "result", ok: r.outcome === "done", title, rows }, sheetOpen: true });
  }

  private async failLive(id: number, title: string, reason: string) {
    if (id !== this.callId || this.resultShown) return;
    this.resultShown = true;
    if (!this.ended) {
      this.ended = true;
      this.flushReveals();
      this.stopTimer();
      this.set({ pill: "ended", speaker: null, speakerNote: "ended", callEnded: true });
    }
    this.closeLive();
    await sleep(500);
    if (id !== this.callId) return;
    this.set({ sheet: { kind: "result", ok: false, title, rows: [[this.t.reason, reason]] }, sheetOpen: true });
  }

  /** Stop listening to the live call. Hangs up first if it is still running. */
  private closeLive() {
    if (this.live && this.liveCall && !this.ended) {
      this.live.send({ type: "hangup" });
      if (this.api) api.hangup(this.api, this.liveCall).catch(() => {});
    }
    this.live?.close();
    this.live = null;
    this.reveals.forEach((r) => clearInterval(r.timer));
    this.reveals.clear();
    clearTimeout(this.quiet);
  }

  /** Label for the settings pane. */
  serverLabel(): string {
    const t = this.t;
    if (!this.api) return t.serverScript;
    let host = this.api;
    try {
      host = new URL(this.api).host;
    } catch {}
    return fill(t.serverLive, { host });
  }
}
