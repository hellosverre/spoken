// Safety rules from CONTRACT.md, enforced in code. The LLM prompt repeats them,
// but nothing here trusts the model to follow it.

import type { Lang, Profile, ProfileReason, ReasonMode, Shareable } from "../../shared/contract.ts";
import type { AgentContext } from "./llm/types.ts";
import { LINES } from "./call/lines.ts";
import { uiText } from "./call/ui-text.ts";

// ---------- Numbers ----------

export const EMERGENCY_ALTERNATIVE =
  "Spoken ringer aldri nødnumre. Ved nød: ring 113 (ambulanse), 112 (politi) eller 110 (brann) selv. " +
  "Døve og hørselshemmede kan bruke nødmeldingstjenesten.";

/** Normalises a typed number to E.164. Bare 8-digit numbers are Norwegian. */
export function normalizePhone(raw: string): string {
  const s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("+")) return "+" + s.slice(1).replace(/\D/g, "");
  if (s.startsWith("00")) return "+" + s.slice(2).replace(/\D/g, "");
  const digits = s.replace(/\D/g, "");
  if (digits.length === 8) return "+47" + digits;
  if (digits.length === 10 && digits.startsWith("47")) return "+" + digits;
  return digits; // short code or junk: stays without +, gets blocked below
}

export type NumberCheck = { ok: true; e164: string } | { ok: false; reason: string; alternative?: string };

export function checkNumber(raw: string): NumberCheck {
  const e164 = normalizePhone(raw);
  const national = e164.startsWith("+47") ? e164.slice(3) : e164.replace(/^\+/, "");
  const emergency = /^(110|112|113|911|999|1412|116\d{3})$/;
  if (emergency.test(national) || emergency.test(e164.replace(/^\+/, ""))) {
    return { ok: false, reason: "Nødnummer: Spoken ringer ikke nødnumre.", alternative: EMERGENCY_ALTERNATIVE };
  }
  if (!e164.startsWith("+")) return { ok: false, reason: "Kortnummer eller ugyldig nummer blokkeres." };
  if (e164.startsWith("+47") && national.length !== 8) {
    return { ok: false, reason: "Norske kortnumre (under 8 siffer) blokkeres." };
  }
  if (e164.length < 9 || e164.length > 16) return { ok: false, reason: "Ugyldig telefonnummer." };
  return { ok: true, e164 };
}

// ---------- Goals ----------

const ABUSIVE = [
  /\btru(e|er|sel|ende)?\b/i, /\bdrep/i, /\bdrap/i, /\btrakass/i, /\bhets/i, /\bsvindl?e?/i, /\bbombe/i,
  /\butgi (deg|meg) for\b/i, /\blat(e)? som (du er|at du er) meg\b/i, /\bpretend to be me\b/i,
  /\bthreat/i, /\bharass/i, /\bscam\b/i, /\bprank/i, /\btull(e)?ring/i, /\bspam/i,
];

export function checkGoal(text: string): { ok: true } | { ok: false; reason: string } {
  for (const re of ABUSIVE) {
    if (re.test(text)) {
      return { ok: false, reason: "Spoken gjør ikke trusler, trakassering, svindel, tullesamtaler eller utgir seg for å være deg." };
    }
  }
  if (/(^|[^\d])(110|112|113)([^\d]|$)/.test(text) && /(ring|call|nød|emergency|ambulanse|politi|brann)/i.test(text)) {
    return { ok: false, reason: "Nødnummer: Spoken ringer ikke nødnumre." };
  }
  return { ok: true };
}

// ---------- Disclosure ----------

/** What the opening needs from the profile; a bare string is just the name. */
export type DisclosureWho = string | Pick<Profile, "name" | "hearCall" | "reason" | "reasonText" | "reasonMode">;

const REASON_NO: Record<Exclude<ProfileReason, "other">, string> = {
  deaf: "som er døv", hard_of_hearing: "som er hørselshemmet", speech: "som har talevansker", anxiety: "som har telefonangst",
};
const REASON_EN: Record<Exclude<ProfileReason, "other">, string> = {
  deaf: "who is Deaf", hard_of_hearing: "who is hard of hearing", speech: "who has a speech impairment", anxiety: "who has phone anxiety",
};

/** Reason is only used when it is set (and «other» has its text). */
function reasonClause(p: Pick<Profile, "reason" | "reasonText">, lang: Lang): string | undefined {
  if (!p.reason) return undefined;
  if (p.reason === "other") {
    const t = p.reasonText?.trim().slice(0, 60);
    return t ? `${lang === "en" ? "who" : "som"} ${t}` : undefined;
  }
  return (lang === "en" ? REASON_EN : REASON_NO)[p.reason];
}

