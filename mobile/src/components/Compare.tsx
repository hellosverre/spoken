import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { serverUrl } from "../lib/real-call";
import { PAD, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { useStyles as useCallStyles } from "./Call";
import { Composer } from "./Composer";
import { FactStrip, type FactItem } from "./FactStrip";
import { HoldBanner } from "./HoldBanner";
import { Icon } from "./Icon";
import { ReplyChips } from "./ReplyChips";
import { Btn, Press, T } from "./ui";

/* Multi-call view: the chat plan named 2–3 places, so POST /api/compare starts one info-only call per place
   and this screen shows them as tabs. The selected tab is a normal call view (transcript, fact strip, hold
   banner, chips) fed by that call's own live socket. Mirrors web/src/components/Compare.tsx. */

type Row = { id: string; kind: "ai" | "them" | "sys" | "you"; text: string };
interface Ask { id: string; question: string; options: string[] }
interface Leg {
  name: string; phone: string; callId: string; status: string; answer?: string; outcome?: string;
  rows: Row[]; facts: FactItem[]; holdSince: number | null; chips: string[]; ask?: Ask;
}
interface PollLeg { callId: string; status: string; answer?: string; outcome?: string }

const L = {
  no: {
    title: "Ringer samtidig", mock: "Demo: ingen telefon ringer", err: "Kunne ikke starte samtalene.",
    results: "Resultat", book: "Bestill hos", cheapest: "Billigst", noAnswer: "Ingen svar", home: "Til forsiden",
    bookText: "Bestill", ended: "Samtalen er ferdig", wait: "Venter på svar",
    st: { queued: "Venter", dialing: "Ringer opp", ringing: "Ringer", connected: "I samtale", on_hold: "På vent", ended: "Ferdig", failed: "Feilet" } as Record<string, string>,
  },
  en: {
    title: "Calling at once", mock: "Demo: no phone rings", err: "Could not start the calls.",
    results: "Result", book: "Book with", cheapest: "Cheapest", noAnswer: "No answer", home: "Back home",
    bookText: "Book", ended: "The call has ended", wait: "Waiting for an answer",
    st: { queued: "Waiting", dialing: "Dialing", ringing: "Ringing", connected: "On the call", on_hold: "On hold", ended: "Done", failed: "Failed" } as Record<string, string>,
  },
};

const isEnded = (l: Leg) => l.status === "ended" || l.status === "failed";

/** Starts the calls, then keeps one live socket per call plus a light poll for status and answers. */
function useLegs(request: string, targets: { name: string; phone: string }[], lang: "no" | "en", passcode: string) {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState("");
  const sockets = useRef<Map<string, WebSocket>>(new Map());
  const rowId = useRef(0);

  const patch = useCallback((callId: string, f: (l: Leg) => Partial<Leg>) => {
    setLegs((ls) => ls.map((l) => (l.callId === callId ? { ...l, ...f(l) } : l)));
  }, []);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const upsert = (rows: Row[], row: Row) => {
      const i = rows.findIndex((r) => r.id === row.id);
      return i === -1 ? [...rows, row] : rows.map((r, j) => (j === i ? row : r));
    };
    const watch = (callId: string) => {
      const ws = new WebSocket(`${serverUrl().replace(/^http/, "ws")}/api/calls/${encodeURIComponent(callId)}/live`);
      sockets.current.set(callId, ws);
      ws.onmessage = (m) => {
        let e: any;
        try { e = JSON.parse(String(m.data)); } catch { return; }
        switch (e.type) {
          case "transcript":
            if (!String(e.text).trim() || (e.who === "callee" && !e.final)) break;
            patch(callId, (l) => ({ rows: upsert(l.rows, { id: e.id, kind: e.who === "agent" ? "ai" : "them", text: String(e.text).trim() }) }));
            break;
          case "note":
            patch(callId, (l) => ({ rows: [...l.rows, { id: `n${rowId.current++}`, kind: "sys", text: e.text }] }));
            break;
          case "facts": patch(callId, () => ({ facts: e.items })); break;
          case "on_hold": patch(callId, () => ({ holdSince: e.since })); break;
          case "hold_over": patch(callId, () => ({ holdSince: null })); break;
          case "chips": patch(callId, () => ({ chips: e.items })); break;
          case "approval_request": patch(callId, () => ({ ask: { id: e.id, question: e.question, options: e.options } })); break;
          case "result": patch(callId, () => ({ ask: undefined, holdSince: null, chips: [] })); break;
        }
      };
    };

    (async () => {
      try {
        const device = (await AsyncStorage.getItem("spoken-device")) ?? "";
        const res = await fetch(serverUrl() + "/api/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(device ? { "X-Spoken-Device": device } : {}), ...(passcode.trim() ? { "X-Spoken-Passcode": passcode.trim() } : {}) },
          body: JSON.stringify({ text: request, lang, targets }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (dead) return;
        setMock(data.mode === "mock");
        const started: { name: string; callId: string }[] = data.legs;
        setLegs(started.map((s, i) => ({ name: s.name, phone: targets[i]?.phone ?? "", callId: s.callId, status: "queued", rows: [], facts: [], holdSince: null, chips: [] })));
        started.forEach((s) => watch(s.callId));
        const poll = async () => {
          const r = await fetch(`${serverUrl()}/api/compare/${encodeURIComponent(data.compareId)}`).catch(() => null);
          if (!r?.ok || dead) return;
          const st = (await r.json()) as { done: boolean; legs: PollLeg[] };
          setLegs((ls) => ls.map((l) => {
            const p = st.legs.find((x) => x.callId === l.callId);
            return p ? { ...l, status: p.status, answer: p.answer, outcome: p.outcome } : l;
          }));
          if (st.done && timer) { clearInterval(timer); timer = undefined; }
        };
        await poll();
        timer = setInterval(() => void poll(), 1200);
      } catch (e) {
        if (!dead) setError((e as Error).message || L[lang].err);
      }
    })();

    const open = sockets.current;
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      open.forEach((ws) => { try { ws.close(); } catch { /* already closed */ } });
      open.clear();
    };
  }, [request, targets, lang, passcode, patch]);

  const send = useCallback((callId: string, cmd: object) => {
    const ws = sockets.current.get(callId);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }, []);

  return { legs, patch, send, mock, error };
}

