import type { Lang } from "./i18n";

/*
 * Call-minute plans, top-ups and organisation codes. A showcase only: nothing is charged or
 * sent, and picking a plan (or redeeming a code) logs in as the demo user.
 *
 * Plans are monthly subscriptions: a number of minutes each month. Top-ups are one-off extra
 * minutes that don't expire. One price ladder for both, about 9 kr a minute, cheaper in bulk,
 * so a typical three-minute call costs about the 29 kr in JURY-QA.md.
 *
 * Enterprise: an organisation (a municipality, an employer, a hearing association) agrees a
 * price for many accounts and gets one code per person to hand out. Redeeming a code gives
 * the "org" plan, paid by the organisation.
 */

export type PlanId = "try" | "start" | "regular" | "plenty" | "org";
/** The plans anyone can pick; "org" only comes from a code. */
export type PaidPlanId = Exclude<PlanId, "org">;

export interface Plan {
  id: PaidPlanId;
  /** Minutes each month. */
  minutes: number;
  /** Kroner a month; 0 is free. */
  price: number;
}

export const PLANS: Plan[] = [
  { id: "try", minutes: 10, price: 0 },
  { id: "start", minutes: 30, price: 239 },
  { id: "regular", minutes: 60, price: 449 },
  { id: "plenty", minutes: 120, price: 799 },
];

/** Minutes a month on an organisation's plan (in a real deal, agreed with them). */
export const ORG_MINUTES = 60;

/** Picked out on the plans page as the one for regular use (not "most popular": we can't back that). */
export const SUGGESTED_PLAN: PaidPlanId = "regular";

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

/**
 * Minutes on the account this month. Dummy numbers: calls don't count down yet.
 * `extra` is top-ups, kept when the plan changes; `org` names who pays for an "org" plan.
 */
export interface Minutes {
  plan: PlanId;
  used: number;
  extra: number;
  org?: string;
}

/** What the demo user has when logging in with demo / demo. */
export const DEMO_MINUTES: Minutes = { plan: "regular", used: 23, extra: 0 };

/** Few enough minutes left to say so. */
export const LOW_MINUTES = 5;

export function planMinutes(id: PlanId): number {
  return id === "org" ? ORG_MINUTES : (PLANS.find((p) => p.id === id)?.minutes ?? 0);
}

export function totalMinutes(m: Minutes): number {
  return planMinutes(m.plan) + m.extra;
}

/** Saved before plans were monthly ({ plan, total, used }): the minutes over the plan become extra. */
export function migrateMinutes(saved: unknown): Minutes | null {
  if (!saved || typeof saved !== "object") return null;
  const s = saved as Partial<Minutes> & { total?: number };
  if (typeof s.plan !== "string" || typeof s.used !== "number") return null;
  const plan = s.plan as PlanId;
  const extra = typeof s.extra === "number" ? s.extra : Math.max(0, (s.total ?? 0) - planMinutes(plan));
  return { plan, used: s.used, extra, org: s.org };
}

/**
 * An organisation code, as handed out: letters and digits in groups, like NAV-7Q4K-2M9X.
 * The showcase accepts any code of that shape; a first group of 2–12 letters is taken as
 * the organisation's name, so a code from "NAV-…" shows "Paid by NAV".
 */
export function parseCode(raw: string): { ok: boolean; org?: string } {
  const code = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9]{2,12}(-[A-Z0-9]{3,6}){1,3}$/.test(code)) return { ok: false };
  const first = code.split("-")[0]!;
  return { ok: true, org: /^[A-Z]{2,12}$/.test(first) ? first : undefined };
}

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
  const v = Math.round((price / minutes) * 10) / 10;
  try {
    return `${nf(lang, Number.isInteger(v) ? 0 : 1).format(v)} kr/min`;
  } catch {
    return `${v.toFixed(1)} kr/min`;
  }
}
