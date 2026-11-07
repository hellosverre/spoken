import { useEffect, type ReactNode } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { Call } from "../components/Call";
import { Home } from "../components/Home";
import { IncomingCall } from "../components/IncomingCall";
import { Intro } from "../components/Intro";
import { Login } from "../components/Login";
import type { Screen } from "../lib/store";
import { ease, makeStyles } from "../lib/theme";
import { useSpoken, useStore } from "../lib/use-spoken";

// The whole app is one device with its screens layered, like web/src/components/SpokenApp.tsx
// (plus the mobile login after the intro).
// The store decides which is on; the others fade out and stop taking touches.

export default function Device() {
  const store = useStore();
  const screen = useSpoken((s) => s.screen);
  const flashTick = useSpoken((s) => s.flashTick);
  const styles = useStyles();

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  // Android back: skip the intro, return to the Home tab, or leave an ended call. Otherwise the OS handles it.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const s = store.getSnapshot();
      if (s.screen === "call" && s.callEnded) store.goHome();
      else if (s.screen === "home" && s.tab !== "home") store.setTab("home");
      else if (s.screen === "intro") store.skipIntro();
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
  useEffect(() => {
    p.value = withTiming(on ? 1 : 0, { duration: 300, easing: ease });
  }, [on, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 8 }] }));
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, anim, { zIndex: on ? 2 : name === "intro" ? 1 : 0 }]}
      pointerEvents={on ? "auto" : "none"}
      accessibilityElementsHidden={!on}
      importantForAccessibility={on ? "auto" : "no-hide-descendants"}
    >
      {children}
    </Animated.View>
  );
}

/** The screen edge flashes accent twice when Spoken needs you (.flash-ring). */
function FlashRing() {
  const styles = useStyles();
  const o = useSharedValue(0);
  useEffect(() => {
    o.value = withRepeat(withSequence(withTiming(1, { duration: 400 }), withTiming(0, { duration: 400 })), 2);
  }, [o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.ring, anim]} />;
}

const useStyles = makeStyles((C) => ({
  device: { flex: 1, backgroundColor: C.app },
  ring: { borderWidth: 2, borderColor: C.accent, borderRadius: 40, zIndex: 40 },
}));
