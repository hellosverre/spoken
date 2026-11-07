import { useSyncExternalStore } from "react";
import { Linking, Platform, Pressable, Share, View } from "react-native";
import { useTheme, makeStyles, PAD, type TintKey } from "../lib/theme";
import { useSpoken, useStore } from "../lib/use-spoken";
import { T } from "./ui";

// Price, time, address and reference number heard on the call, pinned above the transcript.
// ✓ = a second source agrees (batch STT, a repeat, or a yes to our read-back).
// Wire type from shared/contract.ts.
export type FactKind = "price" | "time" | "address" | "ref" | "phone" | "date" | "name";
export interface FactItem { kind: FactKind; value: string; confirmed: boolean }

let items: FactItem[] = [];
const subs = new Set<() => void>();
/** Called by the live-call socket with the full list each time it changes. */
export function setFacts(next: FactItem[]) { items = next; subs.forEach((f) => f()); }
export function resetFacts() { if (items.length) setFacts([]); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const COPY = {
  no: {
    group: "Viktige opplysninger fra samtalen",
    kind: { price: "Pris", time: "Tid", date: "Dato", address: "Adresse", ref: "Referanse", phone: "Telefon", name: "Navn" },
    ok: "dobbeltsjekket", un: "ikke bekreftet ennå",
    act: { copy: "dobbelttrykk for å kopiere", cal: "dobbelttrykk for å legge i kalender", map: "dobbelttrykk for å åpne i kart" },
    call: "Ring dette nummeret", callReq: "Ring", event: "Avtale", callText: (n: string) => `Ring ${n}`,
  },
  en: {
    group: "Key facts from the call",
    kind: { price: "Price", time: "Time", date: "Date", address: "Address", ref: "Reference", phone: "Phone", name: "Name" },
    ok: "double-checked", un: "not confirmed yet",
    act: { copy: "double-tap to copy", cal: "double-tap to add to calendar", map: "double-tap to open in maps" },
    call: "Call this number", callReq: "Call", event: "Appointment", callText: (n: string) => `Call ${n}`,
  },
} as const;
const TONE: Record<FactKind, TintKey | "accent" | "plain"> = { price: "amber", time: "sky", date: "sky", address: "violet", ref: "teal", phone: "accent", name: "plain" };

type Action = "copy" | "cal" | "map";
const actionOf = (k: FactKind): Action => (k === "time" || k === "date" ? "cal" : k === "address" ? "map" : "copy");

/** Mobile has no clipboard module in this build: the share sheet's Copy does it. Calendar goes through the
 *  same sheet as an event text; maps open the platform's own app. */
async function run(f: FactItem, event: string) {
  const a = actionOf(f.kind);
  try {
    if (a === "map") {
      const q = encodeURIComponent(f.value);
      await Linking.openURL(Platform.OS === "ios" ? `maps:?q=${q}` : `geo:0,0?q=${q}`);
    } else await Share.share({ message: a === "cal" ? `${event}: ${f.value}` : f.value });
  } catch { /* sheet dismissed or no maps app: nothing to do */ }
}

/** `items` overrides the global list (the multi-call view keeps one list per call). */
export function FactStrip({ items: own }: { items?: FactItem[] } = {}) {
  const lang = useSpoken((s) => s.lang);
  const ended = useSpoken((s) => s.callEnded);
  const store = useStore();
  const shared = useSyncExternalStore(subscribe, () => items, () => items);
  const list = own ?? shared;
  const { C } = useTheme();
  const styles = useStyles();
  const t = COPY[lang] ?? COPY.no;
  if (!list.length) return null;
  return (
    <View style={styles.strip} accessible={false} accessibilityLabel={t.group}>
      {list.map((f) => {
        const tone = TONE[f.kind];
        const fg = tone === "accent" ? C.accent : tone === "plain" ? C.line2 : C.tints[tone].fg;
        const bg = tone === "accent" ? C.accentSoft : tone === "plain" ? "transparent" : C.tints[tone].bg;
        return (
          <View key={`${f.kind}|${f.value}`} style={styles.cell}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t.kind[f.kind]}: ${f.value}, ${f.confirmed ? t.ok : t.un}`}
              accessibilityHint={t.act[actionOf(f.kind)]}
              onPress={() => void run(f, t.event)}
              style={({ pressed }) => [styles.chip, f.confirmed ? { backgroundColor: bg, borderColor: fg } : styles.unsure, pressed && { opacity: 0.6 }]}
            >
              <T size={15} weight="semibold" style={{ fontVariant: ["tabular-nums"] }}>{f.value}</T>
              <T size={15} weight="semibold" color={f.confirmed ? fg : C.dim}>{f.confirmed ? "✓" : "…"}</T>
            </Pressable>
            {f.kind === "phone" && ended && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${t.call} ${f.value}`}
                onPress={() => { store.newChat(); store.setDraft(t.callText(f.value)); }}
                style={({ pressed }) => [styles.chip, { backgroundColor: C.accent, borderColor: C.accent }, pressed && { opacity: 0.6 }]}
              >
                <T size={15} weight="semibold" color={C.app}>{t.callReq}</T>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  strip: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: PAD, paddingVertical: 8, backgroundColor: C.app, borderBottomWidth: 1, borderBottomColor: C.line },
  cell: { flexDirection: "row", gap: 4 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1 },
  unsure: { borderColor: C.line2, borderStyle: "dashed" },
}));
