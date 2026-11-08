import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewInstance,
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
import { bolder, ease, em, F, makeStyles, useTheme } from "../lib/theme";
import { useMobileCopy, useSpoken } from "../lib/use-spoken";
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

/** Three dots pulsing in turn: Spoken is typing. Still dots when motion is reduced. */
export function Dots() {
  const styles = useStyles();
  const m = useMobileCopy();
  return (
    <View style={styles.dots} accessible accessibilityLabel={m.typing}>
      {[0, 1, 2].map((i) => (
        <Dot key={i} delay={i * 150} />
      ))}
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const styles = useStyles();
  const reduce = useReducedMotion();
  const o = useSharedValue(reduce ? 0.7 : 0.3);
  useEffect(() => {
    if (reduce) return;
    o.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 480 }), withTiming(0.3, { duration: 480 }), withTiming(0.3, { duration: 240 })), -1),
    );
  }, [delay, o, reduce]);
  const anim = useAnimatedStyle(() => ({ opacity: o.value }));
  return <Animated.View style={[styles.dot, anim]} />;
}

/** iOS screen readers pick a voice per element; this keeps Norwegian text in a Norwegian voice. */
export function useSpeechLang(): string {
  return useSpoken((s) => s.lang) === "no" ? "nb-NO" : "en-US";
}

/** Text in Inter with the web's tracking: tighter as size grows. Defaults to the ink colour. */
export function T({
  size = 15,
  weight = "regular",
  color,
  style,
  ...rest
}: React.ComponentProps<typeof Text> & { size?: number; weight?: "regular" | "medium" | "semibold"; color?: string }) {
  const { C, bold } = useTheme();
  const speechLang = useSpeechLang();
  const track = size >= 28 ? -0.02 : size >= 20 ? -0.015 : -0.006;
  const family = bold ? bolder(F[weight]) : F[weight];
  const s: TextStyle = { fontFamily: family, fontSize: size, color: color ?? C.ink, letterSpacing: em(track, size) };
  return <Text accessibilityLanguage={speechLang} {...rest} style={[s, style]} />;
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

/** How a chat's scroll view lets the keyboard go: dragged down with the finger on iOS, on any drag on Android. */
export const CHAT_KEYBOARD_DISMISS = Platform.OS === "ios" ? "interactive" : "on-drag";

/**
 * A chat's content: a tap anywhere that isn't a button closes the keyboard. ScrollView's own
 * "handled" dismissal skips taps a child claims (drawings do), and the multiline composer has no
 * key that closes it, so without this the keyboard could stay up for the whole chat.
 * Not a control for screen readers: they never bring up the keyboard this way.
 */
export function TapToDismiss({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  return (
    <Pressable accessible={false} onPress={Keyboard.dismiss} style={style}>
      {children}
    </Pressable>
  );
}

/**
 * Keeps a chat scrolled to the newest message only while the reader is already at the bottom.
 * Scrolled up to reread, it stays put and `behind` turns on, for a "Jump to latest" button.
 */
export function useStickToEnd(animated: () => boolean = () => false) {
  const ref = useRef<ScrollViewInstance>(null);
  const atEnd = useRef(true);
  const [behind, setBehind] = useState(false);
  const toEnd = (anim = true) => {
    atEnd.current = true;
    setBehind(false);
    ref.current?.scrollToEnd({ animated: anim });
  };
  return {
    behind,
    toEnd,
    props: {
      ref,
      scrollEventThrottle: 100,
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
        if (atEnd.current) setBehind(false);
      },
      onContentSizeChange: () => {
        if (atEnd.current) ref.current?.scrollToEnd({ animated: animated() });
        else setBehind(true);
      },
    },
  };
}

/** "Jump to latest", shown over a chat while newer messages are below the fold. */
export function JumpToLatest({ on, onPress }: { on: boolean; onPress(): void }) {
  const { C } = useTheme();
  const styles = useStyles();
  const m = useMobileCopy();
  if (!on) return null;
  return (
    <Press accessibilityLabel={m.jumpLatest} onPress={onPress} style={styles.jump}>
      <Text style={[styles.jumpText, { color: C.inv }]}>{m.jumpLatest} ↓</Text>
    </Press>
  );
}

const useStyles = makeStyles((C) => ({
  jump: {
    position: "absolute",
    alignSelf: "center",
    bottom: 10,
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: C.ink,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: C.lift,
  },
  jumpText: { fontFamily: F.medium, fontSize: 14 },
  btn: { minHeight: 44, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
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
    minHeight: 48,
    paddingVertical: 10,
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
