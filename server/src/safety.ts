// Safety rules from CONTRACT.md, enforced in code. The LLM prompt repeats them,
// but nothing here trusts the model to follow it.

import type { Shareable } from "../../shared/contract.ts";

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

export function disclosureLine(name: string): string {
  const who = name.trim() || "en bruker";
  return `Hei, jeg er en KI-assistent som ringer på vegne av ${who}.`;
}

/** The first spoken line always starts with the disclosure, whatever the plan or model said. */
export function ensureDisclosure(opening: string, name: string): string {
  const d = disclosureLine(name);
  const rest = opening.replace(/^.*?KI-assistent[^.!?]*[.!?]\s*/i, "").trim();
  const sayNo = /si nei|takke nei/i.test(rest) ? "" : " Du kan gjerne si nei til å snakke med meg.";
  return `${d}${sayNo}${rest ? " " + rest : ""}`;
}

// ---------- Callee asks for secrets ----------

const ASKS_CARD = /(kort ?nummer|kortnr|kortet ditt|kortdetaljer|kredittkort|bankkort|card number|cvv|cvc|sikkerhetskode|pin[- ]?kode|\bpin\b|utløpsdato)/i;
const ASKS_FNR = /(fødselsnummer|personnummer|personnr|fnr|elleve siffer)/i;
const ASKS_ADDRESS = /(adresse|hvor bor (du|han|hun)|leveringsadresse)/i;

export const CARD_REFUSAL = "Beklager, jeg kan ikke oppgi kortnummer, sikkerhetskode eller PIN over telefon. Kan vi betale ved henting, eller med en betalingslenke?";
export const FNR_REFUSAL = "Beklager, jeg har ikke lov til å oppgi fødselsnummer i denne samtalen.";
export const ADDRESS_REFUSAL = "Et øyeblikk, jeg må sjekke om jeg kan oppgi adressen.";

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
  share: { willShare: Shareable[]; fnr?: string; address?: string },
): { text: string; blocked?: string } {
  let out = text;
  const runs = out.match(/\d[\d \-]{9,}\d/g) ?? [];
  for (const r of runs) {
    const d = r.replace(/\D/g, "");
    if (d.length >= 13 && d.length <= 19 && luhn(d)) return { text: "", blocked: "Stoppet et kortnummer før det ble sagt." };
    if (d.length === 11) return { text: "", blocked: "Stoppet et fødselsnummer som ikke var godkjent." };
  }
  if (/\b(cvv|cvc|pin)\b[^.]*\d{3,4}/i.test(out)) return { text: "", blocked: "Stoppet en sikkerhetskode før den ble sagt." };
  // Meta talk about the system sounds robotic (call #7): never said on the phone.
  if (/hvordan systemet (mitt )?fungerer|kan ikke si mer om (hvordan|systemet)|som en språkmodell|jeg er bare et program/i.test(out)) return { text: "", blocked: "Fjernet en setning om systemet." };
  if (out.includes("{{FNR}}")) {
    if (!share.willShare.includes("fnr") || !share.fnr) return { text: FNR_REFUSAL, blocked: "Fødselsnummer ikke godkjent for denne samtalen." };
    out = out.replaceAll("{{FNR}}", share.fnr.split("").join(" "));
  }
  if (out.includes("{{ADDRESS}}")) {
    if (!share.willShare.includes("address") || !share.address) return { text: "", blocked: "Adresse ikke godkjent for denne samtalen." };
    out = out.replaceAll("{{ADDRESS}}", share.address);
  }
  return { text: out };
}

// ---------- Commitments ----------

const COMMIT = /\b(bekrefter jeg|jeg (bekrefter|bestiller|booker|tar (den|det|timen)|godtar|aksepterer|avbestiller|kansellerer|betaler)|det er (en )?avtale|legg (den |det )?inn|bare kjør|ja,? (takk,? )?(det|den) (tar jeg|blir bra|passer)|vi tar (den|det)|book(e)? (den|det))/i;

export function isCommitment(text: string): boolean {
  return COMMIT.test(text);
}

/** Callee is proposing something that would need a yes from the user. */
export function calleeProposesCommitment(text: string): boolean {
  return /(skal jeg (legge inn|booke|bestille|sette deg opp|reservere)|vil du ha (den|timen|det)|blir det \d|det (blir|koster) .*(kr|kroner)|passer (det|klokka|kl)|er det greit|kan du (komme|ta))/i.test(text);
}
