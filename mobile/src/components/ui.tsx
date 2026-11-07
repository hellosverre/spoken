import { useEffect, useState, type ReactNode, type Ref } from "react";
import {
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { ease, em, F, makeStyles, useTheme } from "../lib/theme";
import { Icon } from "./Icon";

// Shared pieces for the screens, matching the .btn, .rise and .dots rules in web/src/app/globals.css.

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Shrinks to 97 % while pressed (.btn:active). `pressed` holds it there, for the demo's scripted taps. */
export function Press({
  style,
  pressed,
  scale = 0.97,
  children,
  ...rest
}: Omit<PressableProps, "style"> & { style?: StyleProp<ViewStyle>; pressed?: boolean; scale?: number; children?: ReactNode }) {
  const s = useSharedValue(1);
  useEffect(() => {
    s.value = withTiming(pressed ? scale : 1, { duration: 150, easing: ease });
  }, [pressed, scale, s]);
  const anim = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(e) => {
        s.value = withTiming(scale, { duration: 150, easing: ease });
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        if (!pressed) s.value = withTiming(1, { duration: 150, easing: ease });
        rest.onPressOut?.(e);
      }}
      style={[style, anim]}
    >
      {children}
    </AnimatedPressable>
  );
}

export function Btn({
  kind = "primary",
  block,
  pressed,
  icon,
  label,
  onPress,
  disabled,
  style,
}: {
  kind?: "primary" | "ghost";
  block?: boolean;
  pressed?: boolean;
  icon?: ReactNode;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { C } = useTheme();
  const styles = useStyles();
  const primary = kind === "primary";
  return (
    <Press
      onPress={onPress}
      disabled={disabled}
      pressed={pressed}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={[
        styles.btn,
        primary ? { backgroundColor: pressed ? C.accent2 : C.ink } : { borderWidth: 1, borderColor: C.line2 },
        block && styles.block,
        disabled && { opacity: 0.5 },
        style,
      ]}
    >
      {icon}
      <Text style={[styles.btnText, { color: primary ? C.inv : C.ink }]}>{label}</Text>
    </Press>
  );
}

/** Fades and rises 6 pt into place, `i` steps after the screen appears (.rise). */
export function Rise({ i = 0, on = true, style, children }: { i?: number; on?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) return;
    p.value = 0;
    if (on) p.value = withDelay(i * 50 + 60, withTiming(1, { duration: 400, easing: ease }));
  }, [on, i, reduce, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 6 }] }));
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/** Three dots pulsing in turn: Spoken is typing. */
export function Dots() {
  const styles = useStyles();
  return (
    <View style={styles.dots} accessibilityLabel="…">
      {[0, 1, 2].map((i) => (
        <Dot key={i} delay={i * 150} />
      ))}
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const styles = useStyles();
  const o = useSharedValue(0.3);
  useEffect(() => {
    o.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 480 }), withTiming(0.3, { duration: 480 }), withTiming(0.3, { duration: 240 })), -1),
    );
  }, [delay, o]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, anim]} />;
}

/** Text in Inter with the web's tracking: tighter as size grows. Defaults to the ink colour. */
export function T({
  size = 15,
  weight = "regular",
  color,
  style,
  ...rest
}: React.ComponentProps<typeof Text> & { size?: number; weight?: "regular" | "medium" | "semibold"; color?: string }) {
  const { C } = useTheme();
  const track = size >= 28 ? -0.02 : size >= 20 ? -0.015 : -0.006;
  const s: TextStyle = { fontFamily: F[weight], fontSize: size, color: color ?? C.ink, letterSpacing: em(track, size) };
  return <Text {...rest} style={[s, style]} />;
}

/**
 * A labelled single-line input in the composer's look (.field): surface, hairline, accent on focus.
 * `error` as text is written under the field with an icon and read out with it, so a mistake
 * is never shown by the red border alone.
 */
export function Field({ label, error, style, ...rest }: TextInputProps & { ref?: Ref<TextInputInstance>; label: string; error?: boolean | string }) {
  const { C, scheme } = useTheme();
  const styles = useStyles();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={typeof error === "string" ? error : undefined}
        placeholderTextColor={C.dim}
        selectionColor={C.accent}
        cursorColor={C.accent}
        keyboardAppearance={scheme}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[styles.field, focused && { borderColor: C.accent }, error ? styles.fieldBad : null, style]}
      />
      {typeof error === "string" && error ? (
        <View style={styles.fieldError}>
          <Icon name="alert" color={C.danger} size={16} />
          <Text style={styles.fieldErrorText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  btn: { height: 44, paddingHorizontal: 18, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  block: { alignSelf: "stretch" },
  btnText: { fontFamily: F.medium, fontSize: 15, letterSpacing: em(-0.006, 15) },
  dots: { flexDirection: "row", gap: 4, paddingVertical: 14, paddingHorizontal: 16 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.muted },
  fieldWrap: { gap: 6 },
  fieldLabel: { fontFamily: F.medium, fontSize: 13, color: C.muted },
  fieldBad: { borderColor: C.danger, borderWidth: 2 },
  fieldError: { flexDirection: "row", alignItems: "center", gap: 6 },
  fieldErrorText: { fontFamily: F.medium, fontSize: 13.5, color: C.danger, flexShrink: 1 },
  field: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    fontFamily: F.regular,
    fontSize: 16,
    color: C.ink,
  },
}));
