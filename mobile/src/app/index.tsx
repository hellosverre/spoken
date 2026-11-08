import { useEffect, useState, type ReactNode } from "react";
import { BackHandler, Keyboard, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { Call, confirmEndCall } from "../components/Call";
import { Home } from "../components/Home";
import { IncomingCall } from "../components/IncomingCall";
import { Intro } from "../components/Intro";
import { Login } from "../components/Login";
import { Plans } from "../components/Plans";
import { Signup } from "../components/Signup";
import type { Screen } from "../lib/store";
import { ease, makeStyles } from "../lib/theme";
import { MOBILE_COPY } from "../lib/copy-mobile";
import { useSpoken, useStore } from "../lib/use-spoken";

// The whole app is one device with its screens layered, like web/src/components/SpokenApp.tsx
// (plus the mobile login after the intro).
// The store decides which is on; the others fade out and stop taking touches.

export default function Device() {
  const store = useStore();
  const screen = useSpoken((s) => s.screen);
  const flashTick = useSpoken((s) => s.flashTick);
  const tab = useSpoken((s) => s.tab);
  const styles = useStyles();

  // Screens stay mounted under each other, so a focused field on the screen we just left kept the
  // keyboard up with nothing visible to type into. Moving to another screen or tab closes it.
  useEffect(() => {
    Keyboard.dismiss();
  }, [screen, tab]);

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  // Android back: skip the intro, return to the Home tab, close a result, or leave an ended call.
  // During a call it never sends the app away: an open approval stays until answered, and
  // otherwise it asks before hanging up. Elsewhere the OS handles it.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const s = store.getSnapshot();
      if (s.screen === "call" && s.sheetOpen && s.sheet?.kind === "result") store.closeSheet();
      else if (s.screen === "call" && s.callEnded) store.goHome();
      else if (s.screen === "call") {
        if (!s.sheetOpen) confirmEndCall(store, MOBILE_COPY[s.lang]);
      } else if (s.screen === "home" && s.tab !== "home") store.setTab("home");
      else if (s.screen === "intro") store.skipIntro();
      else if (s.screen === "signup") store.openLogin();
      else if (s.screen === "plans") store.openSignup();
      else return false;
      return true;
    });
    return () => sub.remove();
  }, [store]);

  return (
    <View style={styles.device}>
      <Layer name="intro" screen={screen}>
        <Intro />
      </Layer>
      <Layer name="login" screen={screen}>
        <Login />
      </Layer>
      <Layer name="signup" screen={screen}>
        <Signup />
      </Layer>
      <Layer name="plans" screen={screen}>
        <Plans />
      </Layer>
      <Layer name="home" screen={screen}>
        <Home />
      </Layer>
      <Layer name="call" screen={screen}>
        <Call />
      </Layer>
      <IncomingCall />
      {flashTick > 0 ? <FlashRing key={flashTick} /> : null}
    </View>
  );
}

/** A screen: fades and rises 8 pt in when on (.screen / .screen.on). */
function Layer({ name, screen, children }: { name: Screen; screen: Screen; children: ReactNode }) {
  const on = name === screen;
  const p = useSharedValue(on ? 1 : 0);
  // Once faded out, a layer is taken out of layout: its KeyboardAvoidingView and inputs stop reacting
  // to the keyboard (two stacked KeyboardAvoidingViews both padded and fought over focus).
  const [gone, setGone] = useState(!on);
  useEffect(() => {
    p.value = withTiming(on ? 1 : 0, { duration: 300, easing: ease });
    if (on) {
      setGone(false);
      return;
    }
    const id = setTimeout(() => setGone(true), 350);
    return () => clearTimeout(id);
  }, [on, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 8 }] }));
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, anim, { zIndex: on ? 2 : name === "intro" ? 1 : 0, display: gone ? "none" : "flex" }]}
      pointerEvents={on ? "auto" : "none"}
      accessibilityElementsHidden={!on}
      importantForAccessibility={on ? "auto" : "no-hide-descendants"}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The screen edge flashes accent twice when Spoken needs you (.flash-ring).
 * Reduced motion: it lights once and holds, then fades, instead of pulsing.
 */
function FlashRing() {
  const styles = useStyles();
  const reduce = useReducedMotion();
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = reduce
      ? withSequence(withTiming(1, { duration: 200 }), withDelay(1400, withTiming(0, { duration: 400 })))
      : withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0, { duration: 400 })), 2);
  }, [o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, anim]} />;
}

const useStyles = makeStyles((C) => ({
  device: { flex: 1, backgroundColor: C.app },
  ring: { borderWidth: 2, borderColor: C.accent, borderRadius: 40, zIndex: 40 },
}));
