import { ApiError, getToken, logoutAccount, onUnauthorized } from "./account";
import { createPersister, toDurable, type Durable, type RecentCall } from "./persist";
import { getFacts, setFacts } from "@/components/FactStrip";
import { getReceipt, setReceipt } from "@/components/Receipt";
import { APP_COPY } from "./copy-app";
import { COPY, type Copy, type Lang, type Row } from "./i18n";
import { SCENARIOS, detect, type AskConfig, type Outcome, type ScenarioKey, type Who } from "./scenarios";
import { currentReal, isLive, planRealCall, planTargets, realEnabled, restoreReal, resumeRealCall, type LiveIO } from "./real-call";
import { DEFAULT_PRESETS, localPresetRepo, type PresetRequest, type StoredPreset } from "./presets";
import { HISTORY_MAX, historyRepo, type CallRecord } from "./history";
import { DEMO_MINUTES, migrateMinutes, parseCode, PLANS, type Minutes, type PaidPlanId } from "./plans";
import { TERMS_VERSION } from "./terms";

export type Screen = "intro" | "login" | "signup" | "plans" | "home" | "call";
/** Home = presets and demos, Chat = talk to Spoken, Settings = the Profile tab. */
export type Tab = "home" | "chat" | "settings";
export type ThemePref = "system" | "dark" | "light";
export interface Profile {
  name: string;
  phone: string;
}
export type Pill = "ringing" | "live" | "hold" | "ended";
export type Chip = "repeat" | "thanks";

export type ThreadItem =
  | { id: number; kind: "me" | "bot"; text: string }
  | { id: number; kind: "dots" }
  | { id: number; kind: "plan"; scenario: ScenarioKey; request: string; pressed: boolean };

export type Line =
  | { id: number; kind: Who; words: string[] }
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
  pill: Pill;
  speaker: Who | null;
  speakerNote: "ringing" | "listening" | "ended";
  transcript: Line[];
  elapsed: string;
  callEnded: boolean;
  /** Epoch ms when the shop put us on hold; null when not on hold. */
  holdSince: number | null;
  /** Suggested next instructions from the server (empty = show Repeat/Thanks). */
  chips: string[];
  sheet: Sheet | null;
  sheetOpen: boolean;
  /** Bumped to flash the device frame when Spoken needs you. */
  flashTick: number;
  /** The server's id for the live or last real call; persisted so a reload can reconnect. */
  liveCallId: string | null;
  /** Epoch ms when the call connected; the timer is derived from it so a reload keeps counting. */
  callStartedAt: number | null;
  /** Signed in with a phone number (a session token is stored). Everything but Login needs it. */
  authed: boolean;
  themePref: ThemePref;
  profile: Profile;
  presets: StoredPreset[];
  /** Set while the multi-call view (2–3 parallel info calls) is on screen. */
  multi: MultiRequest | null;
  /** Finished calls with their transcripts, newest first. Kept in this browser only (history.ts). */
  history: CallRecord[];
  /** Higher contrast switched on in Profile. The device's own setting (prefers-contrast) applies anyway, in CSS. */
  highContrast: boolean;
  /** Vibrate when Spoken needs you (phones whose browser can). */
  haptics: boolean;
  /** The terms of use this browser agreed to, and when. Login asks again when TERMS_VERSION changes. */
  terms: { version: string; at: string } | null;
  /** Call minutes on the account: dummy numbers for the showcase, nothing is charged. */
  minutes: Minutes;
  /** Came from sign-up and a plan: Login says it's the last step. */
  signupPending: boolean;
}

export interface MultiRequest {
  request: string;
  targets: { name: string; phone: string }[];
}

type Pending = { type: "repeat" } | { type: "thanks" } | { type: "text"; text: string };

const INTRO_RESET: IntroState = {
  drop: false, morph: false, still: false, width: null, typed: "", caret: false, pops: false, word: false,
};

const INITIAL: State = {
  lang: "en",
  screen: "intro",
  tab: "home",
  intro: INTRO_RESET,
  threaded: false,
  thread: [],
  draft: "",
  focusTick: 0,
  scenario: "pizza",
  pill: "ringing",
  speaker: null,
  speakerNote: "listening",
  transcript: [],
  elapsed: "0:00",
  callEnded: false,
  holdSince: null,
  chips: [],
  sheet: null,
  sheetOpen: false,
  flashTick: 0,
  liveCallId: null,
  callStartedAt: null,
  authed: false,
  themePref: "system",
  // No default name: real calls say this name out loud, so it must never be a made-up one.
  profile: { name: "", phone: "" },
  presets: DEFAULT_PRESETS,
  multi: null,
  history: [],
  highContrast: false,
  haptics: true,
  terms: null,
  minutes: DEMO_MINUTES,
  signupPending: false,
};

