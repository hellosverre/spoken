// Turns text with digits into words before TTS (Norwegian and English), so prices, times, dates and
// phone numbers are read clearly on a phone line ("249 kr" → "to hundre og førtini kroner",
// "22 22 55 55" → "tjueto, tjueto, femtifem, femtifem", "18:30" → "halv sju").

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

const HOUR_WORD = (h: number) => (h === 1 ? "ett" : numberToWords(h));
const h12 = (h: number) => h % 12 || 12;

/** Natural spoken Norwegian clock time: «halv sju», «kvart over åtte», «atten tjue». */
export function timeToWords(h: number, m: number): string {
  if (m === 0) return numberToWords(h);
  if (m === 30) return `halv ${HOUR_WORD(h12(h + 1))}`;
  if (m === 15) return `kvart over ${HOUR_WORD(h12(h))}`;
  if (m === 45) return `kvart på ${HOUR_WORD(h12(h + 1))}`;
  if (m < 10) return `${numberToWords(h)} null ${numberToWords(m)}`;
  return `${numberToWords(h)} ${numberToWords(m)}`;
}

const ORD_NO = ["", "første", "andre", "tredje", "fjerde", "femte", "sjette", "sjuende", "åttende", "niende", "tiende",
  "ellevte", "tolvte", "trettende", "fjortende", "femtende", "sekstende", "syttende", "attende", "nittende", "tjuende",
  "tjueførste", "tjueandre", "tjuetredje", "tjuefjerde", "tjuefemte", "tjuesjette", "tjuesjuende", "tjueåttende",
  "tjueniende", "trettiende", "trettiførste"];
const MONTHS_NO = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember"];

/** Digit by digit («9123» → «ni en to tre»): for matching what was said against a number. */
export const digitWords = (digits: string) => digits.split("").map((d) => DIGIT[Number(d)]).join(" ");

/** Two digits at a time; a leading 0 is spoken («05» → «null fem»). */
function pairs(digits: string): string {
  const out: string[] = [];
  let i = 0;
  if (digits.length % 2) { out.push(DIGIT[Number(digits[0])]!); i = 1; }
  for (; i < digits.length; i += 2) {
    const p = digits.slice(i, i + 2);
    out.push(p[0] === "0" ? `null ${DIGIT[Number(p[1])]}` : numberToWords(Number(p)));
  }
  return out.join(", ");
}

const intOf = (s: string) => Number(s.replace(/\s/g, ""));
const MONTH_RE = MONTHS_NO.join("|");

