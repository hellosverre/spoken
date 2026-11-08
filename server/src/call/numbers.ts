// Norwegian -ten / -ti numbers sound alike on a phone line: femten/femti, sytten/sytti,
// atten/åtti … Scribe heard «femti» as «15.» on call c_28dd2d9a6285. When the STT is unsure
// of such a number, the LLM gets both readings and asks which one.
import type { Word } from "../../../shared/contract.ts";

const WORD: Record<string, number> = {
  tretten: 13, fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19,
  tretti: 30, førti: 40, femti: 50, seksti: 60, sytti: 70, åtti: 80, nitti: 90,
  // English has the same trap: fifteen / fifty.
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const ANY_NUMBER = /^(\d[\d:.,]*|null|en|ett|ei|to|tre|fire|fem|seks|sju|syv|åtte|ni|ti|elleve|tolv|hundre|tusen|kroner|kr|klokka|halv|kvart|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|half|quarter|o'?clock|pm|am)$/i;

/** An unsure word that is (part of) a number, price or time: worth waiting for the batch check. */
export function isNumberish(token: string): boolean {
  const t = token.toLowerCase().replace(/^[«"(]+|[.,!?»")]+$/g, "");
  return ANY_NUMBER.test(t) || WORD[t] !== undefined;
}

/** The number a -ten/-ti number is easily misheard as: 15 → 50, 150 → 115, 70 → 17. */
export function soundAlike(n: number): number | undefined {
  if (!Number.isInteger(n) || n < 13) return undefined;
  const r = n % 100;
  if (r >= 13 && r <= 19) return n - r + (r - 10) * 10;
  if (r >= 30 && r % 10 === 0) return n - r + 10 + r / 10;
  return undefined;
}

/** A plain integer or a -ten/-ti word; times («12.17», «18:30») and decimals are left out. */
function numberOf(token: string): number | undefined {
  const t = token.toLowerCase().replace(/^[«"(]+|[.,!?»")]+$/g, "");
  if (/^\d+$/.test(t)) return Number(t);
  return WORD[t];
}

/** Numbers the STT gave below this confidence get a «heard X or Y» hint (c_28dd: «15.» at 0.41). */
const NUMBER_SURE = Number(process.env.NUMBER_SURE ?? 0.45); // 0.8 asked «15 eller 50» far too often on clear lines

/** «⟨uklart tall: 15 eller 50⟩» for each unsure -ten/-ti number in the line, or "". */
export function numberHint(words: Word[]): string {
  const out: string[] = [];
  for (const [i, w] of words.entries()) {
    if (w.confidence >= NUMBER_SURE) continue;
    // «klokka atten»: a clock time, and 80 isn't one (c_5b26 asked «atten eller åtti?»).
    if (i > 0 && /^(klokka|klokken|kl)\.?$/i.test(words[i - 1]!.text.replace(/[,!?]$/, ""))) continue;
    const n = numberOf(w.text);
    const alt = n === undefined ? undefined : soundAlike(n);
    if (n !== undefined && alt !== undefined) out.push(`⟨uklart tall: ${n} eller ${alt}⟩`);
  }
  return [...new Set(out)].join(" ");
}
