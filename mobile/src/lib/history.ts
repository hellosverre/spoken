import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Row } from "./i18n";

/*
  Call history: every finished call with its transcript, kept on this phone only
  (AsyncStorage), never sent anywhere. The server keeps no transcripts (CONTRACT.md),
  so this is the only copy. Shown from Profile → Call history.
*/

export interface HistoryLine {
  who: "ai" | "them" | "you" | "sys";
  text: string;
}

export interface CallRecord {
  id: string;
  /** When the call ended, ISO time. */
  at: string;
  contact: string;
  number: string;
  /** The result: did it get done, its headline and details. */
  ok: boolean;
  title: string;
  rows: Row[];
  /** A scripted demo played on the phone, not a call through the server. */
  scripted: boolean;
  lines: HistoryLine[];
}

const KEY = "spoken-call-history";
/** Newest first; older calls drop off past this. */
export const HISTORY_MAX = 100;

export const historyRepo = {
  async load(): Promise<CallRecord[]> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as CallRecord[]) : [];
    } catch {
      return [];
    }
  },
  async save(records: CallRecord[]): Promise<void> {
    await AsyncStorage.setItem(KEY, JSON.stringify(records));
  },
};

/** "7 Nov, 15:49" / "7. nov., 15:49", falling back to a plain format if Intl is missing. */
export function formatWhen(iso: string, lang: "en" | "no"): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat(lang === "no" ? "nb-NO" : "en-GB", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getDate()}.${d.getMonth() + 1}. ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
}

/** "7 November 2026" / "7. november 2026", for when the terms were agreed. */
export function formatDay(iso: string, lang: "en" | "no"): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(d);
  } catch {
    return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  }
}
