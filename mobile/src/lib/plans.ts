import type { Lang } from "./i18n";

/*
 * Call-minute plans and top-ups. A showcase only: nothing is charged, and picking a plan
 * logs in as the demo user. One price ladder for both, about 9 kr a minute, cheaper in bulk,
 * so a typical three-minute call costs about the 29 kr in JURY-QA.md.
 */

export type PlanId = "try" | "start" | "regular" | "plenty";

export interface Plan {
  id: PlanId;
  minutes: number;
  /** Kroner; 0 is free. */
  price: number;
}

export const PLANS: Plan[] = [
  { id: "try", minutes: 10, price: 0 },
  { id: "start", minutes: 30, price: 239 },
  { id: "regular", minutes: 60, price: 449 },
  { id: "plenty", minutes: 120, price: 799 },
];

/** Picked out on the plans page as the one for regular use (not "most popular": we can't back that). */
export const SUGGESTED_PLAN: PlanId = "regular";

export interface TopUp {
  minutes: number;
  price: number;
}

export const TOP_UPS: TopUp[] = [
  { minutes: 5, price: 45 },
  { minutes: 10, price: 89 },
  { minutes: 20, price: 169 },
  { minutes: 30, price: 239 },
  { minutes: 60, price: 449 },
  { minutes: 120, price: 799 },
];

/** Minutes on the account. Dummy numbers: calls don't count down yet. */
export interface Minutes {
  plan: PlanId;
  total: number;
  used: number;
}

/** What the demo user has when logging in with demo / demo. */
export const DEMO_MINUTES: Minutes = { plan: "regular", total: 60, used: 23 };

/** Few enough minutes left to say so. */
export const LOW_MINUTES = 5;

const nf = (lang: Lang, digits = 0) =>
  new Intl.NumberFormat(lang === "no" ? "nb-NO" : "en-GB", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** "449 kr". */
export function kr(price: number, lang: Lang): string {
  try {
    return `${nf(lang).format(price)} kr`;
  } catch {
    return `${price} kr`;
  }
}

/** "7.5 kr/min" or "7,5 kr/min". */
export function perMinute(price: number, minutes: number, lang: Lang): string {
  const v = price / minutes;
  try {
    return `${nf(lang, Number.isInteger(Math.round(v * 10) / 10) ? 0 : 1).format(Math.round(v * 10) / 10)} kr/min`;
  } catch {
    return `${v.toFixed(1)} kr/min`;
  }
}
