import { useEffect, useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, useWindowDimensions, View, type ScrollViewInstance } from "react-native";
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { planTargets } from "../lib/real-call";
import { SCENARIOS } from "../lib/scenarios";
import type { Tab, ThreadItem } from "../lib/store";
import { em, F, makeStyles, PAD, small, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Composer } from "./Composer";
import { CHAT_HERO_RATIO, ChatHero } from "./drawings/ChatHero";
import { Icon, Wordmark, type IconName } from "./Icon";
import { Presets } from "./Presets";
import { Profile } from "./Profile";
import { Btn, Dots, Press, Rise, T } from "./ui";
import { QuestionSheet } from "./QuestionSheet";

// The tabbed part of the app, as web/src/components/Home.tsx: Home (presets and
// demos; the web's Demo tab), the chat with Spoken, and Profile, switched by the
// tab bar at the bottom.

export function Home() {
  const store = useStore();
  const t = useCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const threaded = useSpoken((s) => s.threaded);
  const tab = useSpoken((s) => s.tab);
  const on = useSpoken((s) => s.screen === "home");

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topbar}>
        <Wordmark />
        <FadeSwitch on={threaded && tab === "chat"}>
          <Press accessibilityLabel={t.newChat} onPress={() => store.newChat()} style={styles.iconbtn}>
            <Icon name="plus" color={C.muted} size={16} />
          </Press>
        </FadeSwitch>
      </View>
      <View style={styles.panes}>
        {tab === "chat" ? <ChatPane screenOn={on} /> : null}
        {tab === "home" ? (
          <Pane>
            <Presets />
          </Pane>
        ) : null}
        {tab === "settings" ? (
          <Pane>
            <Profile />
          </Pane>
        ) : null}
      </View>
      <TabBar tab={tab} />
      <QuestionSheet />
    </KeyboardAvoidingView>
  );
}

/** Fades a control in and out without moving the layout (.newchat). */
function FadeSwitch({ on, children }: { on: boolean; children: ReactNode }) {
  const o = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    o.value = withTiming(on ? 1 : 0, { duration: 200 });
  }, [on, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View style={anim} pointerEvents={on ? "auto" : "none"} accessibilityElementsHidden={!on}>
      {children}
    </Animated.View>
  );
}

/** A tab's body fades in as it opens (.pane.on). */
function Pane({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(280)} style={styles.pane}>
      {children}
    </Animated.View>
  );
}

/* ---------- chat ---------- */

function ChatPane({ screenOn }: { screenOn: boolean }) {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const thread = useSpoken((s) => s.thread);
  const threaded = useSpoken((s) => s.threaded);
  const draft = useSpoken((s) => s.draft);
  const focusTick = useSpoken((s) => s.focusTick);
  const scroll = useRef<ScrollViewInstance>(null);

  return (
    <Pane>
      <ScrollView
        ref={scroll}
        style={styles.grow}
        contentContainerStyle={styles.chatScroll}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: thread.at(-1)?.kind === "plan" })}
      >
        {threaded ? (
          <View style={styles.thread} accessibilityLiveRegion="polite">
            {thread.map((item) => (
              <ThreadEntry key={item.id} item={item} />
            ))}
          </View>
        ) : (
          <View style={styles.empty}>
            <Rise i={0} on={screenOn}>
              <ChatHeader title={t.ask} lede={t.askSub} />
            </Rise>
            {/* Real example requests instead of generic chips: tap one to send it. */}
            <Rise i={1} on={screenOn} style={styles.examples}>
              <Text style={styles.examplesL}>{m.tryOne}</Text>
              {(["pizza", "doctor"] as const).map((k) => (
                <Example key={k} icon={k} text={SCENARIOS[k][lang].request} onPress={() => store.preset(k)} />
              ))}
            </Rise>
          </View>
        )}
      </ScrollView>
      <View style={styles.composer}>
        <Composer
          value={draft}
          onChange={(v) => store.setDraft(v)}
          onSubmit={() => store.submitDraft()}
          placeholder={t.ph}
          label={t.phAria}
          sendLabel={t.send}
          focusTick={focusTick}
        />
      </View>
    </Pane>
  );
}

/**
 * The top of the empty chat: the illustration edge to edge, with the heading set on
 * its lower part, which fades into the page (see drawings/ChatHero).
 */
function ChatHeader({ title, lede }: { title: string; lede: string }) {
  const styles = useStyles();
  const { width } = useWindowDimensions();
  const height = width / CHAT_HERO_RATIO;
  return (
    <View style={[styles.hero, { minHeight: height }]}>
      <View style={styles.heroArt} accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none">
        <ChatHero width={width} />
      </View>
      <View style={[styles.heroText, { paddingTop: height * 0.5 }]}>
        <Text style={styles.greet} accessibilityRole="header">
          {title}
        </Text>
        <Text style={[styles.lede, styles.ledeLeft]}>{lede}</Text>
      </View>
    </View>
  );
}

