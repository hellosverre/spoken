import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Alert, findNodeHandle, Keyboard, KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, type HostInstance } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fill, type Row } from "../lib/i18n";
import { SCENARIOS } from "../lib/scenarios";
import type { MobileCopy } from "../lib/copy-mobile";
import type { Sheet as SheetContent, SpokenStore } from "../lib/store";
import { ease, em, F, HEADING_SCALE, makeStyles, PAD, small, useLargeText, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Composer } from "./Composer";
import { Glow, PulseRings } from "./Art";
import { HoldBanner } from "./HoldBanner";
import { ReplyChips } from "./ReplyChips";
import { DoneArt, NothingAgreedArt } from "./drawings/ResultArt";
import { CallFeedback } from "./Feedback";
import { FactStrip, getFacts } from "./FactStrip";
import { Receipt } from "./Receipt";
import { Icon, Mark } from "./Icon";
import { Btn, CHAT_KEYBOARD_DISMISS, JumpToLatest, Press, T, TapToDismiss, useSpeechLang, useStickToEnd } from "./ui";
import { MultiCall } from "./Compare";

// The live call, as web/src/components/Call.tsx: who you're calling, who is
// talking right now, every word as chat bubbles, a way to tell Spoken
// something, and a bottom sheet for approvals and the result.

export function Call() {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const multi = useSpoken((s) => s.multi);
  if (multi) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <MultiCall />
      </View>
    );
  }
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView behavior="padding" style={styles.grow}>
        <CallHead />
        <View style={styles.pad}>
          <Speaker />
          <HoldBanner />
        </View>
        <FactStrip />
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

/** Hanging up can't be undone on a real call, so it asks first (the button, and Android back). */
export function confirmEndCall(store: SpokenStore, m: MobileCopy) {
  Alert.alert(m.endCallQ, m.endCallBody, [
    { text: m.keepCall, style: "cancel" },
    { text: m.endCallQ.replace(/\?$/, ""), style: "destructive", onPress: () => store.endCall() },
  ]);
}

/** How far call-screen chrome (header, status, chips) grows with the text size. */
const CHROME_SCALE = 1.5;

// No status pill here (the web's "Live" badge): the speaker card right below
// already says who is talking, and the timer shows the call is running.
function CallHead() {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const styles = useStyles();
  const { contact, number } = useContact();
  const elapsed = useSpoken((s) => s.elapsed);
  const callEnded = useSpoken((s) => s.callEnded);

  return (
    <View style={styles.callhead}>
      {/* Large text: the header grows less, so the transcript keeps the screen. */}
      <View style={styles.grow}>
        <T size={16} weight="medium" maxFontSizeMultiplier={CHROME_SCALE}>
          {contact}
        </T>
        <Text style={styles.num} maxFontSizeMultiplier={CHROME_SCALE}>
          {number} · <Text style={styles.timer}>{elapsed}</Text>
        </Text>
      </View>
      <Press accessibilityLabel={t.endCall} disabled={callEnded} onPress={() => confirmEndCall(store, m)} style={[styles.endbtn, callEnded && { opacity: 0.3 }]}>
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
  // Large text: just the words, so the transcript keeps most of the screen.
  const compact = useLargeText();

  const label =
    who === "them" ? fill(t.speakingThem, { name: contact })
    : who === "ai" ? t.speakingAi
    : note === "ringing" ? fill(t.ringingLbl, { name: contact })
    : note === "ended" ? t.ended
    : t.listening;

  return (
    <View style={[styles.speaker, compact && styles.speakerCompact]}>
      {/* The glow sits on whoever is talking: neutral for them, the accent for Spoken. */}
      <SideGlow on={who === "them"} side="left" color={C.ink} />
      <SideGlow on={who === "ai"} side="right" color={C.accent} />
      {/* Who is talking is said in the label below (and each line is read out), so the pods are visual only. */}
      {compact ? null : (
        <View style={styles.pods} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.podWrap}>
            <PulseRings active={who === "them"} color={C.muted} size={56} />
            <View style={[styles.pod, styles.podThem, who === "ai" && styles.quiet]}>
              <T size={15} weight="semibold">
                {init}
              </T>
            </View>
          </View>
          <View style={styles.wave}>
            {Array.from({ length: 9 }, (_, i) => (
              <Bar key={i} i={i} who={who} />
            ))}
          </View>
          <View style={styles.podWrap}>
            <PulseRings active={who === "ai"} color={C.accent} size={56} />
            <View style={[styles.pod, styles.podAi, who === "them" && styles.quiet]}>
              <Mark w={26} h={16} color={C.inv} />
            </View>
          </View>
        </View>
      )}
      <Text style={[styles.speakerLabel, who && { color: C.muted }]} maxFontSizeMultiplier={CHROME_SCALE}>
        {label}
      </Text>
    </View>
  );
}

