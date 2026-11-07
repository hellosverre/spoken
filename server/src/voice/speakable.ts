// Turns Norwegian text with digits into words before TTS, so prices, times and
// phone numbers are read clearly on a phone line ("189 kr" → "hundre og åttini kroner").

const ONES = ["null", "én", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni",
  "ti", "elleve", "tolv", "tretten", "fjorten", "femten", "seksten", "sytten", "atten", "nitten"];
const TENS = ["", "", "tjue", "tretti", "førti", "femti", "seksti", "sytti", "åtti", "nitti"];
const DIGIT = ["null", "en", "to", "tre", "fire", "fem", "seks", "sju", "åtte", "ni"];

export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n < 20) return n === 1 ? "en" : ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? (n % 10 === 1 ? "en" : ONES[n % 10]!) : "");
  if (n < 1000) {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    return (h === 1 ? "hundre" : `${ONES[h]} hundre`) + (rest ? ` og ${numberToWords(rest)}` : "");
  }
  if (n < 1_000_000) {
    const t = Math.floor(n / 1000);
    const rest = n % 1000;
    const head = t === 1 ? "tusen" : `${numberToWords(t)} tusen`;
    if (!rest) return head;
    return head + (rest < 100 ? " og " : " ") + numberToWords(rest);
  }
  return String(n).split("").map((d) => DIGIT[Number(d)]).join(" ");
}

function timeToWords(h: number, m: number): string {
  if (m === 0) return numberToWords(h);
  if (m < 10) return `${numberToWords(h)} null ${numberToWords(m)}`;
  return `${numberToWords(h)} ${numberToWords(m)}`;
}

export function toSpeakable(text: string): string {
  return text
    // 18:00 / 18.30 (times)
    .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, (_, h, m) => timeToWords(Number(h), Number(m)))
    // phone numbers and long digit runs (allow spaces) → digit by digit
    .replace(/\+?\d[\d ]{4,}\d/g, (s) => {
      const digits = s.replace(/\D/g, "");
      if (digits.length < 5) return s;
      return (s.startsWith("+") ? "pluss " : "") + digits.split("").map((d) => DIGIT[Number(d)]).join(" ");
    })
    // amounts with kr / ,-
    .replace(/(\d+)\s*(?:kr\.?|kroner|,-)/gi, (_, a) => `${numberToWords(Number(a))} kroner`)
    .replace(/\b(\d{1,6})\b/g, (_, a) => numberToWords(Number(a)))
    .replace(/\bkl\.\s*/gi, "klokka ")
    // "KI" gets read as a word by some models; spell it the Norwegian way.
    .replace(/\bKI\b/g, "kå-i")
    .replace(/\s{2,}/g, " ")
    .trim();
}