function Example({ icon, text, onPress }: { icon: IconName; text: string; onPress: () => void }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <Press onPress={onPress} accessibilityLabel={text} scale={0.98} style={styles.example}>
      <View style={styles.exampleIc}>
        <Icon name={icon} color={C.accent} size={18} />
      </View>
      <Text style={styles.exampleText}>
        {text}
      </Text>
      <Icon name="chevron" color={C.dim} size={16} />
    </Press>
  );
}

export function Chip({ icon, label, onPress }: { icon?: IconName; label: string; onPress: () => void }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <Press onPress={onPress} accessibilityLabel={label} style={styles.chip}>
      {icon ? <Icon name={icon} color={C.accent} size={15} /> : null}
      <Text style={styles.chipText}>{label}</Text>
    </Press>
  );
}

function ThreadEntry({ item }: { item: ThreadItem }) {
  const styles = useStyles();
  switch (item.kind) {
    case "me":
    case "bot":
      return (
        <Animated.View entering={FadeIn.duration(300)} style={[styles.bubble, item.kind === "me" ? styles.me : styles.bot]}>
          <Text style={[styles.bubbleText, item.kind === "me" && styles.meText]}>{item.text}</Text>
        </Animated.View>
      );
    case "dots":
      return (
        <View style={[styles.bubble, styles.bot, { padding: 0 }]}>
          <Dots />
        </View>
      );
    case "plan":
      return <PlanCard item={item} />;
  }
}