export function effectiveReasonMode(p: Pick<Profile, "reason" | "reasonMode">): ReasonMode {
  return p.reasonMode ?? (p.reason ? "when_helpful" : "never");
}

/** For the LLM prompt: the reason in both languages plus when it may be mentioned. */
export function reasonForPrompt(p: Pick<Profile, "reason" | "reasonText" | "reasonMode">): AgentContext["reason"] {
  const no = reasonClause(p, "no"), en = reasonClause(p, "en");
  const mode = effectiveReasonMode(p);
  return no && en && mode !== "never" ? { mode, no, en } : undefined;
}

export function disclosureLine(who: DisclosureWho, lang: Lang = "no"): string {
  const p = typeof who === "string" ? { name: who, hearCall: false } as const : who;
  const name = p.name.trim() || (lang === "en" ? "a user" : "en bruker");
  const reason = effectiveReasonMode(p) === "always" ? reasonClause(p, lang) : undefined;
  // Short on purpose (Sverre: the intro was far too long). The reason only when the user chose «always».
  const clause = reason ? `, ${reason}` : "";
  return lang === "en"
    ? `Hi, I'm an AI calling for ${name}${clause}.`
    : `Hei, jeg er en KI som ringer for ${name}${clause}.`;
}

/** The first spoken line always starts with the disclosure, whatever the plan or model said. */
export function ensureDisclosure(opening: string, who: DisclosureWho, lang: Lang = "no"): string {
  const rest = opening.replace(/^.*?(KI-assistent|AI assistant|en KI som|an AI calling)[^.!?]*[.!?]\s*/i, "").trim();
  return `${disclosureLine(who, lang)}${rest ? " " + rest : ""}`;
}

// ---------- Callee asks for secrets ----------

const ASKS_CARD = /(kort ?nummer|kortnr|kortet ditt|kortdetaljer|kredittkort|bankkort|card number|card details|credit card|debit card|long number on the card|cvv|cvc|sikkerhetskode|security code|pin[- ]?kode|\bpin\b|utløpsdato|expiry date|expiration date)/i;
const ASKS_FNR = /(fødselsnummer|personnummer|personnr|fnr|elleve siffer|social security|national id|id number|personal number|birth number)/i;
const ASKS_ADDRESS = /(adresse|hvor bor (du|han|hun)|leveringsadresse|address|where (do|does) (you|he|she|they) live)/i;

export const CARD_REFUSAL = "Beklager, jeg kan ikke oppgi kortnummer, sikkerhetskode eller PIN over telefon. Kan vi betale ved henting, eller med en betalingslenke?";
export const FNR_REFUSAL = "Beklager, jeg har ikke lov til å oppgi fødselsnummer i denne samtalen.";
export const ADDRESS_REFUSAL = "Et lite øyeblikk.";
/** Pickup orders don't need an address (call #9 said «jeg må sjekke om jeg kan oppgi adressen»). */
export const PICKUP_NO_ADDRESS = "Det er til henting, så vi trenger ingen adresse.";

export type SecretAsk = "card" | "fnr" | "address" | null;

export function detectSecretAsk(calleeText: string): SecretAsk {
  if (ASKS_CARD.test(calleeText)) return "card";
  if (ASKS_FNR.test(calleeText)) return "fnr";
  if (ASKS_ADDRESS.test(calleeText)) return "address";
  return null;
}

// ---------- Outgoing filter ----------

function luhn(d: string): boolean {
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let x = Number(d[d.length - 1 - i]);
    if (i % 2) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return sum % 10 === 0;
}

/**
 * Last gate before TTS. Removes anything that looks like a card number, CVV/PIN or
 * fødselsnummer, and resolves {{FNR}} / {{ADDRESS}} placeholders only when the user
 * approved sharing them for this call. Returns null if the sentence must not be said.
 */
