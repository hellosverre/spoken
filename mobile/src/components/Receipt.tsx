import { useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import { makeStyles, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import { T } from "./ui";

// What the call actually did, in plain language: AI disclosure, what was said about the user,
// what the user approved or declined, and what is kept. Built by the server from the real call.
// Wire type from shared/contract.ts.
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
  const r = useSyncExternalStore(subscribe, () => receipt, () => receipt);
  const [open, setOpen] = useState(false);
  const { C } = useTheme();
  const styles = useStyles();
  if (!r) return null;
  const lang = r.lang ?? appLang;
  const t = COPY[lang] ?? COPY.no;
  const fields = (FIELD[lang] ?? FIELD.no) as Record<string, string>;
  const who = r.callee || "—";
  return (
    <View style={styles.box}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t.title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((v) => !v)}
        style={styles.head}
      >
        <T size={15} weight="semibold">{t.title}</T>
        <T size={15} color={C.muted}>{open ? "−" : "+"}</T>
      </Pressable>
      {open ? (
        <View style={styles.body}>
          <T size={14} color={C.muted}>{r.disclosedAsAi ? "✓ " : "⚠ "}{r.disclosedAsAi ? t.disclosed : t.notDisclosed}</T>
          {r.disclosure ? <T size={14}>«{r.disclosure}»</T> : null}
          <T size={14} color={C.muted}>{r.shared.length ? t.shared(who, r.shared.map((k) => fields[k] ?? k).join(", ")) : t.sharedNone(who)}</T>
          {r.agreed.map((a, i) => <T key={`a${i}`} size={14} color={C.muted}>{t.agreed}: <T size={14}>{a.question}</T> ({a.choice})</T>)}
          {r.declined.map((a, i) => <T key={`d${i}`} size={14} color={C.muted}>{t.declined}: <T size={14}>{a.question}</T></T>)}
          {!r.agreed.length && !r.declined.length ? <T size={14} color={C.muted}>{t.nothing}</T> : null}
          <T size={14} color={C.muted}>{r.stored}</T>
          <T size={14} color={C.muted}>{t.call(who, r.durationSec)}</T>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  box: { marginVertical: 12, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface },
  head: { minHeight: 44, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  body: { paddingHorizontal: 16, paddingBottom: 14, gap: 8 },
}));
