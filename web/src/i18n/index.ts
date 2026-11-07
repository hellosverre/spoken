import type { Lang } from "../../../shared/contract.ts";
import { en, type Dict } from "./en.ts";
import { nb } from "./nb.ts";

// Contract uses "no" for Norwegian; the UI strings are bokmål.
export const dictionaries: Record<Lang, Dict> = { en, no: nb };
export const htmlLang: Record<Lang, string> = { en: "en", no: "nb" };
export const langNames: Record<Lang, string> = { en: "English", no: "Norsk" };

export function detectLang(): Lang {
  const prefs = typeof navigator === "undefined" ? [] : navigator.languages ?? [navigator.language];
  return prefs.some((l) => /^(nb|nn|no)\b/i.test(l)) ? "no" : "en";
}

/** Fills `{name}` placeholders. Unknown keys are left visible so gaps show up in review. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export type { Dict };
