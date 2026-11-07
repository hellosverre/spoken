"use client";

import { useSyncExternalStore } from "react";
import { useSpoken } from "@/lib/use-spoken";

// The facts that matter on a call (price, time, address, reference number), pinned above the
// transcript so they never scroll away. ✓ = a second source agrees (batch STT, a repeat, or a yes).
// Wire types from shared/contract.ts, kept local so the Next build doesn't reach outside web/.
export interface FactItem { kind: "price" | "time" | "address" | "ref"; value: string; confirmed: boolean }

let items: FactItem[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
/** Called by the live-call socket with the full list each time it changes. */
export function setFacts(next: FactItem[]) { items = next; emit(); }
export function resetFacts() { if (items.length) setFacts([]); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const snapshot = () => items;
const empty: FactItem[] = [];

const COPY = {
  no: { group: "Viktige opplysninger fra samtalen", kind: { price: "Pris", time: "Tid", address: "Adresse", ref: "Referanse" }, ok: "dobbeltsjekket", un: "ikke bekreftet ennå" },
  en: { group: "Key facts from the call", kind: { price: "Price", time: "Time", address: "Address", ref: "Reference" }, ok: "double-checked", un: "not confirmed yet" },
} as const;

const TONE: Record<FactItem["kind"], string> = { price: "amber", time: "sky", address: "violet", ref: "teal" };

/** `items` overrides the global list (the multi-call view keeps one list per call). */
export function FactStrip({ items: own }: { items?: FactItem[] } = {}) {
  const lang = useSpoken((s) => s.lang);
  const shared = useSyncExternalStore(subscribe, snapshot, () => empty);
  const list = own ?? shared;
  const t = COPY[lang] ?? COPY.no;
  if (!list.length) return null;
  return (
    <ul
      aria-label={t.group}
      style={{
        listStyle: "none", margin: 0, padding: "0.5rem 1.25rem", display: "flex", flexWrap: "wrap", gap: "0.5rem",
        position: "sticky", top: 0, zIndex: 2, background: "var(--app)", borderBottom: "1px solid var(--line)",
      }}
    >
      {list.map((f) => (
        <li
          key={`${f.kind}|${f.value}`}
          aria-label={`${t.kind[f.kind]}: ${f.value}, ${f.confirmed ? t.ok : t.un}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: "0.375rem", padding: "0.375rem 0.75rem", borderRadius: "62.4375rem",
            fontSize: "0.875rem", lineHeight: 1.25, fontWeight: 600, fontVariantNumeric: "tabular-nums", color: "var(--ink)",
            background: f.confirmed ? `var(--${TONE[f.kind]}-bg)` : "transparent",
            border: `1px ${f.confirmed ? "solid" : "dashed"} ${f.confirmed ? `var(--${TONE[f.kind]})` : "var(--line-2)"}`,
          }}
        >
          <span aria-hidden="true">{f.value}</span>
          <span aria-hidden="true" style={{ color: f.confirmed ? `var(--${TONE[f.kind]})` : "var(--dim)" }}>{f.confirmed ? "✓" : "…"}</span>
        </li>
      ))}
    </ul>
  );
}
