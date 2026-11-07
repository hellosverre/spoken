import { useEffect, useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ease, em, F, makeStyles, useTheme } from "../lib/theme";
import { useCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Icon, Wordmark, type IconName } from "./Icon";

// Opening animation, as web/src/components/Intro.tsx: a bubble drops in,
// becomes a speech bubble that types the tagline, and icons pop around it.

const POPS: [IconName, number, number][] = [
  ["pizza", -150, -112],
  ["doctor", 0, -138],
  ["scissors", 150, -112],
  ["calendar", -150, 112],
  ["phone", 0, 138],
  ["bag", 150, 112],
];

const LINE_SIZE = 22;
const fall = Easing.bezier(0.5, 0, 1, 0.6);
const rise = Easing.bezier(0, 0.5, 0.5, 1);

export function Intro() {
  const store = useStore();
  const t = useCopy();
  const s = useSpoken((st) => st.intro);
  const { C } = useTheme();
  const styles = useStyles();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [lineW, setLineW] = useState(0);
  // The bubble is as wide as the typed line will be, like the web's measureLine().
  const bw = lineW ? Math.min(lineW + 48, Math.min(screenW, 400) - 40) : 260;
  const centreY = screenH * 0.46;

  const y = useSharedValue(0);
  const sx = useSharedValue(1);
  const sy = useSharedValue(1);
  const shown = useSharedValue(0);
  const morph = useSharedValue(0);
  const word = useSharedValue(0);

  useEffect(() => {
    if (s.still) {
      shown.value = 1;
      return;
    }
    if (!s.drop) {
      shown.value = 0;
      y.value = 0;
      return;
    }
    // The .drop keyframes: fall, squash, bounce, settle (0.9 s).
    shown.value = withTiming(1, { duration: 405 });
    y.value = withSequence(
      withTiming(-120, { duration: 0 }),
      withTiming(0, { duration: 405, easing: fall }),
      withTiming(-24, { duration: 225, easing: rise }),
      withTiming(0, { duration: 162, easing: fall }),
    );
    const squash = (a: number, b: number) =>
      withSequence(withTiming(1, { duration: 0 }), withDelay(345, withTiming(a, { duration: 60 })), withTiming(1, { duration: 225 }), withTiming(b, { duration: 162 }), withTiming(1, { duration: 108 }));
    sx.value = squash(1.06, 1.02);
    sy.value = squash(0.94, 0.98);
  }, [s.drop, s.still, shown, y, sx, sy]);

  useEffect(() => {
    morph.value = s.morph ? (s.still ? 1 : withTiming(1, { duration: 450, easing: ease })) : 0;
  }, [s.morph, s.still, morph]);

  useEffect(() => {
    word.value = withTiming(s.word ? 1 : 0, { duration: 400, easing: ease });
  }, [s.word, word]);

  const from = C.accent;
  const to = C.ink;
  const blob = useAnimatedStyle(() => {
    const h = interpolate(morph.value, [0, 1], [44, 60]);
    const r = interpolate(morph.value, [0, 1], [22, 20]);
    return {
      opacity: shown.value,
      width: interpolate(morph.value, [0, 1], [44, bw]),
      height: h,
      marginTop: -h / 2,
      borderTopLeftRadius: r,
      borderTopRightRadius: r,
      borderBottomRightRadius: r,
      borderBottomLeftRadius: interpolate(morph.value, [0, 1], [22, 6]),
      backgroundColor: interpolateColor(morph.value, [0, 1], [from, to]),
      transform: [{ translateY: y.value }, { translateY: h / 2 }, { scaleX: sx.value }, { scaleY: sy.value }, { translateY: -h / 2 }],
    };
  });
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value }));

  return (
    <Pressable style={styles.root} onPress={() => store.skipIntro()} accessibilityRole="button" accessibilityLabel={`${t.introLine} ${t.skip}`}>
      {/* Invisible copy of the line, only to measure how wide the bubble should grow. */}
      <Text style={[styles.line, styles.measure]} onLayout={(e) => setLineW(e.nativeEvent.layout.width)} numberOfLines={1}>
        {t.introLine}
      </Text>

      <View style={[styles.ring, { top: centreY }]} pointerEvents="none">
        {POPS.map(([name, x, yy], i) => (
          <Pop key={name} name={name} x={x} y={yy} i={i} solid={i % 2 === 1} on={s.pops} still={s.still} />
        ))}
      </View>

      <View style={[styles.blobPos, { top: centreY }]} pointerEvents="none">
        <Animated.View style={[styles.blob, blob]}>
          <Text style={styles.line} numberOfLines={1}>
            {s.typed}
            {s.caret ? <Caret /> : null}
          </Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.word, { top: centreY + 186 }, wordStyle]} pointerEvents="none">
        <Wordmark size={24} />
        <Text style={styles.sub}>{t.introSub}</Text>
      </Animated.View>

      <Text style={[styles.skip, { bottom: 24 + insets.bottom }]}>{t.skip}</Text>
    </Pressable>
  );
}

/** A blinking bar after the typed text. Text can't hold a View, so it is a glyph. */
function Caret() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setOn((v) => !v), 450);
    return () => clearInterval(id);
  }, []);
  return <Text style={{ opacity: on ? 1 : 0, fontFamily: F.regular }}>│</Text>;
}

function Pop({ name, x, y, i, solid, on, still }: { name: IconName; x: number; y: number; i: number; solid: boolean; on: boolean; still: boolean }) {
  const { C } = useTheme();
  const styles = useStyles();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = on ? (still ? 1 : withDelay(i * 50, withTiming(1, { duration: 400, easing: ease }))) : 0;
  }, [on, still, i, p]);
  const anim = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateX: x }, { translateY: y }, { scale: 0.85 + 0.15 * p.value }],
  }));
  return (
    <Animated.View style={[styles.pop, solid ? styles.popSolid : styles.popFilled, anim]}>
      <Icon name={name} color={solid ? C.accent : C.ink} />
    </Animated.View>
  );
}

const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  measure: { position: "absolute", opacity: 0, left: -9999 },
  line: { fontFamily: F.medium, fontSize: LINE_SIZE, letterSpacing: em(-0.015, LINE_SIZE), color: C.inv },
  ring: { position: "absolute", left: "50%", width: 0, height: 0 },
  pop: {
    position: "absolute",
    width: 44,
    height: 44,
    marginLeft: -22,
    marginTop: -22,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  popFilled: { backgroundColor: C.surface, borderColor: C.line2 },
  popSolid: { backgroundColor: "transparent", borderColor: C.accent },
  blobPos: { position: "absolute", left: 0, right: 0, height: 0, alignItems: "center" },
  blob: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  word: { position: "absolute", left: 0, right: 0, alignItems: "center", gap: 4 },
  sub: { fontFamily: F.regular, fontSize: 14, color: C.muted },
  skip: { position: "absolute", left: 0, right: 0, textAlign: "center", fontFamily: F.regular, fontSize: 13, color: C.dim },
}));
