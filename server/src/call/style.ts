// How the agent sounds on the phone, enforced in code (call #8: "talks too much and repeats
// too much"). Pure functions so each rule is testable on its own.

const norm = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}: ]/gu, " ").replace(/\s+/g, " ").trim();

/** Parts of the errand that may be repeated only when the callee asks about that part. */
export interface Errand {
  item?: string; // «en stor pepperoni»
  time?: string; // «18:00»
  name?: string; // «Sverre»
}

/** «bestille en stor pepperoni til henting klokka 18:00» → item «en stor pepperoni», time «18:00». */
export function parseErrand(goal: string, userName: string): Errand {
  const item = goal.match(/^(?:bestille|booke|reservere|kjøpe|avbestille|bestilling av)\s+(.+?)(?=\s+(?:til|hos|på|for|klokka|kl\.?|med levering|i dag|i morgen)\b|$)/i)?.[1];
  const time = goal.match(/\b(\d{1,2}[:.]\d{2})\b/)?.[1]?.replace(".", ":");
  return { item: item?.trim(), time, name: userName || undefined };
}

/** What the callee's last line asked about. */
function asked(lastCallee: string) {
  const c = lastCallee.toLowerCase();
  return {
    // c_cc7521a0c46d: «Hvor mange cola bestilte du?» and «Jeg skjønner ikke hva de prater om»
    // were answered with silence because the answer «restated» the order.
    item: /hva (skal|var|vil) (du|dere)|hvilken|hva slags|hva (ønsker|bestiller)|hva var det|hvor mange|bestilte|hva (sa|mente) du|hvorfor\b.*\bringer|(skal|vil) (du|dere) ha\b.*\?|hva (er det|skjer)|(skjønner|forstår) (ikke|ingenting)|^hva\??$/.test(c),
    time: /når|hvilken tid|klokka|tidspunkt|hvor sent|hvor tidlig/.test(c),
    name: /navn|hvem (er|står)|på hvem/.test(c),
  };
}

/**
 * After the errand was stated once, collapse full re-statements: the item becomes «den»,
 * «på navnet X» goes, «til henting klokka 18:00» becomes «til 18:00». Parts the callee just
 * asked about stay.
 */
export function shortenErrand(text: string, e: Errand, lastCallee: string): string {
  const a = asked(lastCallee);
  let t = text;
  if (e.name && !a.name) t = t.replace(new RegExp(`,?\\s*(?:på|i) navnet ${e.name}`, "gi"), "");
  if (e.item && !a.item) {
    const core = e.item.replace(/^(en|ei|et|én)\s+/i, "");
    // the item with optional article and trailing «-pizza» / «med … bunn»
    const re = new RegExp(`\\b(?:en |ei |et |én )?${core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:pizza)?(?:\\s+med\\s+[\\p{L} ]{1,20}?\\s+bunn)?\\b`, "giu");
    let first = true;
    t = t.replace(re, () => (first ? ((first = false), "den") : ""));
  }
  if (e.time && !a.time) t = t.replace(new RegExp(`til henting (?:klokka |kl\\.? )?${e.time}( i dag)?`, "gi"), `til ${e.time}`);
  t = t.replace(/\s+([,.!?])/g, "$1").replace(/,\s*([.!?])/g, "$1").replace(/\s{2,}/g, " ").trim();
  return t;
}

/** Counts errand parts in a sentence: 2+ means it is a re-statement of the order. */
export function errandParts(text: string, e: Errand): number {
  const t = norm(text);
  let n = 0;
  if (e.item && t.includes(norm(e.item).replace(/^(en|ei|et|én) /, ""))) n++;
  if (e.time && t.includes(e.time)) n++;
  if (e.name && new RegExp(`navnet ${e.name.toLowerCase()}`).test(t)) n++;
  return n;
}

/** Lines that explain our own process or fish for permission again: never said. */
const META = /(før jeg kan gå videre|må få bekreftet|jeg må (først )?(spørre|sjekke) (med )?\w+ (om|før)|hvordan systemet|er det (fortsatt )?greit at jeg snakker med deg|^kort sagt[:,]|for å oppsummere|jeg vil bare (sikre|forsikre meg om)|har ikke fått godkjent)/i;
export function isMeta(text: string): boolean {
  return META.test(text);
}

/** «Jeg hører deg.» after «Jeg hører deg.»: never echo the callee. */
export function isEcho(text: string, lastCallee: string): boolean {
  const a = norm(text), b = norm(lastCallee);
  if (!a || a.split(" ").length < 2) return false;
  return a === b || (b.includes(a) && a.split(" ").length >= 3) || /^(jeg hører deg|ja jeg hører)/.test(a);
}

/** A sentence-ending segment (not a first clause ending in a comma). */
export function endsSentence(text: string): boolean {
  return /[.!?…]$/.test(text.trim());
}

/**
 * After the errand was stated once, a sentence that asks for the item again («Jeg vil gjerne
 * bestille …», «Kan jeg bestille …?») is dropped, unless the callee just asked what we want.
 */
export function restatesErrand(text: string, e: Errand, lastCallee: string): boolean {
  if (!e.item || asked(lastCallee).item) return false;
  const core = norm(e.item).replace(/^(en|ei|et|én) /, "").split(" ").filter((w) => w.length >= 4);
  // A question that names the item («Hvor mange cola …?») may be answered with the order itself.
  const lc = norm(lastCallee);
  if (/\?\s*$/.test(lastCallee.trim()) && core.some((w) => lc.includes(w.slice(0, 4)))) return false;
  const t = norm(text);
  const hasItem = core.length > 0 && core.every((w) => t.includes(w.slice(0, 5)));
  return hasItem && /\b(bestille|bestilling|kjøpe|booke|ha en|ha ei|ha et|vil gjerne|ringer for å)\b/.test(t);
}

// Interjections that open almost every LLM reply (call #9: «Skjønner.», «Okei.», «Så bra.», «Takk.»).
const FILLER_ONLY = /^(skjønner|okei|ok|så bra|takk|takk skal du ha|flott|supert|fint|perfekt|greit|javel|ja vel|ah|å|ja|aha|mhm|mm|forstått|den er grei|det er greit|okay|i see|great|perfect|thanks|thank you|got it|alright|all right|sounds good|yes|understood)[.!,]?$/i;
const FILLER_PREFIX = /^(skjønner|okei|ok|så bra|flott|supert|perfekt|greit|javel|ah|aha|forstått|okay|i see|great|perfect|got it|alright|understood)[,.!]\s+/i;

/** A whole segment that is only an interjection. */
export function isFillerOnly(text: string): boolean {
  return FILLER_ONLY.test(text.trim());
}

/** «Skjønner, da …» → «Da …». */
export function stripFillerPrefix(text: string): string {
  const t = text.replace(FILLER_PREFIX, "");
  return t === text ? text : t.charAt(0).toUpperCase() + t.slice(1);
}

/** Asking the shop who/which branch it is, when the plan already says who we called. */
export function asksWhoTheyAre(text: string): boolean {
  return /\?\s*$/.test(text) && /\b(hvilken (filial|butikk|avdeling|restaurant)|hvem (snakker jeg med|er dette|er det)|er dette \p{L}+|hvor (er|ligger) dere)\b/iu.test(text);
}
