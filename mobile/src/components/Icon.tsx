import type { ReactNode } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { em, F, makeStyles, useTheme } from "../lib/theme";

// Same glyphs as web/src/components/Icon.tsx, on a 24 px grid.
const PATHS = {
  phone: <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  pizza: (
    <>
      <Path d="M3.5 6.5c5.7-2.7 11.3-2.7 17 0L12 21z" />
      <Path d="M5.2 9.6c4.5-1.8 9.1-1.8 13.6 0" />
      <Path d="M10 11.5h.01M14 12.5h.01M12 15.5h.01" strokeWidth={3} />
    </>
  ),
  doctor: (
    <>
      <Rect x="4" y="4" width="16" height="16" rx="4" />
      <Path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  scissors: (
    <>
      <Circle cx="6" cy="6.5" r="2.8" />
      <Circle cx="6" cy="17.5" r="2.8" />
      <Path d="M8.4 8 20 18M8.4 16 20 6" />
    </>
  ),
  calendar: (
    <>
      <Rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <Path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  bag: (
    <>
      <Path d="M5 8h14l-1.2 12H6.2z" />
      <Path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </>
  ),
  send: <Path d="M5 12h13M13 6l6 6-6 6" />,
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <Path d="M7 7l10 10M17 7 7 17" />,
  replay: (
    <>
      <Path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <Path d="M4 4v4.5h4.5" />
    </>
  ),
  hang: <Path d="M3 14.5c5.3-5 12.7-5 18 0l-2.2 2.6-3.6-1.4.2-2.6c-2.3-.8-4.5-.8-6.8 0l.2 2.6-3.6 1.4z" />,
  play: <Path d="M7 4.5l13 7.5-13 7.5z" />,
  plus: <Path d="M12 5v14M5 12h14" />,
  sliders: (
    <>
      <Path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <Circle cx="15" cy="7" r="2" />
      <Circle cx="9" cy="17" r="2" />
    </>
  ),
  bubble: <Path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 4z" />,
  // Mobile only: the Profile and Home tabs, log out, presets.
  home: <Path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z" />,
  heart: <Path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z" />,
  trash: <Path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7M10.5 10.5v6M13.5 10.5v6" />,
  pencil: <Path d="M15.5 5.5l3 3L9 18l-4 1 1-4zM13.5 7.5l3 3" />,
  chevron: <Path d="M9.5 6l6 6-6 6" />,
  person: (
    <>
      <Circle cx="12" cy="8" r="3.6" />
      <Path d="M4.8 20c1-3.7 3.8-5.6 7.2-5.6s6.2 1.9 7.2 5.6" />
    </>
  ),
  logout: (
    <>
      <Path d="M14 4h3a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-3" />
      <Path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  color,
  size = 20,
  strokeWidth = 1.7,
  filled,
}: {
  name: IconName;
  color?: string;
  size?: number;
  strokeWidth?: number;
  /** Solid glyph (the play triangle). */
  filled?: boolean;
}) {
  const { C } = useTheme();
  const ink = color ?? C.ink;
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? ink : "none"}
      stroke={filled ? "none" : ink}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </Svg>
  );
}

/** The speech-bubble mark: rounded on three corners, tucked on the fourth. */
export function Mark({ w = 16, h = 12, r = 7, tuck = 2, color }: { w?: number; h?: number; r?: number; tuck?: number; color?: string }) {
  const { C } = useTheme();
  return (
    <View
      style={{
        width: w,
        height: h,
        backgroundColor: color ?? C.accent,
        borderTopLeftRadius: r,
        borderTopRightRadius: r,
        borderBottomRightRadius: r,
        borderBottomLeftRadius: tuck,
      }}
    />
  );
}

export function Wordmark({ size = 17 }: { size?: number }) {
  const styles = useStyles();
  return (
    <View style={styles.wordmark} accessibilityRole="header" accessibilityLabel="Spoken">
      <Mark />
      <Text style={[styles.word, { fontSize: size, letterSpacing: em(-0.012, size) }]}>Spoken</Text>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  wordmark: { flexDirection: "row", alignItems: "center", gap: 8 },
  word: { fontFamily: F.semibold, color: C.ink },
}));
