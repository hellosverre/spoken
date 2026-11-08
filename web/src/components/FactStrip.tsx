"use client";

import { useSyncExternalStore } from "react";
import { useState, useEffect, useRef } from "react";
import { useSpoken, useStore } from "@/lib/use-spoken";

// The facts that matter on a call (price, time, date, address, phone, reference), pinned above the
// transcript so they never scroll away. ✓ = a second source agrees (batch STT, a repeat, or a yes).
// Every chip is a button: copy, add to calendar (.ics), open in maps; phone chips can also start a call request.
// Wire types from shared/contract.ts, kept local so the Next build doesn't reach outside web/.
export type FactKind = "price" | "time" | "address" | "ref" | "phone" | "date" | "name";
export interface FactItem { kind: FactKind; value: string; confirmed: boolean }

let items: FactItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** Called by the live-call socket with the full list each time it changes. */
export function setFacts(next: FactItem[]) { items = next; emit(); }
export function getFacts() { return items; }
export function resetFacts() { if (items.length) setFacts([]); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => items;
const empty: FactItem[] = [];

const COPY = {
  no: {
    group: "Viktige opplysninger fra samtalen",
    kind: { price: "Pris", time: "Tid", date: "Dato", address: "Adresse", ref: "Referanse", phone: "Telefon", name: "Navn" },
    ok: "dobbeltsjekket", un: "ikke bekreftet ennå",
    act: { copy: "trykk for å kopiere", cal: "trykk for å legge i kalender", map: "trykk for å åpne i kart" },
    copied: "Kopiert", calAdded: "Kalenderfil lastet ned", call: "Ring dette nummeret", callReq: "Ring",
    event: "Avtale", callText: (n: string) => `Ring ${n}`,
  },
  en: {
    group: "Key facts from the call",
    kind: { price: "Price", time: "Time", date: "Date", address: "Address", ref: "Reference", phone: "Phone", name: "Name" },
    ok: "double-checked", un: "not confirmed yet",
    act: { copy: "tap to copy", cal: "tap to add to calendar", map: "tap to open in maps" },
    copied: "Copied", calAdded: "Calendar file downloaded", call: "Call this number", callReq: "Call",
    event: "Appointment", callText: (n: string) => `Call ${n}`,
  },
} as const;

const TONE: Record<FactKind, [fg: string, bg: string]> = {
  price: ["var(--amber)", "var(--amber-bg)"], time: ["var(--sky)", "var(--sky-bg)"], date: ["var(--sky)", "var(--sky-bg)"],
  address: ["var(--violet)", "var(--violet-bg)"], ref: ["var(--teal)", "var(--teal-bg)"],
  phone: ["var(--accent)", "var(--accent-soft)"], name: ["var(--line-2)", "transparent"],
};

type Action = "copy" | "cal" | "map";
const actionOf = (k: FactKind): Action => (k === "time" || k === "date" ? "cal" : k === "address" ? "map" : "copy");

// ---- calendar -------------------------------------------------------------------------------
const WEEKDAYS = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["januar", "februar", "mars", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "desember", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** «i morgen kl. 14:30» / «fredag» / «14. mars» → a local date (+ optional hh:mm). Undefined if no day is named. */
export function parseWhen(value: string, now = new Date()): { date?: Date; hh?: number; mm?: number } {
  const v = value.toLowerCase();
  const tm = v.match(/(\d{1,2})[:.](\d{2})/);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let date: Date | undefined;
  if (/i overmorgen/.test(v)) date = new Date(base.getTime() + 2 * 864e5);
  else if (/i morgen|tomorrow/.test(v)) date = new Date(base.getTime() + 864e5);
  else if (/i dag|today/.test(v)) date = base;
  else {
    const wd = WEEKDAYS.findIndex((w) => v.includes(w));
    const dm = v.match(new RegExp(`(\\d{1,2})\\.?\\s?(${MONTHS.join("|")})|(${MONTHS.join("|")})\\s(\\d{1,2})`));
    if (dm) {
      const mi = MONTHS.indexOf((dm[2] ?? dm[3])!) % 12, day = Number(dm[1] ?? dm[4]);
      date = new Date(base.getFullYear(), mi, day);
      if (date < base) date.setFullYear(date.getFullYear() + 1);
    } else if (wd >= 0) {
      const diff = ((wd % 7) - base.getDay() + 7) % 7;
      date = new Date(base.getTime() + (diff || 7) * 864e5);
    }
  }
  return { date, hh: tm ? Number(tm[1]) : undefined, mm: tm ? Number(tm[2]) : undefined };
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

/** An .ics with one event. A bare time borrows the date from a date chip on the strip, else today. */
export function buildIcs(item: FactItem, list: FactItem[], title: string, now = new Date()): string {
  const w = parseWhen(item.value, now);
  const sibling = !w.date ? list.map((f) => (f.kind === "date" ? parseWhen(f.value, now).date : undefined)).find(Boolean) : undefined;
  const sibTime = item.kind === "date" ? list.map((f) => (f.kind === "time" ? parseWhen(f.value, now) : undefined)).find((x) => x?.hh !== undefined) : undefined;
  const date = w.date ?? sibling ?? new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const hh = w.hh ?? sibTime?.hh, mm = w.mm ?? sibTime?.mm;
  const stamp = `${ymd(now)}T${pad(now.getHours())}${pad(now.getMinutes())}00`;
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Spoken//Fact strip//EN", "BEGIN:VEVENT", `UID:${stamp}-${Math.abs(hash(item.value))}@spoken`, `DTSTAMP:${stamp}`];
  if (hh !== undefined && mm !== undefined) {
    const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hh + 1, mm);
    lines.push(`DTSTART:${ymd(date)}T${pad(hh)}${pad(mm)}00`, `DTEND:${ymd(end)}T${pad(end.getHours())}${pad(end.getMinutes())}00`);
  } else {
    lines.push(`DTSTART;VALUE=DATE:${ymd(date)}`, `DTEND;VALUE=DATE:${ymd(new Date(date.getTime() + 864e5))}`);
  }
  lines.push(`SUMMARY:${title}`, "END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); return; } catch { /* insecure context or denied: fall back */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
}

const CSS = `
@keyframes fact-in{from{transform:scale(.86);opacity:0}60%{transform:scale(1.04)}to{transform:scale(1);opacity:1}}
.fact-chip{animation:fact-in .32s cubic-bezier(.2,.9,.3,1.2) both}
.fact-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.fact-chip:active{transform:scale(.97)}
@media (prefers-reduced-motion:reduce){.fact-chip{animation:none}.fact-chip:active{transform:none}}
`;

/** `items` overrides the global list (the multi-call view keeps one list per call). */
export function FactStrip({ items: own }: { items?: FactItem[] } = {}) {
  const lang = useSpoken((s) => s.lang);
  const ended = useSpoken((s) => s.callEnded);
  const store = useStore();
  const shared = useSyncExternalStore(subscribe, snapshot, () => empty);
  const list = own ?? shared;
  const t = COPY[lang] ?? COPY.no;
  const [flash, setFlash] = useState<{ k: string; msg: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!list.length) return null;

  const say = (k: string, msg: string) => {
    setFlash({ k, msg });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1600);
  };
  const run = async (f: FactItem, k: string) => {
    const a = actionOf(f.kind);
    if (a === "copy") { await copyText(f.value); say(k, t.copied); }
    else if (a === "cal") { download("spoken.ics", buildIcs(f, list, t.event)); say(k, t.calAdded); }
    else window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(f.value)}`, "_blank", "noopener,noreferrer");
  };
  // Starting a new chat leaves the call screen: only offered once the call is over.
  const ring = (f: FactItem) => { void copyText(f.value); store.newChat(); store.setDraft(t.callText(f.value)); };

  return (
    <ul
      aria-label={t.group}
      style={{
        listStyle: "none", margin: 0, padding: "0.5rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem",
        position: "sticky", top: 0, zIndex: 2, background: "var(--app)", borderBottom: "1px solid var(--line)",
      }}
    >
      <style>{CSS}</style>
      {list.map((f) => {
        const k = `${f.kind}|${f.value}`;
        const [fg, bg] = TONE[f.kind];
        const msg = flash?.k === k ? flash.msg : null;
        return (
          <li key={k} style={{ display: "inline-flex", gap: "0.25rem" }}>
            <button
              type="button"
              className="fact-chip"
              onClick={() => void run(f, k)}
              aria-label={`${t.kind[f.kind]}: ${f.value}, ${f.confirmed ? t.ok : t.un}. ${t.act[actionOf(f.kind)]}`}
              style={{
                display: "inline-flex", alignItems: "center", gap: "0.375rem", minHeight: "2.5rem", padding: "0.375rem 0.75rem", borderRadius: "62.4375rem",
                font: "inherit", fontSize: "0.9375rem", lineHeight: 1.25, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ink)", cursor: "pointer",
                background: f.confirmed ? bg : "transparent",
                border: `1px ${f.confirmed ? "solid" : "dashed"} ${f.confirmed ? fg : "var(--line-2)"}`,
              }}
            >
              <span aria-hidden="true">{msg ?? f.value}</span>
              {!msg && <span aria-hidden="true" style={{ color: f.confirmed ? fg : "var(--dim)" }}>{f.confirmed ? "✓" : "…"}</span>}
            </button>
            {f.kind === "phone" && ended && (
              <button
                type="button" className="fact-chip" onClick={() => ring(f)} aria-label={`${t.call} ${f.value}`}
                style={{ minHeight: "2.5rem", padding: "0.375rem 0.875rem", borderRadius: "62.4375rem", font: "inherit", fontSize: "0.9375rem", fontWeight: 700, cursor: "pointer", color: "var(--app)", background: "var(--accent)", border: "1px solid var(--accent)" }}
              >{t.callReq}</button>
            )}
          </li>
        );
      })}
      <li role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{flash?.msg ?? ""}</li>
    </ul>
  );
}
