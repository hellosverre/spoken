import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, ScrollView, TextInput, View } from "react-native";
import { serverUrl } from "../lib/real-call";
import { PAD, useTheme } from "../lib/theme";
import { useSpoken, useStore } from "../lib/use-spoken";
import { Btn, T } from "./ui";

/* Compare: ask 2–3 places the same question at once (POST /api/compare), then book one.
   Self-contained: own fetch, polls GET /api/compare/:id. Wire types: shared/contract.ts. */

interface Leg { name: string; phone: string; callId: string; status: string; answer?: string; outcome?: string; lastLine?: string }
interface State { compareId: string; mode: "real" | "mock"; done: boolean; legs: Leg[] }

const L = {
  no: {
    entry: "Sammenlign 3 steder", sub: "Spoken ringer alle samtidig og spør om pris og tid", title: "Sammenlign", req: "Hva vil du ha?",
    reqDef: "Billigste store pepperoni, hentes i kveld", go: "Ring alle", close: "Lukk", again: "Ny sammenligning", book: "Bestill hos",
    result: "Resultat", mock: "Demo: ingen telefon ringer", noAnswer: "Ingen svar", err: "Kunne ikke starte.",
    st: { queued: "Venter", dialing: "Ringer opp", ringing: "Ringer", connected: "I samtale", on_hold: "På vent", ended: "Ferdig", failed: "Feilet" } as Record<string, string>,
  },
  en: {
    entry: "Compare 3 places", sub: "Spoken calls them all at once and asks price and time", title: "Compare", req: "What do you want?",
    reqDef: "Cheapest large pepperoni, pickup tonight", go: "Call all", close: "Close", again: "New comparison", book: "Book with",
    result: "Result", mock: "Demo: no phone rings", noAnswer: "No answer", err: "Could not start.",
    st: { queued: "Waiting", dialing: "Dialing", ringing: "Ringing", connected: "On the call", on_hold: "On hold", ended: "Done", failed: "Failed" } as Record<string, string>,
  },
};

const DEFAULTS = [
  { name: "Pizzabakeren", phone: "+4722000001" },
  { name: "Dolce Vita", phone: "+4722000002" },
  { name: "Peppes Pizza", phone: "+4722000003" },
];

/** The Home entry card; opens the Compare screen as a full-screen modal. */
export function CompareEntry() {
  const lang = useSpoken((s) => s.lang);
  const { C } = useTheme();
  const t = L[lang];
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t.entry} onPress={() => setOpen(true)}
        style={{ borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, borderRadius: 14, padding: 14, marginTop: 12 }}>
        <T weight="semibold">{t.entry}</T>
        <T size={13} color={C.muted}>{t.sub}</T>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <Compare onClose={() => setOpen(false)} />
      </Modal>
    </>
  );
}

export function Compare({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const { C } = useTheme();
  const lang = useSpoken((s) => s.lang);
  const passcode = useSpoken((s) => s.passcode);
  const t = L[lang];
  const [text, setText] = useState(t.reqDef);
  const [targets, setTargets] = useState(DEFAULTS);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function start() {
    setBusy(true); setError("");
    try {
      const device = (await AsyncStorage.getItem("spoken-device")) ?? "";
      const res = await fetch(serverUrl() + "/api/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(device ? { "X-Spoken-Device": device } : {}), ...(passcode ? { "X-Spoken-Passcode": passcode } : {}) },
        body: JSON.stringify({ text, lang, targets }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const poll = async () => {
        const r = await fetch(`${serverUrl()}/api/compare/${data.compareId}`);
        if (!r.ok) return;
        const s = (await r.json()) as State;
        setState(s);
        if (s.done && timer.current) { clearInterval(timer.current); timer.current = null; }
      };
      await poll();
      timer.current = setInterval(() => void poll(), 1200);
    } catch (e) {
      setError((e as Error).message || t.err);
    } finally { setBusy(false); }
  }

  function book(l: Leg) {
    // A normal task for that business: the existing chat flow with the request prefilled.
    store.setDraft(`${text} — ${l.name}, ${l.phone}`);
    store.setTab("chat");
    store.submitDraft();
    onClose();
  }

  const input = { flex: 1, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, color: C.ink, borderRadius: 10, padding: 10 } as const;
  return (
    <View style={{ flex: 1, backgroundColor: C.app }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: PAD, paddingTop: PAD + 24 }}>
        <T size={20} weight="semibold">{t.title}</T>
        <Btn kind="ghost" label={t.close} onPress={onClose} />
      </View>
      <ScrollView contentContainerStyle={{ padding: PAD, gap: 10 }} keyboardShouldPersistTaps="handled">
        {!state && (
          <>
            <T size={13} color={C.muted}>{t.req}</T>
            <TextInput value={text} onChangeText={setText} multiline style={{ ...input, minHeight: 64 }} accessibilityLabel={t.req} />
            {targets.map((x, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8 }}>
                <TextInput value={x.name} onChangeText={(v) => setTargets(targets.map((y, j) => (j === i ? { ...y, name: v } : y)))} style={input} accessibilityLabel={`Name ${i + 1}`} />
                <TextInput value={x.phone} keyboardType="phone-pad" onChangeText={(v) => setTargets(targets.map((y, j) => (j === i ? { ...y, phone: v } : y)))} style={input} accessibilityLabel={`Phone ${i + 1}`} />
              </View>
            ))}
            {!!error && <T color={C.danger} accessibilityRole="alert">{error}</T>}
            <Btn block label={t.go} disabled={busy || !text.trim()} onPress={() => void start()} />
          </>
        )}
        {state && (
          <>
            {state.mode === "mock" && <T size={13} color={C.muted}>{t.mock}</T>}
            {state.legs.map((l) => (
              <View key={l.callId} accessibilityLiveRegion="polite" style={{ borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, borderRadius: 14, padding: 12, gap: 4 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <T weight="semibold">{l.name}</T>
                  <T size={13} color={l.status === "ended" ? C.accent : C.muted}>{t.st[l.status] ?? l.status}</T>
                </View>
                {!!l.lastLine && <T size={13} color={C.muted}>“{l.lastLine}”</T>}
                {!!l.answer && <T weight="semibold">{l.answer}</T>}
              </View>
            ))}
            {state.done && (
              <>
                <T size={13} color={C.muted} style={{ marginTop: 8 }}>{t.result}</T>
                {state.legs.map((l) => (
                  <View key={l.callId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8 }}>
                    <View style={{ flex: 1 }}>
                      <T weight="semibold">{l.name}</T>
                      <T color={C.muted}>{l.answer ?? t.noAnswer}</T>
                    </View>
                    {l.outcome === "done" && <Btn label={`${t.book} ${l.name}`} onPress={() => book(l)} />}
                  </View>
                ))}
                <Btn kind="ghost" label={t.again} onPress={() => setState(null)} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}
