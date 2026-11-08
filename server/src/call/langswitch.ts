// Detects the callee's language per committed segment and decides when the call should switch.
// Detection is a stopword vote (deterministic, free, no extra LLM call per segment): Scribe is
// connected with language_code for no/en, so its own «detected language» field only echoes the
// code we set and cannot be used as the signal.
import type { Lang } from "../../../shared/contract.ts";

const WORDS: Record<string, string> = {
  en: "the and you your is are was were that this with for have has not what can could would will please yes thank thanks hello hi i'm i'd it's we they there here which when where how about from just like want need order book appointment",
  no: "jeg du han hun vi dere ikke og er var det som med for har har kan vil skal til fra på en et av om hva hvor når hei takk ja nei bare også men så må vær hos denne deg meg oss",
  sv: "jag och inte är det att som med för har kan vill ska till från på ett av om vad hur när hej tack ja nej bara också men så måste vara hos den dig mig oss",
  de: "ich du sie er wir und nicht ist sind war das der die den dem ein eine mit für haben hat kann will bitte danke ja nein hallo guten tag wie was wann wo auch aber noch nur bei von zu",
  fr: "je tu il elle nous vous ils et pas est sont était le la les un une des du de avec pour avoir a peut veut bonjour merci oui non salut comment quoi quand où aussi mais encore seulement chez que qui dans",
  es: "yo tú usted él ella nosotros y no es son era el la los las un una con para tener tiene puede quiere por favor gracias sí hola buenos días cómo qué cuándo dónde también pero solo de que en",
  it: "io tu lei lui noi e non è sono era il lo la gli le un una con per avere ha può vuole prego grazie sì ciao buongiorno come cosa quando dove anche ma solo di che in",
  nl: "ik jij u hij zij wij en niet is zijn was de het een met voor hebben heeft kan wil alstublieft dank ja nee hallo goedemorgen hoe wat wanneer waar ook maar nog alleen bij van naar",
  pl: "ja ty pan pani on ona my i nie jest są był to ten ta tym z dla mieć ma może chce proszę dziękuję tak cześć dzień dobry jak co kiedy gdzie też ale tylko u od do na się że w",
  pt: "eu tu você ele ela nós e não é são era o a os as um uma com para ter tem pode quer por favor obrigado sim olá bom dia como quê quando onde também mas só de que em",
};

const SETS = Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, new Set(v.split(" "))])) as Record<string, Set<string>>;

// Words that appear in several languages' lists above but carry no evidence for any one of them.
const SHARED = new Set(["a", "i", "e", "o", "en", "de", "la", "le", "un", "no", "es", "ja", "me", "an", "hi"]);

const tokens = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);

export interface Detection {
  lang: string | null; // null = not enough evidence (names, single words, brands)
  words: number;
  hits: number;
}

/** Which language a segment is in, or null when the evidence is thin or ambiguous. */
export function detectLang(text: string): Detection {
  const ws = tokens(text);
  const scores: [string, number][] = Object.entries(SETS).map(([lang, set]) => [
    lang,
    ws.filter((w) => set.has(w) && !(SHARED.has(w) && ws.length < 4)).length,
  ]);
  scores.sort((a, b) => b[1] - a[1]);
  const [best, hits] = scores[0]!;
  const second = scores[1]![1];
  const sure = hits >= 2 && hits >= second * 2 && hits / ws.length >= 0.2;
  return { lang: sure ? best : null, words: ws.length, hits };
}

/**
 * Switch rule: two consecutive callee segments confidently in the same other language, or one
 * segment of ≥6 words. A segment in the current language, or an unclear one with enough words to
 * judge, resets the streak; tiny/unclear segments («Ja.», a brand name) leave it alone.
 */
const ISO3: Record<string, string> = { nor: "no", nob: "no", nno: "no", nb: "no", nn: "no", eng: "en", swe: "sv", deu: "de", ger: "de", fra: "fr", fre: "fr", spa: "es", ita: "it", nld: "nl", dut: "nl", pol: "pl", por: "pt" };

/** Scribe's language code («no», «nob», «en-US») as our two-letter code. */
export function normalizeLangCode(code: string): string {
  const c = code.toLowerCase().split(/[-_]/)[0]!;
  return ISO3[c] ?? c;
}

const norm = (t: string) => tokens(t).join(" ");

export class LangSwitcher {
  private pending: string | null = null;
  /** Segment already judged, so the second signal (text vs. Scribe detection) for it isn't counted twice. */
  private handled = "";
  private handledSure = false;

  constructor(private current: Lang, private onSwitch: (lang: Lang, from: Lang) => void, private longWords = 6) {}

  get lang() { return this.current; }

  /** The language was changed from outside (user instruction). */
  set(lang: Lang) { this.current = lang; this.pending = null; }

  /**
   * Scribe's audio-based language detection for a committed segment: the primary signal. It arrives just
   * after the text, so the text heuristic (feed) has usually run: only count this when that one was unsure.
   */
  feedDetected(code: string, text: string): Lang | undefined {
    const lang = normalizeLangCode(code);
    const n = norm(text);
    if (!lang || n.split(" ").length < 2) return undefined; // «Ja.»: too little to trust either way
    if (this.handled === n && this.handledSure) return undefined;
    this.handled = n;
    this.handledSure = true;
    return this.judge(lang, n.split(" ").length);
  }

  /** Fallback: stopword vote on the text. */
  feed(text: string): Lang | undefined {
    const d = detectLang(text);
    const n = norm(text);
    if (this.handled === n && this.handledSure) return undefined; // detection already decided this one
    this.handled = n;
    this.handledSure = d.lang !== null;
    if (d.lang === null) {
      if (d.words >= 4) this.pending = null;
      return undefined;
    }
    return this.judge(d.lang, d.words);
  }

  private judge(lang: string, words: number): Lang | undefined {
    const d = { lang, words };
    if (d.lang === this.current) { this.pending = null; return undefined; }
    if (d.words >= this.longWords || this.pending === d.lang) {
      const from = this.current;
      this.current = d.lang;
      this.pending = null;
      this.onSwitch(d.lang, from);
      return d.lang;
    }
    this.pending = d.lang;
    return undefined;
  }
}
