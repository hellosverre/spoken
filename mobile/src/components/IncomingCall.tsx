import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { serverUrl } from "../lib/real-call";
import { makeStyles, PAD, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import { T } from "./ui";

/* The shop rang our number back. The server answers (server/src/call/inbound.ts) and tells this
   device through GET /api/incoming?device=<id> (204 = nothing). Polled every 3 s while the app is
   open; a banner opens the call as live text with YES/NO cards. Same flow as web/…/IncomingCall.tsx. */

const POLL_MS = 3000;
const DEVICE_KEY = "spoken-device"; // written by the store at start-up

interface Incoming { callId: string; callerName: string; topic: string }
interface Line { id: string; who: "callee" | "agent"; text: string }
interface Approval { id: string; question: string; options: string[] }

const COPY = {
  no: { title: "Ringer deg tilbake", open: "Se samtalen", dismiss: "Lukk", live: "Direkte", hang: "Legg på", ended: "Samtalen er over.", them: "De", me: "Spoken", asks: "Spoken spør deg", wait: "Venter på dem …" },
  en: { title: "Calling you back", open: "View call", dismiss: "Close", live: "Live", hang: "Hang up", ended: "The call has ended.", them: "Them", me: "Spoken", asks: "Spoken asks you", wait: "Waiting for them …" },
} as const;

export function IncomingCall() {
  const lang = useSpoken((s) => s.lang);
  const t = COPY[lang === "en" ? "en" : "no"];
  const { C } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [inc, setInc] = useState<Incoming | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (inc) return;
    let stop = false;
    const tick = async () => {
      try {
        const device = await AsyncStorage.getItem(DEVICE_KEY);
        if (!device || stop) return;
        const r = await fetch(`${serverUrl()}/api/incoming?device=${encodeURIComponent(device)}`);
        if (!stop && r.status === 200) setInc((await r.json()) as Incoming);
      } catch { /* offline: next tick */ }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => { stop = true; clearInterval(id); };
  }, [inc]);

  if (!inc) return null;
  const close = () => { setOpen(false); setInc(null); };
  if (open) return <Relay inc={inc} onClose={close} />;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { top: insets.top + 8 }]}>
      <View style={{ flex: 1 }}>
        <T size={12} color={C.accent}>{t.title.toUpperCase()}</T>
        <T size={17} weight="semibold" numberOfLines={1}>{inc.callerName}</T>
        <T size={14} numberOfLines={2}>{inc.topic}</T>
      </View>
      <Pressable accessibilityRole="button" style={styles.ghost} onPress={close}><T size={15}>{t.dismiss}</T></Pressable>
      <Pressable accessibilityRole="button" style={styles.solid} onPress={() => setOpen(true)}><T size={15} weight="semibold" color={C.inv}>{t.open}</T></Pressable>
    </View>
  );
}

function Relay({ inc, onClose }: { inc: Incoming; onClose: () => void }) {
  const lang = useSpoken((s) => s.lang);
  const t = COPY[lang === "en" ? "en" : "no"];
  const { C } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [lines, setLines] = useState<Line[]>([]);
  const [ask, setAsk] = useState<Approval | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const scroll = useRef<ScrollViewInstance>(null);

  useEffect(() => {
    const sock = new WebSocket(`${serverUrl().replace(/^http/, "ws")}/api/calls/${encodeURIComponent(inc.callId)}/live`);
    ws.current = sock;
    sock.onmessage = (m) => {
      let ev: any;
      try { ev = JSON.parse(String(m.data)); } catch { return; }
      if (ev.type === "transcript" && ev.final && ev.text) {
        setLines((ls) => (ls.some((l) => l.id === ev.id) ? ls.map((l) => (l.id === ev.id ? { ...l, text: ev.text } : l)) : [...ls, { id: ev.id, who: ev.who, text: ev.text }]));
      } else if (ev.type === "approval_request") setAsk({ id: ev.id, question: ev.question, options: ev.options ?? [] });
      else if (ev.type === "result") { setAsk(null); setEnded(ev.result?.summary ?? t.ended); }
      else if (ev.type === "status" && (ev.status === "ended" || ev.status === "failed")) setEnded((e) => e ?? t.ended);
    };
    sock.onclose = () => setEnded((e) => e ?? t.ended);
    return () => sock.close();
  }, [inc.callId, t.ended]);

  const send = (cmd: object) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(cmd)); };

  return (
    <View style={[styles.sheet, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]} accessibilityViewIsModal>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <T size={12} color={C.accent}>{ended ? "" : t.live.toUpperCase()}</T>
          <T size={17} weight="semibold" numberOfLines={1}>{inc.callerName}</T>
          <T size={14} numberOfLines={2}>{inc.topic}</T>
        </View>
        <Pressable accessibilityRole="button" style={styles.ghost} onPress={onClose}><T size={15}>{t.dismiss}</T></Pressable>
      </View>
      <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.lines} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}>
        {lines.length === 0 && !ended ? <T size={14}>{t.wait}</T> : null}
        {lines.map((l) => (
          <View key={l.id} style={[styles.line, l.who === "agent" ? styles.mine : styles.theirs]}>
            <T size={11} weight="semibold" style={{ opacity: 0.7 }}>{l.who === "agent" ? t.me : t.them}</T>
            <T size={15}>{l.text}</T>
          </View>
        ))}
        {ended ? <T size={14}>{ended}</T> : null}
      </ScrollView>
      {ask && !ended ? (
        <View style={styles.card}>
          <T size={12} color={C.accent}>{t.asks.toUpperCase()}</T>
          <T size={16} style={{ marginVertical: 6 }}>{ask.question}</T>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {ask.options.map((o, i) => (
              <Pressable key={o} accessibilityRole="button" style={i === 0 ? styles.solid : styles.ghost} onPress={() => { send({ type: "approval_response", id: ask.id, choice: o }); setAsk(null); }}>
                <T size={15} weight={i === 0 ? "semibold" : "regular"} color={i === 0 ? C.inv : C.ink}>{o}</T>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
      {!ended ? (
        <Pressable accessibilityRole="button" style={[styles.ghost, { marginHorizontal: PAD }]} onPress={() => send({ type: "hangup" })}>
          <T size={15} color={C.danger}>{t.hang}</T>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  banner: { position: "absolute", left: 12, right: 12, zIndex: 50, flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.accent, backgroundColor: C.surface },
  sheet: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 60, backgroundColor: C.app },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: PAD, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  lines: { padding: PAD, gap: 8 },
  line: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, maxWidth: "85%" },
  mine: { alignSelf: "flex-end", backgroundColor: C.accentSoft },
  theirs: { alignSelf: "flex-start", backgroundColor: C.surface2 },
  card: { margin: PAD, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.accent, backgroundColor: C.surface },
  solid: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  ghost: { minHeight: 44, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: C.line2, alignItems: "center", justifyContent: "center" },
}));
