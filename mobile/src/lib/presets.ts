import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Lang } from "./i18n";

/*
  Presets: reusable call requests ("Call mom", "Order a pizza") with fields the
  user fills in each time. Mobile only for now.

  Seams for the real implementation later:
  - Storage goes through PresetRepo. localPresetRepo keeps them on the phone;
    swap in one that talks to the server and nothing else changes.
  - Using a preset produces a PresetRequest (text + who to call). The store's
    runPreset() is the one place that turns it into a call; today it sends the
    text to the chat like typed input, later the contact can skip the lookup.
*/

/** Glyphs a preset can use (a subset of components/Icon). */
export const PRESET_ICONS = ["phone", "heart", "pizza", "doctor", "scissors", "calendar", "bag", "person"] as const;
export type PresetIcon = (typeof PRESET_ICONS)[number];

export interface PresetField {
  id: string;
  /** Shown above the input, and written as {Label} in the template. */
  label: string;
  /** Pre-filled value; the user can change it each time. */
  value: string;
}

export interface PresetContent {
  title: string;
  icon: PresetIcon;
  contactName: string;
  contactPhone: string;
  /** What Spoken is asked to do. {Label} is replaced by that field's value. */
  template: string;
  fields: PresetField[];
}

export type BuiltInKey = "pizza" | "doctor" | "mom" | "haircut";

/** What is saved. A built-in without content follows the app language; once edited it keeps its own text. */
export interface StoredPreset {
  id: string;
  builtIn?: BuiltInKey;
  content?: PresetContent;
}

/** A preset ready to show, with its text in the current language. */
export interface Preset extends PresetContent {
  id: string;
  builtIn?: BuiltInKey;
}

/** What a filled-in preset asks for: the request text plus who to call. */
export interface PresetRequest {
  presetId: string;
  text: string;
  contact: { name: string; phone: string } | null;
}

const f = (id: string, label: string, value: string): PresetField => ({ id, label, value });

// Built-ins name who to call but leave the number empty: the call server looks it up
// from the request text, so they use names its demo directory knows (server/src/directory.ts).
const BUILT_INS: Record<BuiltInKey, Record<Lang, PresetContent>> = {
  pizza: {
    en: {
      title: "Order a pizza",
      icon: "pizza",
      contactName: "Domino's Storo",
      contactPhone: "",
      template: "Order a {Pizza} from Domino's Storo for pickup at {Time}, max {Budget} kr",
      fields: [f("pizza", "Pizza", "large pepperoni"), f("time", "Time", "18:30"), f("budget", "Budget", "250")],
    },
    no: {
      title: "Bestill pizza",
      icon: "pizza",
      contactName: "Domino's Storo",
      contactPhone: "",
      template: "Bestill en {Pizza} fra Domino's Storo til henting {Tid}, maks {Budsjett} kr",
      fields: [f("pizza", "Pizza", "stor pepperoni"), f("time", "Tid", "18:30"), f("budget", "Budsjett", "250")],
    },
  },
  doctor: {
    en: {
      title: "Book a doctor",
      icon: "doctor",
      contactName: "Legekontoret",
      contactPhone: "",
      template: "Book an appointment at the legekontor with {Doctor} about {Reason}, {When}",
      fields: [f("doctor", "Doctor", "Dr. Nilsen"), f("reason", "Reason", "my sore knee"), f("when", "When", "any morning this week")],
    },
    no: {
      title: "Bestill legetime",
      icon: "doctor",
      contactName: "Legekontoret",
      contactPhone: "",
      template: "Bestill time på legekontoret hos {Lege} for {Grunn}, {Når}",
      fields: [f("doctor", "Lege", "dr. Nilsen"), f("reason", "Grunn", "kneet mitt"), f("when", "Når", "en formiddag denne uka")],
    },
  },
  mom: {
    en: {
      title: "Call mom",
      icon: "heart",
      contactName: "Mom",
      contactPhone: "",
      template: "Call mom and tell her {Message}",
      fields: [f("message", "Message", "I'll be late for dinner")],
    },
    no: {
      title: "Ring mamma",
      icon: "heart",
      contactName: "Mamma",
      contactPhone: "",
      template: "Ring mamma og si at {Beskjed}",
      fields: [f("message", "Beskjed", "jeg kommer sent til middag")],
    },
  },
  haircut: {
    en: {
      title: "Book a haircut",
      icon: "scissors",
      contactName: "Frisøren",
      contactPhone: "",
      template: "Book a haircut at the frisør on {Day}, around {Time}",
      fields: [f("day", "Day", "Friday"), f("time", "Time", "16:00")],
    },
    no: {
      title: "Bestill frisør",
      icon: "scissors",
      contactName: "Frisøren",
      contactPhone: "",
      template: "Bestill klipp hos frisøren på {Dag}, rundt {Tid}",
      fields: [f("day", "Dag", "fredag"), f("time", "Tid", "16:00")],
    },
  },
};

export const BUILT_IN_KEYS = Object.keys(BUILT_INS) as BuiltInKey[];

/** The list a new user starts with. */
export const DEFAULT_PRESETS: StoredPreset[] = BUILT_IN_KEYS.map((k) => ({ id: `builtin-${k}`, builtIn: k }));

export function resolvePreset(p: StoredPreset, lang: Lang): Preset {
  const content = p.content ?? (p.builtIn ? BUILT_INS[p.builtIn][lang] : emptyContent());
  return { id: p.id, builtIn: p.builtIn, ...content };
}

export function emptyContent(): PresetContent {
  return { title: "", icon: "phone", contactName: "", contactPhone: "", template: "", fields: [] };
}

export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** The {Label} token for a field, as written in the template. */
export const token = (field: PresetField) => `{${field.label}}`;

/** Fill each {Label} with the value given for that field (or its saved value). */
export function fillTemplate(p: PresetContent, values: Record<string, string> = {}): string {
  let text = p.template;
  for (const field of p.fields) {
    const v = (values[field.id] ?? field.value).trim();
    text = text.split(token(field)).join(v);
  }
  return text.replace(/\s+/g, " ").trim();
}

export function toRequest(p: Preset, values: Record<string, string>): PresetRequest {
  const name = p.contactName.trim();
  const phone = p.contactPhone.trim();
  let text = fillTemplate(p, values);
  // No number: the server finds one from the text, so make sure the text names who to call.
  if (name && !phone && text && !text.toLowerCase().includes(name.toLowerCase())) text = `${text} (${name})`;
  return { presetId: p.id, text, contact: name ? { name, phone } : null };
}

/** Where presets are kept. Today the phone; later the server. */
export interface PresetRepo {
  load(): Promise<StoredPreset[] | null>;
  save(presets: StoredPreset[]): Promise<void>;
}

const KEY = "spoken-presets";

export const localPresetRepo: PresetRepo = {
  async load() {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredPreset[]) : null;
  },
  async save(presets) {
    await AsyncStorage.setItem(KEY, JSON.stringify(presets));
  },
};