function cheapestOf(legs: Leg[]): number {
  let best = -1, bestP = Infinity;
  legs.forEach((l, i) => {
    const p = Number(l.answer?.match(/\d+/)?.[0]);
    if (l.outcome === "done" && p < bestP) { bestP = p; best = i; }
  });
  return best;
}

export function MultiCall() {
  const store = useStore();
  const multi = useSpoken((s) => s.multi);
  const lang = useSpoken((s) => s.lang);
  const passcode = useSpoken((s) => s.passcode);
  if (!multi) return null;
  return (
    <Multi
      key={multi.request + multi.targets.map((x) => x.phone).join()}
      request={multi.request} targets={multi.targets} lang={lang} passcode={passcode}
      onHome={() => store.goHome()}
      onBook={(text) => { store.goHome("chat"); store.setDraft(text); store.submitDraft(); }}
    />
  );
}

function Multi({ request, targets, lang, passcode, onHome, onBook }: {
  request: string; targets: { name: string; phone: string }[]; lang: "no" | "en"; passcode: string; onHome: () => void; onBook: (text: string) => void;
}) {
  const t = L[lang];
  const ct = useCopy();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useCallStyles();
  const insets = useSafeAreaInsets();
  const { legs, patch, send, mock, error } = useLegs(request, targets, lang, passcode);
  const [sel, setSel] = useState(0);
  const [value, setValue] = useState("");
  const scroll = useRef<ScrollViewInstance>(null);
  const leg = legs[Math.min(sel, legs.length - 1)];
  const done = legs.length > 0 && legs.every(isEnded);
  const cheapest = done ? cheapestOf(legs) : -1;

  const instruct = (text: string) => {
    if (!leg || !text.trim()) return;
    patch(leg.callId, (l) => ({ chips: [], rows: [...l.rows, { id: `y${Date.now()}`, kind: "you", text: text.trim() }] }));
    send(leg.callId, { type: "instruction", text: text.trim() });
  };

  /** "Book with X": a normal task for that business. Other numbers are removed so it stays a single call. */
  const book = (l: Leg) => {
    const rest = request.replace(/\+?\d[\d \-]{6,16}\d/g, "").replace(/\s*[,;]\s*(og|and)?\s*(?=[,;.]|$)/gi, "").replace(/\s{2,}/g, " ").trim();
    onBook(`${t.bookText} ${l.name}, ${l.phone}: ${rest}${l.answer ? ` (${l.answer})` : ""}`);
  };

  const dot = (l: Leg) =>
    l.status === "failed" || ["no_answer", "failed", "refused"].includes(l.outcome ?? "") ? C.danger
    : isEnded(l) || l.status === "connected" || l.status === "on_hold" ? C.accent : C.dim;

  if (error) {
    return (
      <View style={[styles.grow, { padding: PAD, gap: 12 }]}>
        <T size={16} weight="medium">{t.title}</T>
        <T accessibilityRole="alert">{error}</T>
        <Btn block label={m.backHome} onPress={onHome} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.grow}>
      <View style={styles.callhead}>
        <View style={styles.grow}>
          <T size={16} weight="medium">{t.title}</T>
          <Text style={styles.num} numberOfLines={1}>{mock ? t.mock : request}</Text>
        </View>
        {leg && (
          <Press accessibilityLabel={`${ct.endCall}: ${leg.name}`} disabled={isEnded(leg)} onPress={() => send(leg.callId, { type: "hangup" })} style={[styles.endbtn, isEnded(leg) && { opacity: 0.3 }]}>
            <Icon name="hang" color="#fff" />
          </Press>
        )}
      </View>

      <View accessibilityRole="tablist">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: PAD, paddingBottom: 10 }}>
          {legs.map((l, i) => {
            const on = i === sel;
            return (
              <Press
                key={l.callId} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={`${l.name}: ${t.st[l.status] ?? l.status}${l.answer ? `, ${l.answer}` : ""}`}
                onPress={() => setSel(i)}
                style={{ minWidth: 120, maxWidth: 200, minHeight: 56, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: on ? C.accent : C.line2, backgroundColor: on ? C.surface2 : C.surface }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot(l) }} />
                  <T size={14} weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>{l.name}</T>
                </View>
                <T size={12} color={l.answer ? C.ink : C.muted} numberOfLines={1} style={{ fontVariant: ["tabular-nums"] }}>{l.answer ?? t.st[l.status] ?? l.status}</T>
              </Press>
            );
          })}
        </ScrollView>
      </View>

      {leg && (
        <>
          <View style={styles.pad}>
            <Text style={styles.num}>{leg.phone} · {t.st[leg.status] ?? leg.status}</Text>
            <HoldBanner since={leg.holdSince} ended={isEnded(leg)} />
          </View>
          <FactStrip items={leg.facts} />
          <ScrollView
            ref={scroll} style={styles.grow} contentContainerStyle={styles.transcript} keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
          >
            {leg.rows.map((r) => {
              if (r.kind === "sys") return <Text key={r.id} style={styles.sysText}>{r.text}</Text>;
              if (r.kind === "you") {
                return (
                  <View key={r.id} style={[styles.msg, styles.right]}>
                    <Text style={styles.who}>{m.youLabel}</Text>
                    <View style={[styles.txt, styles.youTxt]}><T size={14} color={C.muted}>{r.text}</T></View>
                  </View>
                );
              }
              const ai = r.kind === "ai";
              return (
                <View key={r.id} style={[styles.msg, ai ? styles.right : styles.left]} accessible accessibilityLabel={`${ai ? m.aiLabel : leg.name}: ${r.text}`}>
                  <Text style={styles.who}>{ai ? m.aiLabel : leg.name}</Text>
                  <View style={[styles.txt, ai ? styles.aiTxt : styles.themTxt]}>
                    <Text style={[styles.lineText, ai && { color: C.inv }]}>{r.text}</Text>
                  </View>
                </View>
              );
            })}
            {leg.ask && (
              <View accessibilityLabel={leg.ask.question} style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface }}>
                <T>{leg.ask.question}</T>
                {leg.ask.options.map((o) => (
                  <Btn key={o} block label={o} onPress={() => { send(leg.callId, { type: "approval_response", id: leg.ask!.id, choice: o }); patch(leg.callId, () => ({ ask: undefined })); }} />
                ))}
              </View>
            )}
          </ScrollView>
        </>
      )}

      <View style={[styles.composer, { paddingBottom: 12 + insets.bottom }]}>
        {done ? (
          <View accessibilityLabel={t.results} style={{ gap: 8 }}>
            {legs.map((l, i) => (
              <View key={l.callId} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <View style={styles.grow}>
                  <T size={14} weight="medium">{l.name}</T>
                  <T size={13} color={i === cheapest ? C.accent : C.muted}>{l.answer ?? t.noAnswer}{i === cheapest ? ` · ${t.cheapest}` : ""}</T>
                </View>
                {l.outcome === "done" && <Btn kind={i === cheapest ? "primary" : "ghost"} label={`${t.book} ${l.name}`} onPress={() => book(l)} />}
              </View>
            ))}
            <Btn kind="ghost" block label={t.home} icon={<Icon name="home" color={C.ink} size={17} />} onPress={onHome} />
          </View>
        ) : leg && !isEnded(leg) ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              <ReplyChips repeat={ct.chipRepeat} thanks={ct.chipThanks} own={leg.chips} onSend={instruct} />
            </ScrollView>
            <Composer value={value} onChange={setValue} onSubmit={() => { instruct(value); setValue(""); }} placeholder={ct.instrPh} label={ct.instrAria} sendLabel={ct.sendInstr} />
          </>
        ) : (
          <T size={14} color={C.muted}>{leg ? t.ended : t.wait}</T>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