const HANG = Symbol("hang");
const ABORT = Symbol("abort");
const LANG_KEY = "spoken-lang";
/** SavedPrefs as JSON. layout.tsx reads the theme and contrast from here before first paint. */
export const PREFS_KEY = "spoken-prefs";
type SavedPrefs = Pick<State, "themePref" | "profile" | "highContrast" | "haptics" | "terms" | "minutes">;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Wait two frames so a reset class is painted before the next one is added. */
const nextPaint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
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
  private realSink: { instruction(text: string): void; hangup(): void; open(): boolean; drop(): void } | null = null;
  /** The contact of the preset being run (real calls only). */
  private presetContact: { name: string; phone: string } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private persister = createPersister(typeof localStorage === "undefined" ? { getItem: () => null, setItem() {}, removeItem() {} } : localStorage);
  /** Saving starts once the saved state has been read, or the empty start state would overwrite it. */
  private restored = false;
  private recent: RecentCall[] = [];
  /** Reconnecting to a running call: replayed lines appear at once instead of being typed out. */
  private replaying = false;
  private offVis: (() => void) | undefined;

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
    this.save();
  }

  private save() {
    if (!this.restored) return;
    this.persister.schedule(() =>
      toDurable(this.state, { uid: this.uid, real: currentReal(), receipt: getReceipt(), facts: getFacts(), recent: this.recent, now: Date.now() }),
    );
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
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<SavedPrefs> | null;
      if (p)
        this.set((s) => ({
          themePref: p.themePref ?? s.themePref,
          profile: { ...s.profile, ...p.profile },
          highContrast: p.highContrast === true,
          haptics: p.haptics ?? s.haptics,
          terms: p.terms ?? s.terms,
          minutes: migrateMinutes(p.minutes) ?? s.minutes,
        }));
    } catch {}
    this.set({ history: historyRepo.load() });
    // The stored session token is the login: a reload keeps it, a 401 anywhere drops it.
    this.set({ authed: !!getToken() });
    onUnauthorized(() => this.sessionExpired());
    const presets = localPresetRepo.load();
    if (presets) this.set({ presets });
    this.applyTheme();
    const onVis = () => {
      if (document.visibilityState === "visible") this.reconnectIfDropped();
      else void this.persister.flush(); // tab hidden or closing: write now
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onVis);
    this.offVis = () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onVis);
    };
    void this.boot();
  }

  /** Read the saved state, then either put the user back where they were or play the intro. */
  private async boot() {
    const snap = this.state.authed ? await this.persister.load() : null;
    if (!this.state.authed) void this.persister.clear();
    if (snap && this.restore(snap)) return;
    this.restored = true;
    this.intro();
  }

  /** Put back what the user left: chat, plans, and the live or finished call. False = nothing worth restoring. */
  private restore(d: Durable): boolean {
    this.recent = d.recent;
    const hasCall = d.screen === "call" && (d.transcript.length > 0 || d.liveCallId);
    if (!d.thread.length && !hasCall && !d.draft) {
      this.restored = true;
      return false;
    }
    if (d.real) restoreReal(d.real);
    this.uid = Math.max(this.uid, d.uid);
    this.introId++;
    setFacts(d.facts);
    setReceipt(d.receipt);
    this.set({
      thread: d.thread as ThreadItem[],
      threaded: d.thread.length > 0,
      draft: d.draft,
      tab: d.tab === "chat" || d.tab === "settings" ? d.tab : "home",
      scenario: d.scenario as ScenarioKey,
      screen: "home",
      liveCallId: d.liveCallId,
      callStartedAt: d.callStartedAt,
    });
    this.restored = true;
    if (hasCall) {
      this.set({
        screen: "call",
        transcript: d.transcript as Line[],
        elapsed: d.elapsed,
        pill: d.pill as Pill,
        callEnded: d.callEnded,
        chips: d.chips,
        holdSince: d.holdSince,
        speakerNote: d.callEnded ? "ended" : "listening",
        sheet: d.result as Sheet | null,
        sheetOpen: d.callEnded && d.result != null,
      });
      // A call that was live: reconnect to its socket (the server keeps it ~30 min).
      if (!d.callEnded && d.liveCallId && d.real) void this.startCall(d.liveCallId);
      else if (!d.callEnded) this.set({ callEnded: true, pill: "ended", speakerNote: "ended" });
    }
    return true;
  }

  /** Tab visible again with a live call whose socket the browser closed: join it again. */
  private reconnectIfDropped() {
    const s = this.state;
    if (s.screen !== "call" || s.callEnded || !s.liveCallId || s.multi) return;
    if (this.realSink?.open()) return;
    void this.startCall(s.liveCallId);
  }

  stop() {
    this.offVis?.();
    void this.persister.flush();
    onUnauthorized(null);
    this.introId++;
    this.homeId++;
    this.callId++;
    this.stopTimer();
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
      if (!stop()) this.afterIntro();
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
    if (!stop()) this.afterIntro();
  }

  skipIntro() {
    this.introId++;
    this.afterIntro();
  }

  /* ---------- login, profile, theme ---------- */

  private afterIntro() {
    if (this.state.authed) this.goHome();
    else this.set({ screen: "login" });
  }

  /** True when this browser has agreed to the current terms of use. */
  termsOk(): boolean {
    return this.state.terms?.version === TERMS_VERSION;
  }

  /**
   * The SMS code was accepted (account.verifyLogin stored the token): enter the app.
   * `agreed` is the terms checkbox on the phone step; new or changed terms are recorded here.
   */
  signedIn(agreed = false) {
    if (!this.termsOk() && agreed) this.acceptTerms();
    this.set({ authed: true, signupPending: false });
    this.goHome();
  }

  private acceptTerms() {
    this.set({ terms: { version: TERMS_VERSION, at: new Date().toISOString() } });
    this.savePrefs();
  }

  /*
   * Sign-up and plans: a showcase, as in the app. Nothing is sent or charged. Accounts are phone
   * numbers (account.ts), so after a plan or a code the last step is the SMS login.
   */

  openSignup() {
    this.set({ screen: "signup" });
  }

  openLogin() {
    this.set({ screen: "login" });
  }

  /** The form was filled in (checked in Signup.tsx) and the terms agreed: on to the plans. */
  signup() {
    this.acceptTerms();
    this.set({ screen: "plans" });
  }

  /** After sign-up: a new plan, nothing used yet, then the phone number to finish. */
  choosePlan(id: PaidPlanId) {
    const plan = PLANS.find((p) => p.id === id) ?? PLANS[0]!;
    this.set({ minutes: { plan: plan.id, used: 0, extra: 0 }, signupPending: true, screen: "login" });
    this.savePrefs();
  }

  /** Profile → Change plan. Minutes used this month and extra minutes stay. */
  changePlan(id: PaidPlanId) {
    this.set((s) => ({ minutes: { plan: id, used: s.minutes.used, extra: s.minutes.extra } }));
    this.savePrefs();
  }

  /**
   * An organisation's code: its plan, paid by them. From the plans page (`fromSignup`) the
   * phone login follows. Returns false for a code without the right shape (any such code works).
   */
  redeemCode(code: string, fromSignup = false): boolean {
    const r = parseCode(code);
    if (!r.ok) return false;
    this.set((s) => ({
      minutes: { plan: "org", used: fromSignup ? 0 : s.minutes.used, extra: fromSignup ? 0 : s.minutes.extra, org: r.org },
    }));
    this.savePrefs();
    if (fromSignup) this.set({ signupPending: true, screen: "login" });
    return true;
  }

  /** Profile → Add minutes. No payment: the minutes are just added. */
  addMinutes(n: number) {
    this.set((s) => ({ minutes: { ...s.minutes, extra: s.minutes.extra + n } }));
    this.savePrefs();
  }

  async logout() {
    await logoutAccount(); // tells the server, then forgets the token whatever the answer
    this.toLogin();
  }

  /** A request came back 401: the session is gone, so go back to Login. */
  sessionExpired() {
    this.toLogin();
  }

  private toLogin() {
    this.demo = false;
    // Logout forgets everything on this device: chat, plans, calls and their summaries.
    this.recent = [];
    this.uid = 1;
    setFacts([]);
    setReceipt(null);
    this.realSink?.drop();
    this.realSink = null;
    this.goHome();
    this.set({ transcript: [], sheet: null, liveCallId: null, callStartedAt: null, callEnded: false, draft: "" });
    void this.persister.clear();
    this.set({ authed: false, screen: "login", signupPending: false });
  }

  setThemePref(themePref: ThemePref) {
    this.set({ themePref });
    this.applyTheme();
    this.savePrefs();
  }

  /** data-theme on <html> picks the palette in globals.css ("system" follows the device); data-contrast adds higher contrast. */
  private applyTheme() {
    const d = document.documentElement.dataset;
    d.theme = this.state.themePref;
    if (this.state.highContrast) d.contrast = "more";
    else delete d.contrast;
  }

  /** Profile: higher contrast on top of the device's setting (which can't be turned off from here). */
  setHighContrast(highContrast: boolean) {
    this.set({ highContrast });
    this.applyTheme();
    this.savePrefs();
  }

  setHaptics(haptics: boolean) {
    this.set({ haptics });
    this.savePrefs();
  }

  setProfile(patch: Partial<Profile>) {
    this.set((s) => ({ profile: { ...s.profile, ...patch } }));
    this.savePrefs();
  }

  private savePrefs() {
    const { themePref, profile, highContrast, haptics, terms, minutes } = this.state;
    const saved: SavedPrefs = { themePref, profile, highContrast, haptics, terms, minutes };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(saved));
    } catch {}
  }

  /* ---------- call history (history.ts): saved when a call ends, kept in this browser ---------- */

  private saveCall(sheet: Extract<Sheet, { kind: "result" }>) {
    const sc = SCENARIOS[this.state.scenario];
    const lines = this.state.transcript.map((l) =>
      l.kind === "you" || l.kind === "sys" ? { who: l.kind, text: l.text } : { who: l.kind, text: l.words.join(" ") },
    );
    const record: CallRecord = {
      id: `call-${Date.now().toString(36)}`,
      at: new Date().toISOString(),
      contact: sc[this.state.lang].contact,
      number: sc.number,
      ok: sheet.ok,
      title: sheet.title,
      rows: sheet.rows,
      scripted: !isLive(this.state.scenario),
      lines,
    };
    this.setHistory([record, ...this.state.history].slice(0, HISTORY_MAX));
  }

  deleteCall(id: string) {
    this.setHistory(this.state.history.filter((c) => c.id !== id));
  }

  clearHistory() {
    this.setHistory([]);
  }

  private setHistory(history: CallRecord[]) {
    this.set({ history });
    historyRepo.save(history);
  }

  /* ---------- presets (see presets.ts for the storage and request seams) ---------- */

  /** A filled-in preset becomes a request in the chat, just like typed text (real calls plan it on the server). */
  runPreset(req: PresetRequest) {
    this.demo = false;
    this.set({ tab: "chat" });
    // Real calls send the preset's contact number to the server; scripted ones ignore it.
    this.presetContact = req.contact;
    this.sendRequest(req.text);
  }

  savePreset(p: StoredPreset) {
    const list = this.state.presets;
    const i = list.findIndex((x) => x.id === p.id);
    this.setPresets(i === -1 ? [...list, p] : list.map((x, j) => (j === i ? p : x)));
  }

  deletePreset(id: string) {
    this.setPresets(this.state.presets.filter((p) => p.id !== id));
  }

  /** Put back any built-in preset that was deleted, in its original wording. */
  restorePresets() {
    const have = new Set(this.state.presets.map((p) => p.builtIn).filter(Boolean));
    this.setPresets([...DEFAULT_PRESETS.filter((d) => !have.has(d.builtIn)), ...this.state.presets]);
  }

  private setPresets(presets: StoredPreset[]) {
    this.set({ presets });
    localPresetRepo.save(presets);
  }

  replay() {
    this.demo = false;
    this.callId++;
    this.homeId++;
    this.stopTimer();
    this.set({ sheetOpen: false });
    this.intro();
  }

  /* ---------- home ---------- */

  goHome(tab: Tab = "home") {
    this.chatAnswer = null;
    this.introId++;
    this.homeId++;
    this.callId++;
    this.askResolve = null;
    this.stopTimer();
    this.set({ sheetOpen: false, threaded: false, thread: [], tab, screen: "home", multi: null });
  }

  newChat() {
    this.demo = false;
    this.goHome("chat");
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
    this.sendRequest(this.state.draft);
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
      const contact = this.presetContact;
      this.presetContact = null;
      const key = await planRealCall(text, this.state.lang, {
        bot,
        askUser: async (q) => {
          await bot(q);
          this.set((s) => ({ focusTick: s.focusTick + 1 }));
          return new Promise<string>((resolve) => { this.chatAnswer = resolve; });
        },
      }, { profile: this.state.profile, contact });
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
    this.set((s) => ({ threaded: false, thread: [], draft: text, focusTick: s.focusTick + 1 }));
  }

  private pushThread(item: ThreadItem) {
    this.set((s) => ({ thread: [...s.thread, item] }));
  }

  private patchThread(id: number, patch: Partial<Omit<ThreadItem, "id" | "kind">>) {
    this.set((s) => ({
      thread: s.thread.map((i) => (i.id === id ? ({ ...i, ...patch } as ThreadItem) : i)),
    }));
  }

  async sendRequest(raw: string, scripted = false) {
    const text = raw.trim();
    if (!text) return;
    if (!scripted && !this.demo && realEnabled()) return this.sendRealRequest(text);
    const id = ++this.homeId;
    const stop = () => id !== this.homeId;
    const scenario = detect(text);

    this.set({ scenario, threaded: true, thread: [{ id: this.uid++, kind: "me", text }], draft: "" });
    await sleep(350);
    if (stop()) return;

    const dots = this.uid++;
    this.pushThread({ id: dots, kind: "dots" });
    await sleep(800);
    if (stop()) return;

    const bot = this.uid++;
    this.set((s) => ({ thread: [...s.thread.filter((i) => i.id !== dots), { id: bot, kind: "bot", text: "" }] }));
    await this.typeInto((t) => this.patchThread(bot, { text: t }), this.t.planIntro, 14, stop);
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
    this.goHome("chat");
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
    this.sendRequest(this.state.draft);
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

  /** The plan asked 2–3 places: open the multi-call view, which starts them through /api/compare. */
  private startMulti(targets: { name: string; phone: string }[]) {
    this.callId++;
    this.homeId++;
    this.stopTimer();
    const request = SCENARIOS[this.state.scenario][this.state.lang].request;
    this.set({ multi: { request, targets }, sheetOpen: false, screen: "call" });
  }

  /** `resume` = the server's id of a call that is already running: join it instead of starting one. */
  async startCall(resume?: string) {
    const targets = resume ? undefined : planTargets(this.state.scenario);
    if (targets) return this.startMulti(targets);
    // Reconnecting: close the old socket first, and keep what is on screen in case the call is gone.
    this.realSink?.drop();
    this.realSink = null;
    const kept = resume ? { transcript: this.state.transcript, elapsed: this.state.elapsed } : null;
    const id = ++this.callId;
    this.homeId++;
    const lang = this.state.lang;
    const sc = SCENARIOS[this.state.scenario];
    const L = sc[lang];
    this.hangup = false;
    this.pending = [];
    this.flushing = false;
    this.lastThem = "";
    this.askResolve = null;
    this.stopTimer();

    this.replaying = !!resume;
    if (resume) setTimeout(() => { if (id === this.callId) this.replaying = false; }, 4000);
    this.set({
      transcript: [], sheetOpen: false, callEnded: false, holdSince: null, chips: [],
      pill: "ringing", speaker: null, speakerNote: "ringing", screen: "call",
      ...(resume ? { liveCallId: resume } : { elapsed: "0:00", liveCallId: null, callStartedAt: null }),
    });
    if (!resume) this.sys(`${this.t.calling} ${L.contact} · ${sc.number}`);
    const live = isLive(this.state.scenario);
    const connected = () => {
      const t0 = (resume && this.state.callStartedAt) || Date.now();
      this.set({ pill: "live", speakerNote: "listening", callStartedAt: t0 });
      this.startTimer(t0);
      if (!resume) this.sys(this.t.connected);
    };
    if (!live) {
      // A script must never pass for a real call.
      this.sys(APP_COPY[lang].scriptedNote);
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
      await sleep(this.replaying ? 0 : who === "them" ? 500 : 350);
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
        await sleep(this.replaying ? 0 : (who === "them" ? 105 : 90) + (/[.,!?]$/.test(words[i]) ? 140 : 0));
      }
      this.set({ speaker: null, speakerNote: "listening" });
    };

    const ask = (cfg: AskConfig): Promise<string> => {
      guard();
      return new Promise<string>((resolve) => {
        this.set((s) => ({
          pill: "hold", flashTick: s.flashTick + 1, sheet: { kind: "ask", cfg, pressed: null }, sheetOpen: true,
        }));
        if (this.state.haptics) {
          try {
            navigator.vibrate?.([120, 80, 120]);
          } catch {}
        }
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
      const sayMore = async (who: Who, text: string) => {
        guard();
        const last = [...this.state.transcript].reverse().find((l) => l.kind === who);
        if (!last || last.kind === "you" || last.kind === "sys") return say(who, text);
        const words = text.split(" ");
        this.set({ speaker: who });
        for (let i = 0; i < words.length; i++) {
          guard();
          this.set((s) => ({
            transcript: s.transcript.map((l) => (l.id === last.id && l.kind === who ? { ...l, words: [...l.words, words[i]] } : l)),
          }));
          await sleep(this.replaying ? 0 : 90 + (/[.,!?]$/.test(words[i]) ? 140 : 0));
        }
        this.set({ speaker: null, speakerNote: "listening" });
      };
      const io: LiveIO = {
        say,
        sayMore,
        ask,
        note: (text) => id === this.callId && this.sys(text),
        hold: (since) => id === this.callId && this.set({ holdSince: since }),
        chips: (items) => id === this.callId && this.set({ chips: items }),
        connected: () => id === this.callId && connected(),
        callId: (cid) => id === this.callId && this.set({ liveCallId: cid }),
        attach: (sink) => { if (id === this.callId) this.realSink = sink; },
      };
      outcome = await (resume ? resumeRealCall(resume, lang, io) : sc.run(lang, io));
      this.realSink = null;
    } catch (e) {
      if (id === this.callId) this.realSink = null;
      if (e === ABORT) return;
      if (resume && e instanceof ApiError && e.status === 404) {
        // The server forgot the call (kept 30 min, in memory): show what we saved, as ended.
        this.set({ transcript: kept!.transcript, elapsed: kept!.elapsed });
        this.sys(lang === "no" ? "Samtalen er ikke lenger på serveren." : "This call is no longer on the server.");
        return this.finish(id, { ok: false, title: lang === "no" ? "Samtalen er avsluttet" : "The call has ended", rows: [] });
      }
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
    this.set({ pill: "ended", speaker: null, speakerNote: "ended", callEnded: true, holdSince: null, chips: [] });
    this.sys(`${this.t.ended} · ${dur}`);
    await sleep(700);
    if (id !== this.callId) return;
    const t = this.t;
    const sheet: Sheet =
      o.hung === true
        ? { kind: "result", ok: false, title: t.hungTitle, rows: [...t.hungRows, [t.dur, dur]] }
        : { kind: "result", ok: o.ok, title: o.title, rows: [...o.rows, [t.dur, dur]] };
    this.set({ sheet, sheetOpen: true });
    if (sheet.kind === "result") this.saveCall(sheet);
    this.demo = false;
    this.recent = [
      ...this.recent.filter((r) => r.callId !== this.state.liveCallId || !r.callId),
      { callId: this.state.liveCallId, contact: SCENARIOS[this.state.scenario][this.state.lang].contact, title: sheet.kind === "result" ? sheet.title : "", ok: sheet.kind === "result" && sheet.ok, at: Date.now() },
    ].slice(-20);
    void this.persister.flush();
  }

  choose(v: string) {
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
    this.askResolve?.("hang");
  }

  private noteYou(text: string) {
    this.set((s) => ({ transcript: [...s.transcript, { id: this.uid++, kind: "you", text }] }));
    this.sys(this.t.noted);
  }

  sendInstruction(raw: string) {
    const text = raw.trim();
    if (!text) return;
    this.noteYou(text);
    this.set({ chips: [] });
    if (this.realSink) return this.realSink.instruction(text);
    this.pending.push({ type: "text", text });
  }

  chip(type: Chip) {
    this.noteYou(type === "repeat" ? this.t.chipRepeat : this.t.chipThanks);
    if (this.realSink) {
      return this.realSink.instruction(type === "repeat" ? "Be dem gjenta det de sa." : "Takk dem.");
    }
    this.pending.push({ type });
  }
}
