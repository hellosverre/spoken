import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, findNodeHandle, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, type HostInstance, type ScrollViewInstance } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fill, type Row } from "../lib/i18n";
import { SCENARIOS } from "../lib/scenarios";
import type { Sheet as SheetContent } from "../lib/store";
import { ease, em, F, makeStyles, PAD, small, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Composer } from "./Composer";
import { Chip } from "./Home";
import { Icon, Mark } from "./Icon";
import { Btn, Press, T } from "./ui";

// The live call, as web/src/components/Call.tsx: who you're calling, who is
// talking right now, every word as chat bubbles, a way to tell Spoken
// something, and a bottom sheet for approvals and the result.

export function Call() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView behavior="padding" style={styles.grow}>
        <CallHead />
        <View style={styles.pad}>
          <Speaker />
        </View>
        <Transcript />
        <CallFooter />
      </KeyboardAvoidingView>
      <Sheet />
    </View>
  );
}

function useContact() {
  const scenario = useSpoken((s) => s.scenario);
  const lang = useSpoken((s) => s.lang);
  const sc = SCENARIOS[scenario];
  return { ...sc, contact: sc[lang].contact };
}

// No status pill here (the web's "Live" badge): the speaker card right below
// already says who is talking, and the timer shows the call is running.
function CallHead() {
  const store = useStore();
  const t = useCopy();
  const styles = useStyles();
  const { contact, number } = useContact();
  const elapsed = useSpoken((s) => s.elapsed);
  const callEnded = useSpoken((s) => s.callEnded);

  return (
    <View style={styles.callhead}>
      <View style={styles.grow}>
        <T size={16} weight="medium" numberOfLines={1}>
          {contact}
        </T>
        <Text style={styles.num} numberOfLines={1}>
          {number} · <Text style={styles.timer}>{elapsed}</Text>
        </Text>
      </View>
      <Press accessibilityLabel={t.endCall} disabled={callEnded} onPress={() => store.endCall()} style={[styles.endbtn, callEnded && { opacity: 0.3 }]}>
        <Icon name="hang" color="#fff" />
      </Press>
    </View>
  );
}

/** Shows who is talking right now, with a moving level meter. */
function Speaker() {
  const t = useCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const { contact, init } = useContact();
  const who = useSpoken((s) => s.speaker);
  const note = useSpoken((s) => s.speakerNote);

  const label =
    who === "them" ? fill(t.speakingThem, { name: contact })
    : who === "ai" ? t.speakingAi
    : note === "ringing" ? fill(t.ringingLbl, { name: contact })
    : note === "ended" ? t.ended
    : t.listening;

  return (
    <View style={styles.speaker}>
      <View style={styles.pods}>
        <View style={[styles.pod, styles.podThem, who === "ai" && styles.quiet]}>
          <T size={13} weight="medium">
            {init}
          </T>
        </View>
        <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {Array.from({ length: 9 }, (_, i) => (
            <Bar key={i} i={i} who={who} />
          ))}
        </View>
        <View style={[styles.pod, styles.podAi, who === "them" && styles.quiet]}>
          <Mark w={18} h={14} r={8} tuck={2} color={C.inv} />
        </View>
      </View>
      <Text style={[styles.speakerLabel, who && { color: C.muted }]} accessibilityLiveRegion="polite">
        {label}
      </Text>
    </View>
  );
}

/** One level bar: bounces while someone talks, staggered like the web's nth-child delays. */
function Bar({ i, who }: { i: number; who: "them" | "ai" | null }) {
  const { C } = useTheme();
  const styles = useStyles();
  const s = useSharedValue(0.15);
  const n = i + 1;
  const offset = n % 5 === 0 ? 150 : n % 3 === 0 ? 550 : n % 2 === 0 ? 300 : 0;
  useEffect(() => {
    if (!who) {
      s.value = withTiming(0.15, { duration: 200 });
      return;
    }
    s.value = withDelay(offset, withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.2, { duration: 400 })), -1));
  }, [who, offset, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }));
  const color = who === "ai" ? C.accent : who === "them" ? C.muted : C.line2;
  return <Animated.View style={[styles.bar, { backgroundColor: color }, anim]} />;
}