function toSpeakableNo(text: string): string {
  return text
    // 12.11.2026 / 12/11/26 (dates) before times, which also use «.»
    .replace(/\b(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](\d{4}|\d{2})\b/g, (_, d, mo, y) =>
      `${ORD_NO[Number(d)]} ${MONTHS_NO[Number(mo) - 1]} ${numberToWords(y.length === 2 ? 2000 + Number(y) : Number(y))}`)
    // «12. november»
    .replace(new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\.?\\s+(${MONTH_RE})\\b`, "gi"), (_, d, mo) => `${ORD_NO[Number(d)]} ${mo}`)
    // amounts: 249,50 kr / 1 249 kr / 249,- / 249 kroner
    .replace(/(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{2}))?\s*(?:kr\.?|kroner|,-|NOK)(?![\p{L}])/giu, (_, a, ore) => {
      const k = intOf(a);
      return `${numberToWords(k)} ${k === 1 && !ore ? "krone" : "kroner"}${ore && ore !== "00" ? ` og ${numberToWords(Number(ore))} øre` : ""}`;
    })
    // 18:00 / 18.30 (times)
    .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/g, (_, h, m) => timeToWords(Number(h), Number(m)))
    // phone numbers and long digit runs (allow spaces) → in pairs
    .replace(/\+?\d[\d ]{4,}\d/g, (s) => {
      let digits = s.replace(/\D/g, "");
      if (digits.length < 5) return s;
      let prefix = "";
      if (s.startsWith("+")) {
        const cc = digits.startsWith("47") ? "47" : digits.slice(0, 2);
        prefix = `pluss ${pairs(cc)}, `;
        digits = digits.slice(cc.length);
      }
      return prefix + pairs(digits);
    })
    .replace(/\b(\d{1,6})\b/g, (_, a) => numberToWords(Number(a)))
    .replace(/\bkl\.\s*/gi, "klokka ")
    // "KI" gets read as a word by some models; spell it the Norwegian way.
    .replace(/\bKI\b/g, "kå-i")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ---- English ----
const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

export function numberToWordsEn(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n < 20) return EN_ONES[n]!;
  if (n < 100) return EN_TENS[Math.floor(n / 10)]! + (n % 10 ? ` ${EN_ONES[n % 10]}` : "");
  if (n < 1000) return `${EN_ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberToWordsEn(n % 100)}` : ""}`;
  if (n < 1_000_000) return `${numberToWordsEn(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${numberToWordsEn(n % 1000)}` : ""}`;
  return String(n).split("").map((d) => EN_ONES[Number(d)]).join(" ");
}

const ORD_EN_IRR: Record<number, string> = { 1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth", 9: "ninth", 12: "twelfth", 20: "twentieth", 30: "thirtieth" };
function ordinalEn(n: number): string {
  if (ORD_EN_IRR[n]) return ORD_EN_IRR[n]!;
  if (n < 20) return `${EN_ONES[n]}th`;
  const t = Math.floor(n / 10) * 10;
  return `${EN_TENS[t / 10]} ${ordinalEn(n % 10)}`;
}
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function timeToWordsEn(h: number, m: number, ampm?: string): string {
  const base = ampm ? h : h12(h);
  const suffix = ampm ? ` ${ampm.toLowerCase().replace(/\./g, "").split("").join(" ")}` : "";
  if (m === 0) return ampm ? `${numberToWordsEn(base)}${suffix}` : `${numberToWordsEn(base)}${h === 0 || h === 12 ? "" : " o'clock"}`;
  return `${numberToWordsEn(base)} ${m < 10 ? `oh ${numberToWordsEn(m)}` : numberToWordsEn(m)}${suffix}`;
}

function digitsEn(d: string): string {
  return d.split("").map((x) => EN_ONES[Number(x)]).join(" ");
}

function toSpeakableEn(text: string): string {
  return text
    // 12 November / November 12th
    .replace(new RegExp(`\\b(${MONTHS_EN.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "gi"), (_, mo, d) => `${mo} ${ordinalEn(Number(d))}`)
    .replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS_EN.join("|")})\\b`, "gi"), (_, d, mo) => `${ordinalEn(Number(d))} ${mo}`)
    // prices: $249 / 249 kr / 249 NOK / 249.50 kr
    .replace(/\$(\d+)(?:\.(\d{2}))?/g, (_, a, c) => `${numberToWordsEn(Number(a))} dollars${c && c !== "00" ? ` and ${numberToWordsEn(Number(c))} cents` : ""}`)
    .replace(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\s*(?:kr\.?|kroner|NOK)(?![\p{L}])/giu, (_, a, ore) => {
      const k = Number(a.replace(/,/g, ""));
      return `${numberToWordsEn(k)} ${k === 1 ? "krone" : "kroner"}${ore && ore !== "00" ? ` and ${numberToWordsEn(Number(ore))} øre` : ""}`;
    })
    // 6:30 pm / 18:30 / 6 pm
    .replace(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?(?![\p{L}])/giu, (_, h, m, ap) => timeToWordsEn(Number(h), Number(m ?? 0), `${ap}m`))
    .replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (_, h, m) => timeToWordsEn(Number(h), Number(m)))
    // phone numbers: digit by digit, grouped by the way they were written
    .replace(/\+?\d[\d ()-]{4,}\d/g, (s) => {
      const digits = s.replace(/\D/g, "");
      if (digits.length < 5) return s;
      const groups = s.replace(/^\+/, "").split(/[ ()-]+/).filter(Boolean);
      return (s.startsWith("+") ? "plus " : "") + groups.map(digitsEn).join(", ");
    })
    .replace(/\b(\d{1,3}(?:,\d{3})+|\d{1,6})\b/g, (_, a) => numberToWordsEn(Number(a.replace(/,/g, ""))))
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Digits → words for TTS. Norwegian and English are handled; other languages pass through. */
export function toSpeakable(text: string, lang: string = "no"): string {
  if (lang === "no") return toSpeakableNo(text);
  if (lang === "en") return toSpeakableEn(text);
  return text;
}
