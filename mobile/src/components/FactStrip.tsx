import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { useTheme, makeStyles, PAD, type TintKey } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import { T } from "./ui";

// Price, time, address and reference number heard on the call, pinned above the transcript.
// ✓ = a second source agrees (batch STT, a repeat, or a yes to our read-back).
// Wire type from shared/contract.ts.
export interface FactItem { kind: "price" | "time" | "address" | "ref"; value: string; confirmed: boolean }

let items: FactItem[] = [];
const subs = new Set<() => void>();
/** Called by the live-call socket with the full list each time it changes. */
export function setFacts(next: FactItem[]) { items = next; subs.forEach((f) => f()); }
export function resetFacts() { if (items.length) setFacts([]); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const COPY = {
  no: { group: "Viktige opplysninger fra samtalen", kind: { price: "Pris", time: "Tid", address: "Adresse", ref: "Referanse" }, ok: "dobbeltsjekket", un: "ikke bekreftet ennå" },
  en: { group: "Key facts from the call", kind: { price: "Price", time: "Time", address: "Address", ref: "Reference" }, ok: "double-checked", un: "not confirmed yet" },
} as const;
const TONE: Record<FactItem["kind"], TintKey> = { price: "amber", time: "sky", address: "violet", ref: "teal" };

/** `items` overrides the global list (the multi-call view keeps one list per call). */
export function FactStrip({ items: own }: { items?: FactItem[] } = {}) {
  const lang = useSpoken((s) => s.lang);
  const shared = useSyncExternalStore(subscribe, () => items, () => items);
  const list = own ?? shared;
  const { C } = useTheme();
  const styles = useStyles();
  const t = COPY[lang] ?? COPY.no;
  if (!list.length) return null;
  return (
    <View style={styles.strip} accessible={false} accessibilityLabel={t.group}>
      {list.map((f) => {
        const tint = C.tints[TONE[f.kind]];
        return (
          <View
            key={`${f.kind}|${f.value}`}
            accessible
            accessibilityLabel={`${t.kind[f.kind]}: ${f.value}, ${f.confirmed ? t.ok : t.un}`}
            style={[styles.chip, f.confirmed ? { backgroundColor: tint.bg, borderColor: tint.fg } : styles.unsure]}
          >
            <T size={14} weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>{f.value}</T>
            <T size={14} weight="semibold" color={f.confirmed ? tint.fg : C.dim}>{f.confirmed ? "✓" : "…"}</T>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: PAD, paddingVertical: 8, backgroundColor: C.app, borderBottomWidth: 1, borderBottomColor: C.line },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  unsure: { borderColor: C.line2, borderStyle: "dashed" },
}));
