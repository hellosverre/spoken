import { useEffect, useId } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Path, RadialGradient, Rect, Stop } from "react-native-svg";
import type { PresetIcon } from "../lib/presets";
import { useTheme, type Tint } from "../lib/theme";

// Decorative pieces: the accent glow, the Duet mark as a big graphic, pulse rings
// for whoever is talking, and a colour tint per preset icon. All purely visual and
// hidden from screen readers.

const DUET = "M9 18H44C44 25 38 29 31 29H24C18 29 13 33 9 37Z M55 46H20C20 39 26 35 33 35H40C46 35 51 31 55 27Z";

/** A soft radial glow filling its parent, centred at (cx, cy) in 0..1 of the box. */
export function Glow({
  color,
  opacity,
  cx = 0.5,
  cy = 0.5,
  r = 0.6,
  style,
}: {
  color?: string;
  opacity?: number;
  cx?: number;
  cy?: number;
  r?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { C } = useTheme();
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={id} cx={`${cx * 100}%`} cy={`${cy * 100}%`} r={`${r * 100}%`}>
            <Stop offset="0" stopColor={color ?? C.accent} stopOpacity={opacity ?? C.glow} />
            <Stop offset="1" stopColor={color ?? C.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** The Duet mark as a large graphic (hero art, watermarks). */
export function DuetArt({ width, color, opacity = 1, style }: { width: number; color?: string; opacity?: number; style?: StyleProp<ViewStyle> }) {
  const { C } = useTheme();
  return (
    <View pointerEvents="none" style={style} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={(width * 28) / 46} viewBox="9 18 46 28">
        <Path d={DUET} fill={color ?? C.accent} fillOpacity={opacity} fillRule="evenodd" />
      </Svg>
    </View>
  );
}

/**
 * Rings that ripple out from a circle while `active` (someone is talking).
 * Calm (reduce motion): one still ring instead of the ripple.
 */
export function PulseRings({ active, color, size }: { active: boolean; color: string; size: number }) {
  const reduce = useReducedMotion();
  return (
    <View pointerEvents="none" style={[styles.ringBox, { width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }]}>
      {reduce ? (
        <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: color, opacity: active ? 0.5 : 0, transform: [{ scale: 1.25 }] }]} />
      ) : (
        [0, 1, 2].map((i) => <Ring key={i} i={i} active={active} color={color} size={size} />)
      )}
    </View>
  );
}

function Ring({ i, active, color, size }: { i: number; active: boolean; color: string; size: number }) {
  const p = useSharedValue(0);
  const on = useSharedValue(0);
  useEffect(() => {
    on.value = withTiming(active ? 1 : 0, { duration: active ? 200 : 400 });
    if (active) {
      p.value = 0;
      p.value = withDelay(i * 450, withRepeat(withTiming(1, { duration: 1350, easing: Easing.out(Easing.quad) }), -1, false));
    }
  }, [active, i, p, on]);
  const anim = useAnimatedStyle(() => ({
    opacity: on.value * (1 - p.value) * 0.55,
    transform: [{ scale: 1 + p.value * 0.75 }],
  }));
  return <Animated.View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: color }, anim]} />;
}

/** Each preset icon gets its own tint, so the grid reads at a glance. */
const ICON_TINT: Record<PresetIcon, keyof ReturnType<typeof useTheme>["C"]["tints"] | null> = {
  pizza: "amber",
  doctor: "teal",
  heart: "rose",
  scissors: "violet",
  calendar: "sky",
  bag: "lime",
  phone: null,
  person: null,
};

export function useTint(icon: PresetIcon): Tint {
  const { C } = useTheme();
  const key = ICON_TINT[icon];
  return key ? C.tints[key] : { fg: C.accent, bg: C.accentSoft };
}

const styles = StyleSheet.create({
  ringBox: { position: "absolute", left: "50%", top: "50%", alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 2 },
});
