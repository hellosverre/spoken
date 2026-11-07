import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo, Platform, Vibration } from "react-native";
import { MOBILE_COPY } from "./copy-mobile";
import { COPY, type Copy, type Lang, type Row } from "./i18n";
import { askNotificationPermission, clearNeedsYou, notifyNeedsYou, notifyOnce, onNotificationAction, setupNotifications } from "./notify";
import { HISTORY_MAX, historyRepo, type CallRecord } from "./history";
import { DEFAULT_PRESETS, localPresetRepo, type PresetRequest, type StoredPreset } from "./presets";
import { configureRealCalls, isLive, newDeviceId, planRealCall, realEnabled, type LiveIO } from "./real-call";
import { SCENARIOS, detect, type AskConfig, type Outcome, type ScenarioKey, type Who } from "./scenarios";

export type Screen = "intro" | "login" | "home" | "call";
export type ThemePref = "system" | "dark" | "light";

/** Mobile only: who is using the app. Kept on this device; not sent anywhere yet. */
export interface Profile {
  name: string;
  phone: string;
}
/** Mobile: the web's Demo tab is Home (presets), and Settings is shown as Profile. */
export type Tab = "home" | "chat" | "settings";
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
  | { kind: "ask"; cfg: AskConfig; pressed: string | null; since: number }
  | { kind: "result"; ok: boolean; title: string; rows: Row[] };

export interface IntroState {
  drop: boolean;
  morph: boolean;
  /** Reduced motion: show the bubble without the drop animation. */
  still: boolean;
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
  sheet: Sheet | null;
  sheetOpen: boolean;
  /** Bumped to flash the device frame when Spoken needs you. */
  flashTick: number;
  /* Mobile only, not in the web store. */
  /** Signed in this session. The login is a placeholder (demo / demo) until real accounts exist. */
  authed: boolean;
  themePref: ThemePref;
  profile: Profile;
  presets: StoredPreset[];
  /** Finished calls with their transcripts, newest first. Kept on this phone only (history.ts). */
  history: CallRecord[];
  /** Call through the Spoken server (real-call.ts); off = the on-phone scripted demos. */
  serverCalls: boolean;
  /** Demo passcode for real calls; empty = the server runs calls in mock mode. */
  passcode: string;
  /** Higher contrast from Profile; null = follow the phone (sysContrast). */
  highContrast: boolean | null;
  /** The phone's Increase Contrast (iPhone) or High contrast text (Android). */
  sysContrast: boolean;
  /** The phone's Bold Text (iPhone). */
  boldText: boolean;
  /** Buzz when Spoken needs you. */
  haptics: boolean;
}

type Pending = { type: "repeat" } | { type: "thanks" } | { type: "text"; text: string };

const INTRO_RESET: IntroState = {
  drop: false, morph: false, still: false, typed: "", caret: false, pops: false, word: false,
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
  sheet: null,
  sheetOpen: false,
  flashTick: 0,
  authed: false,
  themePref: "system",
  // No default name: real calls say this name out loud, so it must never be a made-up one.
  profile: { name: "", phone: "" },
  presets: DEFAULT_PRESETS,
  history: [],
  serverCalls: true,
  passcode: "",
  highContrast: null,
  sysContrast: false,
  boldText: false,
  haptics: true,
};

const HANG = Symbol("hang");
const ABORT = Symbol("abort");
const LANG_KEY = "spoken-lang";
const PREFS_KEY = "spoken-prefs";
/** This phone's id for the server (profile, contacts, call history). Made once, as on the web. */
const DEVICE_KEY = "spoken-device";
const DEMO_LOGIN = { user: "demo", pass: "demo" };
type SavedPrefs = Pick<State, "themePref" | "profile" | "serverCalls" | "passcode" | "highContrast" | "haptics">;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Wait two frames so a reset state is drawn before the next one is set. */
const nextPaint = () =>
  new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