/** A glow on one side of the speaker card that fades in while that side talks. */
function SideGlow({ on, side, color }: { on: boolean; side: "left" | "right"; color: string }) {
  const { C } = useTheme();
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = withTiming(on ? 1 : 0, { duration: on ? 250 : 500, easing: ease });
  }, [on, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, anim]}>
      <Glow color={color} opacity={C.glow * (color === C.ink ? 0.45 : 1)} cx={side === "left" ? 0.12 : 0.88} cy={0.4} r={0.7} />
    </Animated.View>
  );
}

/** One level bar: bounces while someone talks, staggered like the web's nth-child delays. */
function Bar({ i, who }: { i: number; who: "them" | "ai" | null }) {
  const { C } = useTheme();
  const styles = useStyles();
  const reduce = useReducedMotion();
  const s = useSharedValue(0.15);
  const n = i + 1;
  const offset = n % 5 === 0 ? 150 : n % 3 === 0 ? 550 : n % 2 === 0 ? 300 : 0;
  useEffect(() => {
    // Reduced motion: still bars, tall while someone talks.
    if (!who || reduce) {
      s.value = withTiming(who ? 0.3 + ((n * 37) % 60) / 100 : 0.15, { duration: 200 });
      return;
    }
    s.value = withDelay(offset, withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0.2, { duration: 400 })), -1));
  }, [who, offset, s, reduce, n]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }));
  const color = who === "ai" ? C.accent : who === "them" ? C.ink : C.line2;
  return <Animated.View style={[styles.bar, { backgroundColor: color }, anim]} />;
}

