// Norwegian time expressions → HH:MM, in code. The LLM only phrases times; it never computes
// them (call #5: «en time etter tolv på natta» became 00:30, «25:00» was half-accepted).

export type TimeParse =
  | { kind: "time"; hhmm: string; raw: string }
  | { kind: "ambiguous"; candidates: string[]; raw: string }
  | { kind: "invalid"; raw: string; reason: string };

const NUM: Record<string, number> = {
  null: 0, en: 1, ett: 1, én: 1, eitt: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, sju: 7, syv: 7, åtte: 8, ni: 9, ti: 10,
  elleve: 11, tolv: 12, tretten: 13, fjorten: 14, femten: 15, seksten: 16, sytten: 17, atten: 18, nitten: 19, tjue: 20,
  tjueen: 21, tjueto: 22, tjuetre: 23, tjuefire: 24, tjuefem: 25, tjueseks: 26, tretti: 30, førti: 40, femti: 50,
};
const W = Object.keys(NUM).sort((a, b) => b.length - a.length).join("|");
const n = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM[s.toLowerCase()]);
const pad = (x: number) => String(x).padStart(2, "0");

/** Morning/evening hints in the sentence decide 12-hour readings. */
function dayPart(text: string): "am" | "pm" | null {
  if (/\b(i kveld|på kvelden|kveld|ettermiddag(en)?|i ettermiddag|middag)\b/i.test(text)) return "pm";
  if (/\b(i morgen tidlig|om morgenen|morgen(en)?|formiddag(en)?|på natta|om natta|natt)\b/i.test(text)) return "am";
  return null;
}

function resolve(h: number, m: number, text: string, raw: string, explicit24: boolean): TimeParse {
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return { kind: "invalid", raw, reason: `${pad(h)}:${pad(m)} finnes ikke` };
  if (h === 24) h = 0;
  if (explicit24 || h === 0 || h >= 13) return { kind: "time", hhmm: `${pad(h)}:${pad(m)}`, raw };
  const part = dayPart(text);
  if (part === "pm") return { kind: "time", hhmm: `${pad(h === 12 ? 12 : h + 12)}:${pad(m)}`, raw };
  if (part === "am") return { kind: "time", hhmm: `${pad(h === 12 ? 0 : h)}:${pad(m)}`, raw };
  if (h === 12) return { kind: "time", hhmm: `12:${pad(m)}`, raw };
  return { kind: "ambiguous", candidates: [`${pad(h)}:${pad(m)}`, `${pad(h + 12)}:${pad(m)}`], raw };
}

/** All time expressions in a sentence, in order. */
export function parseTimes(text: string): TimeParse[] {
  const out: TimeParse[] = [];
  const t = text.toLowerCase();
  const taken: [number, number][] = [];
  const add = (i: number, len: number, p: TimeParse) => {
    if (taken.some(([a, b]) => i < b && i + len > a)) return;
    taken.push([i, i + len]);
    out.push(p);
  };
  let m: RegExpExecArray | null;

  // 18:00, 18.30, 25:00, "tjuefem null null"
  const digital = /\b(\d{1,2})[:.](\d{2})\b/g;
  while ((m = digital.exec(t))) add(m.index, m[0].length, resolve(+m[1]!, +m[2]!, t, m[0], +m[1]! >= 13 || m[1]!.length === 2 && m[1]![0] === "0"));
  const spokenDigital = new RegExp(`\\b(${W}) null null\\b`, "g");
  while ((m = spokenDigital.exec(t))) add(m.index, m[0].length, resolve(n(m[1]!)!, 0, t, m[0], true));

  // "en time etter tolv" → 13:00/01:00
  const after = new RegExp(`\\b(en|to|tre|\\d) timer? etter (${W}|\\d{1,2})\\b`, "g");
  while ((m = after.exec(t))) {
    const base = n(m[2]!)!, plus = n(m[1]!)!;
    // On a 12-hour clock face: «en time etter tolv» is one o'clock; day part decides 01 vs 13.
    const h = base <= 12 ? ((base + plus - 1) % 12) + 1 : (base + plus) % 24;
    add(m.index, m[0].length, resolve(h, 0, t, m[0], base > 12));
  }
  // "mellom tolv og ett" → a range, not a time
  const between = new RegExp(`\\bmellom (${W}|\\d{1,2}) og (${W}|\\d{1,2})\\b`, "g");
  while ((m = between.exec(t))) add(m.index, m[0].length, { kind: "ambiguous", candidates: [], raw: m[0] });

  // halv sju = 6:30, kvart over/på, "ti over fem", "fem på halv"
  const half = new RegExp(`\\b(?:(fem|ti) (over|på) )?halv (${W}|\\d{1,2})\\b`, "g");
  while ((m = half.exec(t))) {
    const h = (n(m[3]!)! + 23) % 24;
    const off = m[1] ? (m[2] === "over" ? 1 : -1) * n(m[1])! : 0;
    add(m.index, m[0].length, resolve(h, 30 + off, t, m[0], false));
  }
  const quarter = new RegExp(`\\b(kvart|${W}|\\d{1,2}) (over|på) (${W}|\\d{1,2})\\b`, "g");
  while ((m = quarter.exec(t))) {
    const mins = m[1] === "kvart" ? 15 : n(m[1]!)!;
    let h = n(m[3]!)!;
    if (mins === undefined || h === undefined || mins >= 30) continue;
    let mm = m[2] === "over" ? mins : 60 - mins;
    if (m[2] === "på") h = (h + 23) % 24;
    add(m.index, m[0].length, resolve(h, mm, t, m[0], false));
  }

  // klokka seks / kl 18 / klokken 7
  const clock = new RegExp(`\\b(?:klokka|klokken|kl\\.?) (${W}|\\d{1,2})\\b`, "g");
  while ((m = clock.exec(t))) {
    const h = n(m[1]!);
    if (h !== undefined) add(m.index, m[0].length, resolve(h, 0, t, m[0], /^\d{2}$/.test(m[1]!) && h >= 13));
  }
  return out;
}

/** Hint appended to a callee line for the LLM, e.g. «⟨tid: 19:00⟩», «⟨ugyldig tid: 25:00⟩». */
export function timeHint(text: string): string {
  const ps = parseTimes(text);
  if (!ps.length) return "";
  return ps.map((p) =>
    p.kind === "time" ? `⟨tid: ${p.hhmm}⟩`
      : p.kind === "invalid" ? `⟨ugyldig tid: «${p.raw}» (${p.reason})⟩`
        : `⟨uklar tid: «${p.raw}»${p.candidates.length ? ` (${p.candidates.join(" eller ")})` : ""}⟩`).join(" ");
}

/** HH:MM values the agent may say: from the plan, the callee and the user. */
export function timesIn(text: string): string[] {
  return parseTimes(text).flatMap((p) => (p.kind === "time" ? [p.hhmm] : p.kind === "ambiguous" ? p.candidates : []));
}

/** The sentence with its times taken out: «… til henting halv sju.» → «… til henting.»
 *  Only times that end the sentence; "" when a time sits mid-sentence (cutting it would garble it). */
export function withoutTimes(text: string): string {
  let t = text;
  for (const p of parseTimes(text)) {
    const re = new RegExp(p.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?=\\s*([.!?]|$))", "i");
    if (!re.test(t)) return "";
    t = t.replace(re, "");
  }
  return t
    .replace(/(?:\s+(?:til|kl\.?|klokka|klokken|rundt|ca\.?|ved|på))*\s*([.,!?]|$)/gi, "$1")
    .replace(/\s{2,}/g, " ").replace(/\s+([.,!?])/g, "$1").trim();
}
