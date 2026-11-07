import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import type { CallResult, Clarify, Contact, Lang, Plan, Profile, TaskInput } from "../../../shared/contract.ts";
import { detectLang } from "../i18n/index.ts";

// One store for the whole app. Settings, profile and places live in localStorage
// (this device only, per the privacy note). The current task flow lives in
// sessionStorage so a refresh mid-flow doesn't lose it.

export type ThemePref = "system" | "dark" | "light";

export interface Settings {
  theme: ThemePref;
  bigText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  vibrate: boolean;
  flash: boolean;
}

export interface Flow {
  task?: TaskInput;
  clarify?: Clarify;
  answers?: Record<string, string>;
  plan?: Plan;
  callId?: string;
  result?: CallResult;
}

export interface State {
  onboarded: boolean;
  settings: Settings;
  profile: Profile;
  places: Contact[];
  flow: Flow;
}

export type Action =
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "profile"; patch: Partial<Profile> }
  | { type: "lang"; lang: Lang }
  | { type: "onboarded"; value: boolean }
  | { type: "places"; places: Contact[] }
  | { type: "flow/task"; task: TaskInput; clarify: Clarify }
  | { type: "flow/plan"; answers: Record<string, string>; plan: Plan }
  | { type: "flow/call"; callId: string }
  | { type: "flow/result"; result: CallResult }
  | { type: "flow/reset" };

const LOCAL_KEY = "spoken.v1";
const SESSION_KEY = "spoken.flow.v1";

const DEFAULT_PLACES: Contact[] = [
  { id: "c-dominos", name: "Domino's Storo", phone: "+4722150000", kind: "business" },
  { id: "c-lege", name: "Torshov legesenter", phone: "+4723224100", kind: "business" },
  { id: "c-mamma", name: "Mamma", phone: "+4791340552", kind: "person" },
];

function initial(): State {
  const base: State = {
    onboarded: false,
    settings: { theme: "system", bigText: false, highContrast: false, reduceMotion: false, vibrate: true, flash: true },
    profile: { name: "", hearCall: false, personality: "warm", lang: detectLang() },
    places: DEFAULT_PLACES,
    flow: {},
  };
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "null") as Partial<State> | null;
    const flow = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null") as Flow | null;
    return {
      ...base,
      ...(saved ?? {}),
      settings: { ...base.settings, ...(saved?.settings ?? {}) },
      profile: { ...base.profile, ...(saved?.profile ?? {}) },
      flow: flow ?? {},
    };
  } catch {
    // Corrupt storage: start fresh rather than crash the app.
    return base;
  }
}

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "settings":
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case "profile":
      return { ...s, profile: { ...s.profile, ...a.patch } };
    case "lang":
      return { ...s, profile: { ...s.profile, lang: a.lang } };
    case "onboarded":
      return { ...s, onboarded: a.value };
    case "places":
      return { ...s, places: a.places };
    case "flow/task":
      return { ...s, flow: { task: a.task, clarify: a.clarify } };
    case "flow/plan":
      return { ...s, flow: { ...s.flow, answers: a.answers, plan: a.plan, callId: undefined, result: undefined } };
    case "flow/call":
      return { ...s, flow: { ...s.flow, callId: a.callId, result: undefined } };
    case "flow/result":
      return { ...s, flow: { ...s.flow, result: a.result } };
    case "flow/reset":
      return { ...s, flow: {} };
  }
}

const Ctx = createContext<{ state: State; dispatch: (a: Action) => void } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);

  useEffect(() => {
    const { flow, ...persisted } = state;
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(persisted));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(flow));
    } catch (err) {
      console.warn("Could not save settings to this device", err);
    }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}
