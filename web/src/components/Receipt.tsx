"use client";

import { useSyncExternalStore } from "react";
import { useSpoken } from "@/lib/use-spoken";

// What the call actually did, in plain language: AI disclosure, what was said about the user,
// what the user approved or declined, and what is kept. Built by the server from the real call.
// Wire type from shared/contract.ts, kept local so the Next build doesn't reach outside web/.
export interface ReceiptData {
  lang: "no" | "en";
  callee: string;
  durationSec: number;
  disclosedAsAi: boolean;
  disclosure?: string;
  shared: string[];
  agreed: { question: string; choice: string }[];
  declined: { question: string; choice: string }[];
  stored: string;
}

let receipt: ReceiptData | null = null;
const subs = new Set<() => void>();
export function setReceipt(next: ReceiptData | null | undefined) { receipt = next ?? null; subs.forEach((f) => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const FIELD = {
  no: { name: "navn", phone: "telefonnummer", address: "adresse", email: "e-post", birthdate: "fødselsdato", fnr: "fødselsnummer", allergies: "allergier" },
  en: { name: "name", phone: "phone number", address: "address", email: "email", birthdate: "date of birth", fnr: "national ID number", allergies: "allergies" },
} as const;

const COPY = {
  no: {
    title: "Kvittering", disclosed: "KI oppgitt: Første setning sa at det var en KI-assistent.", notDisclosed: "KI ble ikke oppgitt i første setning.",
    shared: (who: string, f: string) => `Delt med ${who}: ${f}.`, sharedNone: (who: string) => `Ingen personopplysninger ble sagt til ${who}.`,
    agreed: "Du godtok", declined: "Du avslo", nothing: "Ingenting ble avtalt.", call: (who: string, s: number) => `Samtale med ${who}, ${s} sekunder.`,
  },
  en: {
    title: "Receipt", disclosed: "AI disclosed: the first sentence said this was an AI assistant.", notDisclosed: "The AI was not disclosed in the first sentence.",
    shared: (who: string, f: string) => `Shared with ${who}: ${f}.`, sharedNone: (who: string) => `No personal details were said to ${who}.`,
    agreed: "You approved", declined: "You declined", nothing: "Nothing was agreed.", call: (who: string, s: number) => `Call with ${who}, ${s} seconds.`,
  },
} as const;

export function Receipt() {
  const appLang = useSpoken((s) => s.lang);
  const r = useSyncExternalStore(subscribe, () => receipt, () => null);
  if (!r) return null;
  const lang = r.lang ?? appLang;
  const t = COPY[lang] ?? COPY.no;
  const fields = (FIELD[lang] ?? FIELD.no) as Record<string, string>;
  const who = r.callee || "—";
  return (
    <details style={{ margin: "0.75rem 0", border: "1px solid var(--line)", borderRadius: "0.875rem", background: "var(--surface)", fontSize: "0.9375rem", lineHeight: 1.45 }}>
      <summary style={{ cursor: "pointer", padding: "0.75rem 1rem", fontWeight: 600, minHeight: "2.75rem", display: "flex", alignItems: "center" }}>
        {t.title}
      </summary>
      <ul style={{ listStyle: "none", margin: 0, padding: "0 1rem 0.875rem", display: "grid", gap: "0.5rem", color: "var(--muted)" }}>
        <li>
          <span aria-hidden="true">{r.disclosedAsAi ? "✓ " : "⚠ "}</span>{r.disclosedAsAi ? t.disclosed : t.notDisclosed}
          {r.disclosure ? <q style={{ display: "block", color: "var(--ink)" }}>{r.disclosure}</q> : null}
        </li>
        <li>{r.shared.length ? t.shared(who, r.shared.map((k) => fields[k] ?? k).join(", ")) : t.sharedNone(who)}</li>
        {r.agreed.map((a, i) => <li key={`a${i}`}>{t.agreed}: <span style={{ color: "var(--ink)" }}>{a.question}</span> ({a.choice})</li>)}
        {r.declined.map((a, i) => <li key={`d${i}`}>{t.declined}: <span style={{ color: "var(--ink)" }}>{a.question}</span></li>)}
        {!r.agreed.length && !r.declined.length ? <li>{t.nothing}</li> : null}
        <li>{r.stored}</li>
        <li>{t.call(who, r.durationSec)}</li>
      </ul>
    </details>
  );
}
