import { useEffect, useId } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

/** One colour pair per voice: [body, glow]. Same pairs as the web orbs. */
export const ORB_COLORS: Record<string, [string, string]> = {
  "4kCDY3HJwvO7Zp3con83": ["#FF9A5C", "#FFD36B"],
  xF681s0UeE04gsf0mVsJ: ["#4C8DFF", "#7FE7FF"],
  BRY5wALXFkJsxVM6sEOH: ["#B26CFF", "#FF8AD8"],
  uNsWM1StCcpydKYOjKyu: ["#FF6B9A", "#FFB38A"],
  ii0s2u4R3UFnxKL6DOrz: ["#35D6B0", "#C6F36B"],
  OZxMHsGaBmV5pjMIDIn0: ["#5F7CFF", "#C09BFF"],
  OEHTkiHZj6OczWZHu0Aj: ["#2FBF9B", "#6BD0FF"],
  Cz0K1kOv9tD8l0b5Qu53: ["#6A5BFF", "#2E1F9E"],
};

/** A soft gradient cloud. Idle: slow breathing; playing: a faster, deeper pulse. Static under reduce-motion. */
export function VoiceOrb({ voiceId, playing, size = 76 }: { voiceId: string; playing: boolean; size?: number }) {
  const reduce = useReducedMotion();
  const [a, b] = ORB_COLORS[voiceId] ?? ["#7B8CFF", "#B6C2FF"];
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const scale = useSharedValue(1);

  useEffect(() => {
    if (reduce) {
      scale.value = 1;
      return;
    }
    const [peak, ms] = playing ? [1.2, 380] : [1.07, 2500];
    scale.value = withRepeat(
      withSequence(withTiming(peak, { duration: ms, easing: Easing.inOut(Easing.sin) }), withTiming(0.94, { duration: ms, easing: Easing.inOut(Easing.sin) })),
      -1,
    );
  }, [playing, reduce, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={[{ width: size, height: size }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={`${id}a`} cx="36%" cy="34%" r="64%">
            <Stop offset="0" stopColor={b} stopOpacity={1} />
            <Stop offset="0.6" stopColor={a} stopOpacity={0.95} />
            <Stop offset="1" stopColor={a} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}b`} cx="68%" cy="70%" r="55%">
            <Stop offset="0" stopColor={a} stopOpacity={0.7} />
            <Stop offset="1" stopColor={a} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#${id}a)`} />
        <Rect width="100" height="100" fill={`url(#${id}b)`} />
      </Svg>
    </Animated.View>
  );
}
