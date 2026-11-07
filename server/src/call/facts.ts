// Fact strip: the price, time, address and reference number heard on the call, pinned above the
// transcript. Extraction is plain code (no LLM). A fact is «confirmed» only when a second source
// agrees: the batch STT heard the same, the callee said it twice, or said yes to our read-back.
import type { FactItem, FactKind } from "../../../shared/contract.ts";
import { parseTimes } from "../time.ts";

export interface FactCandidate { kind: FactKind; value: string }

const UNIT: Record<string, number> = {
  null: 0, en: 1, ett: 1, én: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10,
  elleve: 11, tolv: 12, tretten: 13, fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19,
  tjue: 20, tretti: 30, førti: 40, femti: 50, seksti: 60, sytti: 70, åtti: 80, nitti: 90,
  // English
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const TENS_PREFIX = ["tjue", "tretti", "førti", "femti", "seksti", "sytti", "åtti", "nitti"];
const ONES_SUFFIX: Record<string, number> = { en: 1, ett: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9 };

/** One number word, including compounds: «tjueen», «hundre», «nittini». */
function wordValue(w: string): number | undefined {
  if (w in UNIT) return UNIT[w];
  for (const t of TENS_PREFIX) {
    if (w.startsWith(t) && ONES_SUFFIX[w.slice(t.length)] !== undefined) return UNIT[t]! + ONES_SUFFIX[w.slice(t.length)]!;
  }
  return undefined;
}

/** «to hundre og femti» → 250, «tusen to hundre» → 1200; undefined if the words aren't a number. */
export function wordsToInt(words: string[]): number | undefined {
  let total = 0, cur = 0, seen = false;
  for (const raw of words) {
    const w = raw.toLowerCase();
    if (w === "og" || w === "and") continue;
    if (w === "hundre" || w === "hundred") { cur = (cur || 1) * 100; seen = true; continue; }
    if (w === "tusen" || w === "thousand") { total += (cur || 1) * 1000; cur = 0; seen = true; continue; }
    const v = wordValue(w);
    if (v === undefined) return undefined;
    cur += v;
    seen = true;
  }
  return seen ? total + cur : undefined;
}

const CUR = "(?:kr\\.?|kroner|krone|nok|,-|kronor|crowns?)";
const NUM_WORD = "[a-zæøåéA-ZÆØÅ]+";

function prices(text: string): string[] {
  const out: string[] = [];
  // 250 kr · 1 250 kroner · 250,- · kr 250
  for (const m of text.matchAll(new RegExp(`(?<![\\d.,:])(\\d{1,3}(?:[ \\u00a0]\\d{3})+|\\d+)(?:[.,]\\d{1,2})?\\s*${CUR}(?![\\p{L}])`, "giu"))) {
    out.push(`${Number(m[1]!.replace(/[\s ]/g, ""))} kr`);
  }
  for (const m of text.matchAll(/\b(?:kr\.?|nok)\s*(\d+)\b/gi)) out.push(`${Number(m[1])} kr`);
  // spelled out: «to hundre og femti kroner»
  for (const m of text.matchAll(new RegExp(`((?:${NUM_WORD}\\s+){1,5}?)${CUR}(?![\\p{L}])`, "giu"))) {
    const words = m[1]!.trim().split(/\s+/);
    // Longest tail of the words that is a number: «det blir to hundre og femti kroner».
    for (let i = 0; i < words.length; i++) {
      const v = wordsToInt(words.slice(i));
      if (v !== undefined && v > 0) { out.push(`${v} kr`); break; }
    }
  }
  return out;
}

const WEEKDAY = "mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag|monday|tuesday|wednesday|thursday|friday|saturday|sunday";
const MONTH = "januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember|january|february|march|may|june|july|october|december";

function times(text: string): string[] {
  const out: string[] = [];
  for (const p of parseTimes(text)) if (p.kind === "time") out.push(`kl. ${p.hhmm}`);
  const day = text.match(new RegExp(`\\b(i dag|i morgen|i overmorgen|today|tomorrow|(?:på )?(?:${WEEKDAY})|\\d{1,2}\\.\\s?(?:${MONTH})|(?:${MONTH})\\s\\d{1,2})\\b`, "i"));
  // A bare day with no time stays out: «i morgen» alone isn't an agreed time.
  if (day && out.length) out[0] = `${day[1]!.replace(/^på /i, "").toLowerCase()} ${out[0]}`;
  return out;
}

const STREET = "(?:[A-ZÆØÅ][\\p{L}'-]*(?:\\s[A-ZÆØÅ][\\p{L}'-]*)?)\\s?(?:gate|gata|gaten|veien|vei|vegen|veg|allé|alle|plass|plassen|torg|torget|bakken|stien|gaten|street|road|avenue)";

function addresses(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b(${STREET})s?\\s+(\\d{1,3}\\s?[A-Za-z]?)\\b(?:,?\\s*(\\d{4}\\s+[A-ZÆØÅ][\\p{L}-]+))?`, "gu"))) {
    out.push([m[1]!.replace(/\s+/g, " "), m[2]!.replace(/\s/g, ""), m[3] ? `, ${m[3]}` : ""].join(" ").replace(" ,", ",").replace(/\s+/g, " ").trim());
  }
  return out;
}

const REF_LABEL = "(?:referansenummer|referanse|referansen|bestillingsnummeret|bestillingsnummer|ordrenummeret|ordrenummer|ordrenr\\.?|bestillingsnr\\.?|bookingnummer|bookingreferanse|reference(?: number)?|order(?: number)?|confirmation(?: number| code)?|booking(?: number| ref(?:erence)?)?|ref\\.?|kode|koden)";

function refs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`\\b${REF_LABEL}\\s*(?:er|is|:|#|nummer)?\\s*(?:nummer\\s+)?([A-Za-z]{0,3}[- ]?\\d[\\d -]{1,10}\\d|[A-Za-z]{1,3}-?\\d{2,8}|\\d{3,10})\\b`, "giu"))) {
    const v = m[1]!.replace(/[\s]+/g, "").toUpperCase();
    if (v.replace(/\D/g, "").length >= 3) out.push(v);
  }
  return out;
}

/** Every price, time, address and reference number in one sentence, in the order they appear per kind. */
export function extractFacts(text: string): FactCandidate[] {
  const clean = text.replace(/\s*⟨[^⟩]*⟩/g, "");
  const found: FactCandidate[] = [
    ...prices(clean).map((value) => ({ kind: "price" as const, value })),
    ...times(clean).map((value) => ({ kind: "time" as const, value })),
    ...addresses(clean).map((value) => ({ kind: "address" as const, value })),
    ...refs(clean).map((value) => ({ kind: "ref" as const, value })),
  ];
  const seen = new Set<string>();
  return found.filter((f) => { const k = `${f.kind}|${f.value}`; return seen.has(k) ? false : (seen.add(k), true); });
}

const YES = /^\W*(ja|jo|jepp|stemmer|det stemmer|riktig|korrekt|nettopp|helt riktig|yes|yeah|correct|that's right|right|exactly)\b/i;
export const isYes = (t: string) => YES.test(t.trim());

const MAX_ITEMS = 6;
const key = (f: FactCandidate) => `${f.kind}|${f.value.toLowerCase().replace(/\s/g, "")}`;

interface Entry { kind: FactKind; value: string; confirmed: boolean; segs: Set<string> }

/**
 * Collects facts over a call. Callee segments are tracked by id so a batch revision replaces what
 * the realtime line said; agent lines are read-backs: «yes» from the callee confirms them.
 */
export class FactTracker {
  private entries = new Map<string, Entry>();
  private segFacts = new Map<string, string[]>(); // callee segment id → entry keys
  private revisedSegs = new Set<string>();
  private text = new Map<string, string>(); // callee segment id → last text
  private readBack: string[] = []; // entry keys the agent just repeated
  private snapshot = "";

  /** Feed one final transcript line. Returns the new item list if it changed, else undefined. */
  observe(who: "callee" | "agent", id: string, text: string): FactItem[] | undefined {
    if (who === "agent") { this.agentLine(text); return this.changed(); }
    const prev = this.text.get(id);
    if (prev === text) return undefined;
    if (prev !== undefined) { this.revisedSegs.add(id); this.dropSeg(id); } // revised or re-emitted with new words
    this.text.set(id, text);
    const facts = extractFacts(text);
    const keys: string[] = [];
    for (const f of facts) {
      const k = key(f);
      let e = this.entries.get(k);
      if (!e) { e = { kind: f.kind, value: f.value, confirmed: false, segs: new Set() }; this.entries.set(k, e); }
      // The callee said it in a second, separate segment: that is a repeat.
      else if (e.segs.size && !e.segs.has(id)) e.confirmed = true;
      e.segs.add(id);
      keys.push(k);
    }
    this.segFacts.set(id, keys);
    // A bare «ja» after our read-back confirms what we read back.
    if (!facts.length && isYes(text)) for (const k of this.readBack) { const e = this.entries.get(k); if (e) e.confirmed = true; }
    if (text.trim()) this.readBack = [];
    return this.changed();
  }

  /** Batch STT finished segment `id` and agreed with realtime (no revision came): second source. */
  batchAgrees(id: string): FactItem[] | undefined {
    if (this.revisedSegs.has(id)) return undefined;
    for (const k of this.segFacts.get(id) ?? []) { const e = this.entries.get(k); if (e) e.confirmed = true; }
    return this.changed();
  }

  /** The segment was noise: its facts never happened. */
  drop(id: string): FactItem[] | undefined {
    this.dropSeg(id);
    this.text.delete(id);
    return this.changed();
  }

  items(): FactItem[] {
    return [...this.entries.values()].slice(-MAX_ITEMS).map(({ kind, value, confirmed }) => ({ kind, value, confirmed }));
  }

  private agentLine(text: string) {
    // The agent repeating something the callee said is a read-back; the callee's «ja» comes next.
    this.readBack = extractFacts(text).map(key).filter((k) => this.entries.has(k));
  }

  private dropSeg(id: string) {
    for (const k of this.segFacts.get(id) ?? []) {
      const e = this.entries.get(k);
      if (!e) continue;
      e.segs.delete(id);
      if (!e.segs.size) this.entries.delete(k);
    }
    this.segFacts.delete(id);
  }

  private changed(): FactItem[] | undefined {
    const items = this.items();
    const s = JSON.stringify(items);
    if (s === this.snapshot) return undefined;
    this.snapshot = s;
    return items;
  }
}
