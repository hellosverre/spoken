import type { Row } from "./i18n";

/*
  Call history: every finished call with its transcript, kept in this browser only
  (localStorage), never sent anywhere. The server keeps no transcripts (CONTRACT.md),
  so this is the only copy. Shown from Profile → Call history. As mobile/src/lib/history.ts.
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
  /** A scripted demo played in the browser, not a call through the server. */
  scripted: boolean;
  lines: HistoryLine[];
}

const KEY = "spoken-call-history";
/** Newest first; older calls drop off past this. */
export const HISTORY_MAX = 100;

export const historyRepo = {
  load(): CallRecord[] {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as CallRecord[]) : [];
    } catch {
      return [];
    }
  },
  save(records: CallRecord[]) {
    try {
      localStorage.setItem(KEY, JSON.stringify(records));
    } catch {}
  },
};

/** "7 Nov, 15:49" / "7. nov., 15:49". */
export function formatWhen(iso: string, lang: "en" | "no"): string {
  return new Intl.DateTimeFormat(lang === "no" ? "nb-NO" : "en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "7 November 2026" / "7. november 2026", for when the terms were agreed. */
export function formatDay(iso: string, lang: "en" | "no"): string {
  return new Intl.DateTimeFormat(lang === "no" ? "nb-NO" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}