/** Spoken needs you: a short double buzz (a pattern on Android, haptic taps on iOS). */
const buzz = () => {
  if (Platform.OS === "android") return Vibration.vibrate([0, 120, 80, 120]);
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {}), 200);
};
const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * All app state plus the scripted flows (intro, chat, call). Ported from
 * web/src/lib/store.ts; only the platform bits differ (AsyncStorage, haptics,
 * the OS reduce-motion setting, and the intro bubble measuring itself).
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
  /** That answer is a code, so its bubble is masked. */
  private chatSecret = false;
  /** The user chose practice calls instead of giving a demo code. Asked again next launch. */
  private practiceOk = false;
  /** Real calls: where mid-call messages and hang-up go. */
  private realSink: { instruction(text: string): void; hangup(): void } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private reduce = false;
  private a11ySubs: { remove(): void }[] = [];

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

  /** Read out by VoiceOver / TalkBack, after whatever is being read now. Does nothing without a screen reader. */
  private announce(text: string) {
    if (text.trim()) AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
  }

  /** The phone's accessibility settings that change how the app looks or moves. */
  private watchA11y() {
    const on = (event: Parameters<typeof AccessibilityInfo.addEventListener>[0], fn: (v: boolean) => void) =>
      this.a11ySubs.push(AccessibilityInfo.addEventListener(event, fn as never));
    on("reduceMotionChanged", (v) => {
      this.reduce = v;
    });
    if (Platform.OS === "ios") {
      on("boldTextChanged", (boldText) => this.set({ boldText }));
      on("darkerSystemColorsChanged", (sysContrast) => this.set({ sysContrast }));
      AccessibilityInfo.isBoldTextEnabled().then((boldText) => this.set({ boldText }), () => {});
      AccessibilityInfo.isDarkerSystemColorsEnabled().then((sysContrast) => this.set({ sysContrast }), () => {});
    } else {
      on("highTextContrastChanged", (sysContrast) => this.set({ sysContrast }));
      AccessibilityInfo.isHighTextContrastEnabled().then((sysContrast) => this.set({ sysContrast }), () => {});
    }
  }

  async start() {
    this.watchA11y();
    const [saved, prefs, reduce, device] = await Promise.all([
      AsyncStorage.getItem(LANG_KEY).catch(() => null),
      AsyncStorage.getItem(PREFS_KEY).catch(() => null),
      AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
      AsyncStorage.getItem(DEVICE_KEY).catch(() => null),
    ]);
    const deviceId = device || newDeviceId();
    if (!device) AsyncStorage.setItem(DEVICE_KEY, deviceId).catch(() => {});
    configureRealCalls({ deviceId });
    this.reduce = reduce;
    if (saved === "en" || saved === "no") this.set({ lang: saved });
    localPresetRepo
      .load()
      .then((presets) => presets && this.set({ presets }))
      .catch(() => {});
    historyRepo.load().then((history) => this.set({ history }));
    try {
      const p = JSON.parse(prefs ?? "null") as Partial<SavedPrefs> | null;
      if (p)
        this.set((s) => ({
          themePref: p.themePref ?? s.themePref,
          profile: { ...s.profile, ...p.profile },
          serverCalls: p.serverCalls ?? s.serverCalls,
          passcode: p.passcode ?? s.passcode,
          highContrast: p.highContrast ?? s.highContrast,
          haptics: p.haptics ?? s.haptics,
        }));
    } catch {}
    this.syncRealCalls();
    setupNotifications();
    // An Approve / Decline button on the notification answers the open approval.
    onNotificationAction((v) => this.choose(v));
    this.intro();
  }

  stop() {
    this.introId++;
    this.homeId++;
    this.callId++;
    this.stopTimer();
    this.a11ySubs.forEach((s) => s.remove());
    this.a11ySubs = [];
  }

  setLang(lang: Lang) {
    this.set({ lang });
    AsyncStorage.setItem(LANG_KEY, lang).catch(() => {});
  }

  toggleLang() {
    this.setLang(this.state.lang === "en" ? "no" : "en");
  }

  /* ---------- intro ---------- */

  private patchIntro(p: Partial<IntroState>) {
    this.set((s) => ({ intro: { ...s.intro, ...p } }));
  }

  async intro() {
    const id = ++this.introId;
    const stop = () => id !== this.introId;
    this.set({ screen: "intro", intro: INTRO_RESET });
    await nextPaint();
    if (stop()) return;
    const line = this.t.introLine;

    if (this.reduce) {
      this.patchIntro({ morph: true, still: true, typed: line, pops: true, word: true });
      await sleep(1400);
      if (!stop()) this.afterIntro();
      return;
    }

    this.patchIntro({ drop: true });
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

  /* ---------- mobile: login, profile, theme ---------- */

  private afterIntro() {
    if (this.state.authed) this.goHome();
    else this.set({ screen: "login" });
  }

  /** Placeholder sign-in: only demo / demo works until real accounts are added. */
  login(user: string, pass: string): boolean {
    if (user.trim().toLowerCase() !== DEMO_LOGIN.user || pass !== DEMO_LOGIN.pass) return false;
    this.set({ authed: true });
    this.goHome();
    return true;
  }

  logout() {
    this.demo = false;
    this.goHome();
    this.set({ authed: false, screen: "login" });
  }

  setThemePref(themePref: ThemePref) {
    this.set({ themePref });
    this.savePrefs();
  }

  /** Profile: higher contrast on or off. Set once, it stops following the phone's setting. */
  setHighContrast(highContrast: boolean) {
    this.set({ highContrast });
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

  /* presets (see presets.ts for the storage and request seams) */

  /** A filled-in preset becomes a request in the chat, just like typed text. */
  runPreset(req: PresetRequest) {
    this.demo = false;
    this.set({ tab: "chat" });
    // Real calls send the preset's contact to the server, so its number skips the lookup; scripted ones ignore it.
    this.sendRequest(req.text, false, req.contact);
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
    localPresetRepo.save(presets).catch(() => {});
  }

  /* call history (history.ts): saved when a call ends, kept on this phone */

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
    historyRepo.save(history).catch(() => {});
  }

  /** Profile: call through the server, or play the scripted demos on the phone. */
  setServerCalls(serverCalls: boolean) {
    this.set({ serverCalls });
    this.savePrefs();
  }

  setPasscode(passcode: string) {
    this.set({ passcode: passcode.trim() });
    this.savePrefs();
  }

  private syncRealCalls() {
    configureRealCalls({
      enabled: this.state.serverCalls,
      passcode: this.state.passcode,
      // As on the web: a wrong code is forgotten, so the next call asks the server as a demo.
      onWrongPasscode: () => this.setPasscode(""),
    });
  }

  private savePrefs() {
    const { themePref, profile, serverCalls, passcode, highContrast, haptics } = this.state;
    this.syncRealCalls();
    const saved: SavedPrefs = { themePref, profile, serverCalls, passcode, highContrast, haptics };
    AsyncStorage.setItem(PREFS_KEY, JSON.stringify(saved)).catch(() => {});
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
    clearNeedsYou();
    this.introId++;
    this.homeId++;
    this.callId++;
    this.askResolve = null;
    this.stopTimer();
    this.set({ sheetOpen: false, threaded: false, thread: [], tab, screen: "home" });
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
      clearNeedsYou();
      this.set({ draft: "" });
      this.pushThread({ id: this.uid++, kind: "me", text: this.chatSecret ? "••••••" : text });
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
  private async sendRealRequest(text: string, contact: { name: string; phone: string } | null = null) {
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
      if (!stop()) this.announce(line);
    };
    void askNotificationPermission();
    const askUser = async (q: string, secret = false) => {
      await bot(q);
      if (stop()) return "";
      notifyNeedsYou(MOBILE_COPY[this.state.lang].notifyQuestion, q);
      this.chatSecret = secret;
      this.set((s) => ({ focusTick: s.focusTick + 1 }));
      const answer = await new Promise<string>((resolve) => { this.chatAnswer = resolve; });
      this.pushThread({ id: dots, kind: "dots" }); // the server takes a few seconds to plan
      return answer;
    };
    try {
      // Without a code the server runs a mock call with a scripted callee, whatever number you
      // gave. That must be a choice, not what happens because a field in Profile was left empty.
      if (!this.state.passcode && !this.practiceOk) {
        const m = MOBILE_COPY[this.state.lang];
        const typed = (await askUser(m.codeAsk, true)).trim();
        if (stop()) return;
        if (/^(skip|hopp over)$/i.test(typed)) this.practiceOk = true;
        else this.setPasscode(typed);
      }
      const key = await planRealCall(
        text,
        this.state.lang,
        { bot, askUser: (q) => askUser(q) },
        // Your Profile name and phone go to the server (per device), so the call says your name.
        { profile: this.state.profile, contact },
      );
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
    this.chatAnswer = null;
    clearNeedsYou();
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

  async sendRequest(raw: string, scripted = false, contact: { name: string; phone: string } | null = null) {
    const text = raw.trim();
    if (!text) return;
    if (!scripted && !this.demo && realEnabled()) return this.sendRealRequest(text, contact);
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
    this.announce(this.t.planIntro);
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
    if (this.state.screen === "call") this.announce(text);
  }

  private startTimer() {
    const t0 = Date.now();
    this.stopTimer();
    this.timer = setInterval(() => this.set({ elapsed: fmt(Date.now() - t0) }), 500);
  }

  private stopTimer() {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async startCall() {
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

    this.set({
      transcript: [], sheetOpen: false, elapsed: "0:00", callEnded: false,
      pill: "ringing", speaker: null, speakerNote: "ringing", screen: "call",
    });
    this.sys(`${this.t.calling} ${L.contact} · ${sc.number}`);
    const live = isLive(this.state.scenario);
    const instant = () => live || this.reduce;
    const connected = () => {
      this.set({ pill: "live", speakerNote: "listening" });
      this.startTimer();
      this.sys(this.t.connected);
    };
    if (!live) {
      // A script must never pass for a real call.
      this.sys(MOBILE_COPY[lang].scriptedNote);
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
      const words = text.split(" ");
      const lineId = this.uid++;
      if (instant()) {
        // Real calls and reduced motion: the whole line at once, so reading never lags the call.
        this.set((s) => ({ transcript: [...s.transcript, { id: lineId, kind: who, words }], speaker: who }));
      } else {
        await sleep(who === "them" ? 500 : 350);
        guard();
        this.set((s) => ({ transcript: [...s.transcript, { id: lineId, kind: who, words: [] }], speaker: who }));
        for (let i = 0; i < words.length; i++) {
          guard();
          const shown = words.slice(0, i + 1);
          this.set((s) => ({
            transcript: s.transcript.map((l) => (l.id === lineId ? { id: lineId, kind: who, words: shown } : l)),
          }));
          await sleep((who === "them" ? 105 : 90) + (/[.,!?]$/.test(words[i]) ? 140 : 0));
        }
      }
      this.announce(`${who === "ai" ? MOBILE_COPY[lang].aiLabel : L.contact}: ${text}`);
      this.set({ speaker: null, speakerNote: "listening" });
    };

    const ask = (cfg: AskConfig): Promise<string> => {
      guard();
      return new Promise<string>((resolve) => {
        this.set((s) => ({
          pill: "hold", flashTick: s.flashTick + 1, sheet: { kind: "ask", cfg, pressed: null, since: Date.now() }, sheetOpen: true,
        }));
        if (this.state.haptics) buzz();
        // The sheet then takes screen-reader focus on its question (Call.tsx).
        this.announce(MOBILE_COPY[lang].notifyApproval);
        if (!this.demo) {
          void notifyNeedsYou(MOBILE_COPY[lang].notifyApproval, cfg.title, [
            ...cfg.options.map((o) => ({ id: o.v, label: o.label })),
            { id: "no", label: cfg.decline, destructive: true },
          ]);
        }
        const done = (v: string) => {
          this.askResolve = null;
          clearNeedsYou();
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
        const add = (more: string[]) =>
          this.set((s) => ({
            transcript: s.transcript.map((l) => (l.id === last.id && l.kind === who ? { ...l, words: [...l.words, ...more] } : l)),
          }));
        if (instant()) add(words);
        else
          for (let i = 0; i < words.length; i++) {
            guard();
            add([words[i]]);
            await sleep(90 + (/[.,!?]$/.test(words[i]) ? 140 : 0));
          }
        this.announce(text);
        this.set({ speaker: null, speakerNote: "listening" });
      };
      const io: LiveIO = {
        say,
        sayMore,
        ask,
        note: (text) => id === this.callId && this.sys(text),
        connected: () => id === this.callId && connected(),
        attach: (sink) => { this.realSink = sink; },
      };
      outcome = await sc.run(lang, io);
      this.realSink = null;
    } catch (e) {
      this.realSink = null;
      if (e === ABORT) return;
      if (live && e !== HANG) {
        // Server or network problem on a real call: say so, don't fake a line.
        this.sys(e instanceof Error ? e.message : String(e));
        // The reason is in the transcript above; the title stays plain and in the app's language.
        return this.finish(id, { ok: false, title: MOBILE_COPY[lang].callFailed, rows: [] });
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
    clearNeedsYou();
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
    this.saveCall(sheet);
    // Ended while you were in another app: say so, with the outcome.
    if (!this.demo) notifyOnce(MOBILE_COPY[this.state.lang].notifyDone, sheet.title);
    this.demo = false;
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