function PlanCard({ item }: { item: Extract<ThreadItem, { kind: "plan" }> }) {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const sc = SCENARIOS[item.scenario];
  const L = sc[lang];
  const targets = planTargets(item.scenario);

  return (
    <Animated.View entering={FadeIn.duration(350)} style={styles.plan}>
      {targets ? (
        <View style={[styles.who, { flexDirection: "column", alignItems: "stretch", gap: 10 }]}>
          <T size={16} weight="medium">
            {lang === "no" ? `Ringer ${targets.length} steder samtidig` : `Calling ${targets.length} places at once`}
          </T>
          {targets.map((x) => (
            <View key={x.phone} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <Avatar init={x.name.replace(/[^\p{L}]/gu, "").slice(0, 2).toUpperCase() || "#"} />
              <View style={styles.grow}>
                <T size={16} weight="medium">
                  {x.name}
                </T>
                <T size={13} color={C.muted}>
                  {x.phone}
                </T>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.who}>
          <Avatar init={sc.init} />
          <View style={styles.grow}>
            <T size={16} weight="medium">
              {L.contact}
            </T>
            <T size={13} color={C.muted}>
              {sc.number}
            </T>
          </View>
        </View>
      )}
      <View>
        <Text style={styles.fieldL}>{t.planGoal}</Text>
        <T>{L.goal}</T>
      </View>
      <View>
        <Text style={styles.fieldL}>{t.planAsk}</Text>
        <View style={styles.checks}>
          {L.checks.map((c) => (
            <View key={c} style={styles.check}>
              <T size={13} color={C.accent2}>
                {c}
              </T>
            </View>
          ))}
        </View>
      </View>
      <View>
        <Text style={styles.fieldL}>{t.planOpen}</Text>
        <View style={styles.quote}>
          <T color={C.muted} style={{ lineHeight: 22 }}>
            “{L.opening}”
          </T>
        </View>
      </View>
      <View style={styles.actsCol}>
        <Btn block label={targets ? (lang === "no" ? `Ring ${targets.length} steder` : `Call ${targets.length} places`) : t.start} pressed={item.pressed} icon={<Icon name="phone" color={C.inv} />} onPress={() => store.startCall()} />
        <View style={styles.acts}>
          <Btn kind="ghost" label={t.edit} icon={<Icon name="pencil" color={C.ink} size={17} />} onPress={() => store.editPlan(item.request)} style={styles.grow} />
          {/* Mobile: drop the plan without calling, back to an empty chat. */}
          <Btn kind="ghost" label={m.cancel} icon={<Icon name="x" color={C.ink} size={17} />} onPress={() => store.newChat()} style={styles.grow} />
        </View>
      </View>
    </Animated.View>
  );
}

export function Avatar({ init }: { init: string }) {
  const styles = useStyles();
  return (
    <View style={styles.av}>
      <T size={12} weight="medium">
        {init}
      </T>
    </View>
  );
}

/* ---------- tab bar ---------- */

function TabBar({ tab }: { tab: Tab }) {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const tabs: { id: Tab; icon: IconName; label: string }[] = [
    { id: "home", icon: "home", label: m.homeTab },
    { id: "chat", icon: "bubble", label: t.chatTab },
    { id: "settings", icon: "person", label: m.profileTab },
  ];

  return (
    <View style={[styles.tabbar, { paddingBottom: 12 + insets.bottom }]}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((x) => {
          const on = tab === x.id;
          const color = on ? C.ink : C.muted;
          return (
            <Pressable
              key={x.id}
              accessibilityRole="tab"
              accessibilityLabel={x.label}
              accessibilityState={{ selected: on }}
              onPress={() => store.setTab(x.id)}
              style={[styles.tab, on && styles.tabOn]}
            >
              <Icon name={x.icon} color={color} size={22} />
              <Text style={[styles.tabLabel, { color }]}>
                {x.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  grow: { flex: 1 },
  left: { textAlign: "left" },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 6, minHeight: 34 },
  iconbtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, borderColor: C.line2, alignItems: "center", justifyContent: "center" },
  panes: { flex: 1, minHeight: 0 },
  pane: { flex: 1 },
  chatScroll: { flexGrow: 1, paddingHorizontal: PAD },
  empty: { paddingBottom: 12 },
  // Edge to edge: cancels the scroll view's side padding.
  hero: { marginHorizontal: -PAD },
  heroArt: { position: "absolute", top: 0, left: 0, right: 0 },
  heroText: { paddingHorizontal: PAD },
  greet: { fontFamily: F.semibold, fontSize: 34, lineHeight: 37, letterSpacing: em(-0.024, 34), color: C.ink, marginBottom: 10, maxWidth: 300 },
  lede: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted, textAlign: "center", maxWidth: 290 },
  ledeLeft: { textAlign: "left", maxWidth: 320 },
  examples: { marginTop: 26, gap: 8 },
  examplesL: { fontFamily: F.medium, fontSize: 13, color: C.dim, marginBottom: 2 },
  example: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, boxShadow: C.lift },
  exampleIc: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: C.accentSoft },
  exampleText: { flex: 1, fontFamily: F.regular, fontSize: 14.5, lineHeight: 20, color: C.ink },
  thread: { gap: 10, paddingTop: 16, paddingBottom: 24 },
  composer: { paddingHorizontal: PAD, paddingTop: 10, paddingBottom: 6, backgroundColor: C.app },
  chip: { minHeight: 30, paddingVertical: 4, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.line2, flexDirection: "row", alignItems: "center", gap: 7 },
  chipText: { fontFamily: F.regular, fontSize: 13, color: C.muted },
  bubble: { maxWidth: "84%", paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18 },
  me: { alignSelf: "flex-end", backgroundColor: C.ink, borderBottomRightRadius: 6 },
  bot: { alignSelf: "flex-start", backgroundColor: C.surface, borderBottomLeftRadius: 6 },
  bubbleText: { fontFamily: F.regular, fontSize: 16, lineHeight: 22, color: C.ink },
  meText: { color: C.inv },
  plan: { alignSelf: "stretch", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 18, padding: 18, gap: 16, boxShadow: C.lift },
  who: { flexDirection: "row", gap: 12, alignItems: "center", paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  av: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: C.accentSoft },
  fieldL: { ...small(13), color: C.dim, marginBottom: 4 },
  checks: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  check: { paddingVertical: 5, paddingHorizontal: 11, borderRadius: 999, backgroundColor: C.accentSoft },
  quote: { borderLeftWidth: 1, borderLeftColor: C.accent, paddingLeft: 12 },
  actsCol: { gap: 8 },
  acts: { flexDirection: "row", gap: 8 },
  paneBody: { paddingHorizontal: PAD, paddingTop: 20, paddingBottom: 24 },
  paneH: { fontFamily: F.semibold, fontSize: 28, lineHeight: 31, letterSpacing: em(-0.02, 28), color: C.ink, marginTop: 10, marginBottom: 8 },
  // Bigger than the web's compact pill: full width, 56 pt tabs, every label visible.
  tabbar: { paddingTop: 8, paddingHorizontal: 12, backgroundColor: C.app },
  tabs: { flexDirection: "row", gap: 4, padding: 5, borderWidth: 1, borderColor: C.line, borderRadius: 999, backgroundColor: C.surface },
  tab: { flex: 1, minHeight: 56, paddingVertical: 6, flexWrap: "wrap", borderRadius: 999, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 8 },
  tabOn: { backgroundColor: C.surface2 },
  tabLabel: { fontFamily: F.medium, fontSize: 15, letterSpacing: em(-0.006, 15) },
}));