function Transcript() {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const { contact } = useContact();
  const speechLang = useSpeechLang();
  const lines = useSpoken((s) => s.transcript);
  // Follows new words only while you're at the bottom; scrolled up to reread, it stays put.
  const stick = useStickToEnd();

  return (
    <View style={styles.grow}>
      <ScrollView
        {...stick.props}
        style={styles.grow}
        contentContainerStyle={styles.transcriptScroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={CHAT_KEYBOARD_DISMISS}
      >
        <TapToDismiss style={styles.transcript}>
          {lines.map((line) => {
            if (line.kind === "sys")
              return (
                <Text key={line.id} style={styles.sysText}>
                  {line.text}
                </Text>
              );
            if (line.kind === "you")
              return (
                <Animated.View
                  key={line.id}
                  entering={FadeIn.duration(300)}
                  style={[styles.msg, styles.right]}
                  accessible
                  accessibilityLabel={`${m.youLabel}: ${line.text}`}
                  accessibilityLanguage={speechLang}
                >
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
                accessibilityLanguage={speechLang}
              >
                <Text style={styles.who}>{ai ? m.aiLabel : contact}</Text>
                <View style={[styles.txt, ai ? styles.aiTxt : styles.themTxt]}>
                  <Text style={[styles.lineText, ai && { color: C.inv }]}>{text}</Text>
                </View>
              </Animated.View>
            );
          })}
        </TapToDismiss>
      </ScrollView>
      <JumpToLatest on={stick.behind} onPress={() => stick.toEnd()} />
    </View>
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
  // The call is over: nothing to type into, so the keyboard goes with the field.
  useEffect(() => {
    if (ended) Keyboard.dismiss();
  }, [ended]);

  return (
    <View style={[styles.composer, { paddingBottom: 12 + insets.bottom }]}>
      {ended ? (
        <Animated.View entering={FadeIn.duration(250)}>
          <Btn block label={m.backHome} onPress={() => store.goHome()} />
        </Animated.View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
            <ReplyChips repeat={t.chipRepeat} thanks={t.chipThanks} />
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

type TitleRef = React.RefObject<HostInstance | null>;

function Sheet() {
  const store = useStore();
  const styles = useStyles();
  const sheet = useSpoken((s) => s.sheet);
  const open = useSpoken((s) => s.sheetOpen);
  const insets = useSafeAreaInsets();
  const reduce = useReducedMotion();
  const [h, setH] = useState(800);
  const p = useSharedValue(0);
  const title = useRef<HostInstance>(null);
  // A new approval or a result: the question or outcome is read first.
  const key = sheet?.kind === "ask" ? sheet.since : sheet?.title;

  useEffect(() => {
    p.value = withTiming(open ? 1 : 0, { duration: open ? 350 : 250, easing: ease });
  }, [open, p]);

  // Move screen-reader focus to the sheet's heading once it is up.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      const node = title.current && findNodeHandle(title.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, reduce ? 100 : 450);
    return () => clearTimeout(id);
  }, [open, key, reduce]);

  const scrim = useAnimatedStyle(() => ({ opacity: p.value }));
  // Reduced motion: the sheet fades in place instead of sliding up.
  const slide = useAnimatedStyle(() =>
    reduce ? { opacity: p.value } : { transform: [{ translateY: (1 - p.value) * h }] },
  );

  return (
    <>
      <Animated.View pointerEvents={open ? "auto" : "none"} style={[StyleSheet.absoluteFill, styles.scrim, scrim]} />
      <Animated.View
        pointerEvents={open ? "auto" : "none"}
        accessibilityViewIsModal={open}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "yes" : "no-hide-descendants"}
        // VoiceOver's escape gesture closes a result. An approval stays until it is answered.
        onAccessibilityEscape={sheet?.kind === "result" ? () => store.closeSheet() : undefined}
        onLayout={(e) => setH(e.nativeEvent.layout.height)}
        style={[styles.sheet, { paddingBottom: 18 + insets.bottom }, slide]}
      >
        {sheet?.kind === "ask" ? <AskSheet sheet={sheet} title={title} /> : null}
        {sheet?.kind === "result" ? <ResultSheet sheet={sheet} title={title} /> : null}
      </Animated.View>
    </>
  );
}

/** Label and value side by side; stacked when the text is large. */
export function Rows({ rows }: { rows: Row[] }) {
  const { C } = useTheme();
  const styles = useStyles();
  const stack = useLargeText();
  return (
    <View>
      {rows.map(([k, v]) => (
        <View key={k} style={[styles.dlRow, stack && styles.dlStack]} accessible accessibilityLabel={`${k}: ${v}`}>
          <T size={14} color={C.muted}>
            {k}
          </T>
          <T size={14} weight="medium" style={stack ? undefined : styles.dd}>
            {v}
          </T>
        </View>
      ))}
    </View>
  );
}

/** How long the other side has been holding: m:ss, ticking once a second. */
function Waited({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</>;
}

/** Key facts (price, time …) as chips instead of a table, read out as one list. */
function Chips({ items }: { items: string[] }) {
  const { C } = useTheme();
  const styles = useStyles();
  if (!items.length) return null;
  return (
    <View style={styles.chipRow} accessible accessibilityLabel={items.join(", ")}>
      {items.map((v, i) => (
        <View key={`${i}-${v}`} style={styles.rchip}>
          <T size={14} weight="medium" color={C.ink}>{v}</T>
        </View>
      ))}
    </View>
  );
}

function AskSheet({ sheet, title }: { sheet: Extract<SheetContent, { kind: "ask" }>; title: TitleRef }) {
  const store = useStore();
  const t = useCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const stack = useLargeText();
  const speechLang = useSpeechLang();
  const { cfg, pressed } = sheet;
  // Times side by side, unless the text is too big for them to fit.
  const many = cfg.options.length > 1 && !stack;
  // Key facts (price, time …) as at most three chips instead of a table.
  const facts = cfg.rows.map(([, v]) => v).filter(Boolean).slice(0, 3);

  return (
    <>
      {/* The question scrolls at large text sizes; the answers below always stay on screen. */}
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody}>
        {/* Not a live region: the timer would be read out every second. */}
        <Text style={styles.flagText}>
          {t.waiting} · <Waited since={sheet.since} />
        </Text>
        <Text ref={title} style={[styles.h3, styles.askH]} accessibilityRole="header" accessibilityLanguage={speechLang} maxFontSizeMultiplier={HEADING_SCALE}>
          {cfg.title}
        </Text>
        <Chips items={facts} />
      </ScrollView>
      <View style={[styles.acts, styles.pinned]}>
        <View style={many ? styles.optrow : styles.acts}>
          {cfg.options.map((o) => (
            <Btn
              key={o.v}
              block
              label={o.label}
              pressed={pressed === o.v}
              onPress={() => store.choose(o.v)}
              style={[styles.bigBtn, many ? styles.grow : null]}
            />
          ))}
        </View>
        <Btn kind="ghost" block label={cfg.decline} onPress={() => store.choose("no")} />
        <Text style={[styles.hold, styles.holdSmall]}>
          {t.holdSaid} <Text style={{ color: C.muted }}>“{cfg.hold}”</Text>
        </Text>
      </View>
    </>
  );
}

function ResultSheet({ sheet, title }: { sheet: Extract<SheetContent, { kind: "result" }>; title: TitleRef }) {
  const store = useStore();
  const t = useCopy();
  const lang = useSpoken((s) => s.lang);
  const { C } = useTheme();
  const styles = useStyles();
  const compact = useLargeText();
  const speechLang = useSpeechLang();
  const [more, setMore] = useState(false);
  const rows = sheet.rows.slice(0, 4);
  const facts = getFacts().map((f) => f.value).filter((v) => !rows.some(([, rv]) => rv === v)).slice(0, 4);
  const details = lang === "en" ? "Details" : "Detaljer";

  return (
    // The comment box is in here too, so the keyboard insets keep it in view.
    <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      {compact ? null : (
        <Animated.View entering={FadeIn.duration(350)}>{sheet.ok ? <DoneArt width={104} /> : <NothingAgreedArt width={104} />}</Animated.View>
      )}
      <Text ref={title} style={styles.h3} accessibilityRole="header" accessibilityLanguage={speechLang} maxFontSizeMultiplier={HEADING_SCALE}>
        {sheet.title}
      </Text>
      <Rows rows={rows} />
      <Chips items={facts} />
      <Press onPress={() => setMore(!more)} accessibilityRole="button" accessibilityState={{ expanded: more }} accessibilityLabel={details} style={styles.detToggle}>
        <T size={15} color={C.muted}>
          {details} {more ? "▴" : "▾"}
        </T>
      </Press>
      {more ? <Receipt /> : null}
      <CallFeedback />
      <View style={styles.acts}>
        <Btn block label={t.back} onPress={() => store.goHome()} style={styles.bigBtn} />
        <Press onPress={() => store.closeSheet()} accessibilityRole="button" accessibilityLabel={t.readT} style={styles.detToggle}>
          <T size={15} color={C.muted} style={{ textDecorationLine: "underline" }}>
            {t.readT}
          </T>
        </Press>
      </View>
    </ScrollView>
  );
}

/** Shared with the multi-call view so its transcript looks exactly like this one. */
export const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  grow: { flex: 1 },
  pad: { paddingHorizontal: PAD },
  callhead: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 10 },
  num: { fontFamily: F.regular, fontSize: 13, color: C.dim },
  timer: { color: C.muted, fontVariant: ["tabular-nums"] },
  endbtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.danger, alignItems: "center", justifyContent: "center" },
  speaker: {
    marginVertical: 4,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 22,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 14,
    gap: 14,
    overflow: "hidden",
    boxShadow: C.lift,
  },
  pods: { flexDirection: "row", alignItems: "center", gap: 14 },
  podWrap: { width: 56, height: 56 },
  pod: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  podThem: { backgroundColor: C.surface2 },
  podAi: { backgroundColor: C.accent },
  quiet: { opacity: 0.35 },
  speakerCompact: { paddingTop: 8, paddingBottom: 8, borderRadius: 14 },
  wave: { flex: 1, flexDirection: "row", gap: 5, justifyContent: "center", alignItems: "center", height: 36 },
  bar: { width: 4, height: 36, borderRadius: 2 },
  speakerLabel: { fontFamily: F.medium, fontSize: 13.5, textAlign: "center", color: C.dim, minHeight: 18 },
  // The tap-to-close area fills the scroll view even while the transcript is short.
  transcriptScroll: { flexGrow: 1 },
  transcript: { flexGrow: 1, gap: 12, paddingHorizontal: PAD, paddingTop: 10, paddingBottom: 16 },
  msg: { maxWidth: "88%", gap: 4 },
  left: { alignSelf: "flex-start" },
  right: { alignSelf: "flex-end", alignItems: "flex-end" },
  who: { ...small(12.5), color: C.dim, paddingHorizontal: 2 },
  txt: { paddingVertical: 11, paddingHorizontal: 15, borderRadius: 20 },
  themTxt: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2, borderBottomLeftRadius: 6 },
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
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { gap: 16, paddingBottom: 4 },
  pinned: { paddingTop: 14 },
  flagText: { fontFamily: F.medium, fontSize: 14, color: C.accent, marginBottom: -8 },
  h3: { fontFamily: F.semibold, fontSize: 29, lineHeight: 32, letterSpacing: em(-0.02, 29), color: C.ink },
  dlRow: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.line },
  dd: { textAlign: "right", flexShrink: 1 },
  dlStack: { flexDirection: "column", gap: 2 },
  hold: { fontFamily: F.regular, fontSize: 13.5, lineHeight: 20, color: C.dim },
  acts: { gap: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  rchip: { minHeight: 30, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: C.line2, justifyContent: "center" },
  askH: { fontSize: 24, lineHeight: 29 },
  holdSmall: { fontSize: 12, lineHeight: 17, textAlign: "center" },
  bigBtn: { minHeight: 56 },
  detToggle: { minHeight: 44, justifyContent: "center", alignItems: "center" },
  optrow: { flexDirection: "row", gap: 8 },
  badge: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: C.accent },
}));