function Transcript() {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const { contact } = useContact();
  const lines = useSpoken((s) => s.transcript);
  const scroll = useRef<ScrollViewInstance>(null);

  return (
    <ScrollView
      ref={scroll}
      style={styles.grow}
      contentContainerStyle={styles.transcript}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      keyboardShouldPersistTaps="handled"
    >
      {lines.map((line) => {
        if (line.kind === "sys")
          return (
            <Text key={line.id} style={styles.sysText}>
              {line.text}
            </Text>
          );
        if (line.kind === "you")
          return (
            <Animated.View key={line.id} entering={FadeIn.duration(300)} style={[styles.msg, styles.right]}>
              <Text style={styles.who}>{m.youLabel}</Text>
              <View style={[styles.txt, styles.youTxt]}>
                <T size={14} color={C.muted}>
                  {line.text}
                </T>
              </View>
            </Animated.View>
          );
        const ai = line.kind === "ai";
        const text = line.words.join(" ");
        return (
          <Animated.View
            key={line.id}
            entering={FadeIn.duration(300)}
            style={[styles.msg, ai ? styles.right : styles.left]}
            accessible
            accessibilityLabel={`${ai ? m.aiLabel : contact}: ${text}`}
          >
            <Text style={styles.who}>{ai ? m.aiLabel : contact}</Text>
            <View style={[styles.txt, ai ? styles.aiTxt : styles.themTxt]}>
              <Text style={[styles.lineText, ai && { color: C.inv }]}>{text}</Text>
            </View>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

/**
 * During the call: chips and a message box for Spoken. Once the call has
 * ended there is nothing to send, so it becomes the way back home (the web
 * leaves you on the call screen after "Read transcript").
 */
function CallFooter() {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const ended = useSpoken((s) => s.callEnded);
  const [value, setValue] = useState("");

  return (
    <View style={[styles.composer, { paddingBottom: 12 + insets.bottom }]}>
      {ended ? (
        <Animated.View entering={FadeIn.duration(250)}>
          <Btn block label={m.backHome} onPress={() => store.goHome()} />
        </Animated.View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            <Chip label={t.chipRepeat} onPress={() => store.chip("repeat")} />
            <Chip label={t.chipThanks} onPress={() => store.chip("thanks")} />
          </ScrollView>
          <Composer
            value={value}
            onChange={setValue}
            onSubmit={() => {
              store.sendInstruction(value);
              setValue("");
            }}
            placeholder={t.instrPh}
            label={t.instrAria}
            sendLabel={t.sendInstr}
          />
        </>
      )}
    </View>
  );
}

/* ---------- bottom sheet: approvals and results ---------- */

function Sheet() {
  const styles = useStyles();
  const sheet = useSpoken((s) => s.sheet);
  const open = useSpoken((s) => s.sheetOpen);
  const insets = useSafeAreaInsets();
  const [h, setH] = useState(800);
  const p = useSharedValue(0);
  const first = useRef<HostInstance>(null);

  useEffect(() => {
    p.value = withTiming(open ? 1 : 0, { duration: open ? 350 : 250, easing: ease });
  }, [open, p]);

  // Move screen-reader focus to the first choice once the sheet has slid up.
  useEffect(() => {
    if (!open || sheet?.kind !== "ask") return;
    const id = setTimeout(() => {
      const node = first.current && findNodeHandle(first.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 450);
    return () => clearTimeout(id);
  }, [open, sheet]);

  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - p.value) * h }] }));

  return (
    <>
      <Animated.View pointerEvents={open ? "auto" : "none"} style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        accessibilityViewIsModal={open}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "yes" : "no-hide-descendants"}
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={[styles.sheet, { paddingBottom: 18 + insets.bottom }, slide]}
      >
        {sheet?.kind === "ask" ? <AskSheet sheet={sheet} first={first} /> : null}
        {sheet?.kind === "result" ? <ResultSheet sheet={sheet} /> : null}
      </Animated.View>
    </>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View>
      {rows.map(([k, v]) => (
        <View key={k} style={styles.dlRow}>
          <T size={14} color={C.muted}>
            {k}
          </T>
          <T size={14} weight="medium" style={styles.dd}>
            {v}
          </T>
        </View>
      ))}
    </View>
  );
}

function AskSheet({ sheet, first }: { sheet: Extract<SheetContent, { kind: "ask" }>; first: React.RefObject<HostInstance | null> }) {
  const store = useStore();
  const t = useCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const { cfg, pressed } = sheet;
  const many = cfg.options.length > 1;

  return (
    <>
      <Text style={styles.flagText} accessibilityRole="alert">
        {t.waiting}
      </Text>
      <Text style={styles.h3} accessibilityRole="header">
        {cfg.title}
      </Text>
      <Rows rows={cfg.rows} />
      <Text style={styles.hold}>
        {t.holdSaid} <Text style={{ color: C.muted }}>“{cfg.hold}”</Text>
      </Text>
      <View style={styles.acts}>
        <View ref={first} style={many ? styles.optrow : undefined}>
          {cfg.options.map((o) => (
            <Btn
              key={o.v}
              block
              label={o.label}
              pressed={pressed === o.v}
              icon={many ? undefined : <Icon name="check" color={C.inv} />}
              onPress={() => store.choose(o.v)}
              style={many ? styles.grow : undefined}
            />
          ))}
        </View>
        <Btn kind="ghost" block label={cfg.decline} onPress={() => store.choose("no")} />
      </View>
    </>
  );
}

function ResultSheet({ sheet }: { sheet: Extract<SheetContent, { kind: "result" }> }) {
  const store = useStore();
  const t = useCopy();
  const { C } = useTheme();
  const styles = useStyles();

  return (
    <>
      <Animated.View entering={FadeIn.duration(350)} style={[styles.badge, !sheet.ok && { backgroundColor: C.surface2 }]}>
        <Icon name={sheet.ok ? "check" : "x"} color={sheet.ok ? C.inv : C.muted} size={22} strokeWidth={2.2} />
      </Animated.View>
      <Text style={styles.h3} accessibilityRole="header">
        {sheet.title}
      </Text>
      <Rows rows={sheet.rows} />
      <View style={styles.acts}>
        <Btn block label={t.back} onPress={() => store.goHome()} />
        <Btn kind="ghost" block label={t.readT} onPress={() => store.closeSheet()} />
      </View>
    </>
  );
}

const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  grow: { flex: 1 },
  pad: { paddingHorizontal: PAD },
  callhead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 10 },
  num: { fontFamily: F.regular, fontSize: 13, color: C.dim },
  timer: { color: C.muted, fontVariant: ["tabular-nums"] },
  endbtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.danger, alignItems: "center", justifyContent: "center" },
  speaker: { marginVertical: 4, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 12, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  pods: { flexDirection: "row", alignItems: "center", gap: 12 },
  pod: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  podThem: { backgroundColor: C.surface2 },
  podAi: { backgroundColor: C.accent },
  quiet: { opacity: 0.35 },
  wave: { flex: 1, flexDirection: "row", gap: 4, justifyContent: "center", alignItems: "center", height: 28 },
  bar: { width: 3, height: 28, borderRadius: 2 },
  speakerLabel: { ...small(13), textAlign: "center", color: C.dim, minHeight: 18 },
  transcript: { gap: 12, paddingHorizontal: PAD, paddingTop: 10, paddingBottom: 16 },
  msg: { maxWidth: "88%", gap: 4 },
  left: { alignSelf: "flex-start" },
  right: { alignSelf: "flex-end", alignItems: "flex-end" },
  who: { ...small(12.5), color: C.dim, paddingHorizontal: 2 },
  txt: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
  themTxt: { backgroundColor: C.surface, borderBottomLeftRadius: 6 },
  aiTxt: { backgroundColor: C.ink, borderBottomRightRadius: 6 },
  youTxt: { borderWidth: 1, borderColor: C.line2, borderBottomRightRadius: 6 },
  lineText: { fontFamily: F.regular, fontSize: 17, lineHeight: 24, letterSpacing: em(-0.006, 17), color: C.ink },
  sysText: { ...small(12.5), color: C.dim, textAlign: "center", paddingVertical: 2 },
  composer: { paddingHorizontal: PAD, paddingTop: 10, backgroundColor: C.app },
  chips: { gap: 6, paddingBottom: 8 },
  scrim: { backgroundColor: C.scrim, zIndex: 20 },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 21,
    maxHeight: "85%",
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.accent,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 22,
    paddingHorizontal: PAD,
    gap: 16,
  },
  flagText: { fontFamily: F.medium, fontSize: 14, color: C.accent, marginBottom: -8 },
  h3: { fontFamily: F.semibold, fontSize: 29, lineHeight: 32, letterSpacing: em(-0.02, 29), color: C.ink },
  dlRow: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line },
  dd: { textAlign: "right", flexShrink: 1 },
  hold: { fontFamily: F.regular, fontSize: 13.5, lineHeight: 20, color: C.dim },
  acts: { gap: 8 },
  optrow: { flexDirection: "row", gap: 8 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: C.accent },
}));