export function filterOutgoing(
  text: string,
  share: { willShare: Shareable[]; fnr?: string; address?: string; lang?: Lang; uiLang?: Lang },
): { text: string; blocked?: string } {
  const B = uiText(share.uiLang).blocked;
  let out = text;
  const runs = out.match(/\d[\d \-]{9,}\d/g) ?? [];
  for (const r of runs) {
    const d = r.replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return { text: "", blocked: B.card };
    if (d.length === 11) return { text: "", blocked: B.fnr };
  }
  if (/\b(cvv|cvc|pin)\b[^.]*\d{3,4}/i.test(out)) return { text: "", blocked: B.code };
  // Meta talk about the system sounds robotic (call #7): never said on the phone.
  if (/hvordan systemet (mitt )?fungerer|kan ikke si mer om (hvordan|systemet)|som en språkmodell|jeg er bare et program|how (the|my) system works|as a language model|i'?m just a program/i.test(out)) return { text: "", blocked: B.meta };
  if (out.includes("{{FNR}}")) {
    if (!share.willShare.includes("fnr") || !share.fnr) return { text: share.lang === "en" ? LINES.en.fnr : FNR_REFUSAL, blocked: B.fnrNotOk };
    out = out.replaceAll("{{FNR}}", share.fnr.split("").join(" "));
  }
  if (out.includes("{{ADDRESS}}")) {
    if (!share.willShare.includes("address") || !share.address) return { text: "", blocked: B.addressNotOk };
    out = out.replaceAll("{{ADDRESS}}", share.address);
  }
  return { text: out };
}

// ---------- Commitments ----------

const COMMIT = /\b(bekrefter jeg|jeg (bekrefter|bestiller|booker|tar (den|det|timen)|godtar|aksepterer|avbestiller|kansellerer|betaler)|det er (en )?avtale|legg (den |det )?inn|bare kjør|ja,? (takk,? )?(det|den) (tar jeg|blir bra|passer)|vi tar (den|det)|book(e)? (den|det))/i;

// Norwegian inverted order after an adverb: «da bestiller jeg», «så bekrefter jeg» (call #8
// said «Flott, da bestiller jeg …» before any approval).
const COMMIT_INVERTED = /\b(bestiller|booker|bekrefter|tar|godtar|aksepterer|avbestiller|kansellerer|betaler|reserverer|legger inn) jeg\b/i;
// Any tense (call #9: «Jeg bestiller en stor pepperoni …»): past, perfect and «har jeg …» too.
const COMMIT_PAST = /\b(jeg (har )?|har jeg |da er det |det er )(bestilt|bestilte|bekreftet|bekreftede|booket|godtok|godtatt|avbestilt|avbestilte|kansellert|betalt|reservert|lagt inn)\b/i;
// Conditions and questions are not commitments: «Før jeg bekrefter …», «Skal jeg bestille?».
const CONDITIONAL = /\b(før|hvis|når|dersom|om|etter at|så snart) jeg\b/i;

// English: «I'll take it», «I confirm», «let's book it», «I've ordered», «we have a deal».
const COMMIT_EN = /\b(i('ll| will)? (confirm|order|book|take (it|that|the|them|one)|accept|agree to|cancel|pay)|i'?m (confirming|ordering|booking|taking|accepting|cancelling|canceling|paying)|(that'?s|it'?s) a deal|we have a deal|go ahead and (book|order|put)|put (it|that|me) (in|down)|book (it|that)|let'?s (book|do|go with) (it|that)|yes,? (please,? )?(that|it) (works|is fine|sounds good)|we'?ll take (it|that|them)|i('ve| have)? (ordered|booked|confirmed|accepted|cancell?ed|paid|reserved))\b/i;
const CONDITIONAL_EN = /\b(before|if|when|once|after|as soon as) i\b/i;

export function isCommitment(text: string): boolean {
  const t = text.trim();
  if (/\?$/.test(t)) return false;
  if ((CONDITIONAL.test(t) || CONDITIONAL_EN.test(t)) && !/[.!]\s+\S/.test(t)) return false;
  return COMMIT.test(t) || COMMIT_INVERTED.test(t) || COMMIT_PAST.test(t) || COMMIT_EN.test(t);
}

/** Claims that the deal is done; only allowed once the callee clearly confirmed. */
export function isDoneClaim(text: string): boolean {
  return /(bestillingen er (klar|bekreftet|lagt inn|i orden|registrert)|da er (det|den) (bestilt|booket|i orden|notert|klart)|timen er (booket|bestilt|bekreftet)|(the |your )?(order|booking|appointment|reservation) is (confirmed|placed|booked|done|all set)|(that'?s|it'?s|you'?re) (all )?(booked|ordered|confirmed|set))/i.test(text);
}

/** Callee is proposing something that would need a yes from the user. */
export function calleeProposesCommitment(text: string): boolean {
  return /(skal jeg (legge inn|booke|bestille|sette deg opp|reservere)|vil du ha (den|timen|det)|blir det \d|det (blir|koster) .*(kr|kroner)|passer (det|klokka|kl)|er det greit|kan du (komme|ta)|shall i (put|book|order|reserve)|do you want (it|that|the)|that('?s| will be| comes to) .*\d|it costs|does .* work for you|is that (ok|okay|fine|alright)|can you (come|make it))/i.test(text);
}
