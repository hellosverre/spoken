import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StyleSheet, useColorScheme, useWindowDimensions, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { Easing } from "react-native-reanimated";
import { useSpoken } from "./use-spoken";

/* Midnight, the tokens from web/src/app/globals.css: blue-black base, porcelain
   text, one periwinkle accent used sparingly. The web is dark only; Light is the
   mobile counterpart: the same roles on a cool white, with the accent deepened
   so it still reads on white. Inter for everything, small labels included: the
   web's uppercase mono labels are left out here on purpose, so the app reads
   like plain writing rather than a terminal.

   Colour-blind safe: done and not done are teal against orange (never green
   against red), delete is a vermilion that keeps its contrast for protanopes,
   and the six tints stay apart under protanopia, deuteranopia and tritanopia
   (simulated, Machado 2009), mostly by differing in lightness as well as hue.
   Every coloured text clears 4.5:1 on the surfaces. Colour is never the only
   signal: status always has an icon and words too (ACCESSIBILITY.md).

   Small text (dim) clears 4.5:1 too. Higher contrast (Profile, or the phone's
   Increase Contrast / High contrast text) swaps in the *_HC palettes below:
   stronger secondary text and outlines that clear 3:1. Bold Text on iPhone
   steps every Inter weight up one, since the system can't embolden a custom font. */

/** Supporting tints for preset cards and art. Each is a foreground and a soft background. */
export type TintKey = "violet" | "amber" | "teal" | "rose" | "sky" | "lime";
export interface Tint {
  fg: string;
  bg: string;
}

export interface Palette {
  bg: string;
  app: string;
  surface: string;
  surface2: string;
  line: string;
  line2: string;
  ink: string;
  muted: string;
  dim: string;
  /** Text on ink and accent fills. */
  inv: string;
  accent: string;
  accent2: string;
  /** Destructive actions (delete, hang up, log out): text, and fills under white icons. */
  danger: string;
  dangerSoft: string;
  /** A call that got done, and one that didn't. */
  ok: Tint;
  fail: Tint;
  scrim: string;
  /** The accent as a quiet tint, behind icons and the active speaker. */
  accentSoft: string;
  /** Lift for cards and sheets: a soft shadow on light, a hairline glow on dark. */
  lift: string;
  /** Strength of the decorative accent glow (0..1). */
  glow: number;
  tints: Record<TintKey, Tint>;
}

export const DARK: Palette = {
  bg: "#06070A",
  app: "#0A0C11",
  surface: "#12151C",
  surface2: "#1A1E27",
  line: "#1F2430",
  line2: "#2C3240",
  ink: "#EDF0F7",
  muted: "#949BAD",
  dim: "#80879A",
  inv: "#0A0C11",
  accent: "#A5B4FF",
  accent2: "#C7D0FF",
  danger: "#F0652E",
  dangerSoft: "rgba(240,101,46,0.14)",
  ok: { fg: "#5FD8C4", bg: "rgba(95,216,196,0.13)" },
  fail: { fg: "#F5A623", bg: "rgba(245,166,35,0.14)" },
  scrim: "rgba(0,0,0,0.6)",
  accentSoft: "rgba(165,180,255,0.12)",
  lift: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)",
  glow: 0.32,
  tints: {
    violet: { fg: "#A98BF5", bg: "rgba(169,139,245,0.15)" },
    amber: { fg: "#D69A2E", bg: "rgba(214,154,46,0.14)" },
    teal: { fg: "#3EE08E", bg: "rgba(62,224,142,0.12)" },
    rose: { fg: "#F3709C", bg: "rgba(243,112,156,0.14)" },
    sky: { fg: "#9FD2F0", bg: "rgba(159,210,240,0.13)" },
    lime: { fg: "#D2E04E", bg: "rgba(210,224,78,0.12)" },
  },
};

export const LIGHT: Palette = {
  bg: "#EEF0F5",
  app: "#F7F8FB",
  surface: "#FFFFFF",
  surface2: "#ECEEF4",
  line: "#E2E5EC",
  line2: "#CDD2DC",
  ink: "#0B0D12",
  muted: "#5A6172",
  dim: "#646B7B",
  inv: "#FFFFFF",
  accent: "#5566E8",
  accent2: "#3A4BCF",
  danger: "#C2410C",
  dangerSoft: "rgba(194,65,12,0.10)",
  ok: { fg: "#0B6E62", bg: "rgba(11,110,98,0.10)" },
  fail: { fg: "#A85A00", bg: "rgba(232,150,20,0.14)" },
  scrim: "rgba(10,12,17,0.35)",
  accentSoft: "rgba(85,102,232,0.09)",
  lift: "0 1px 2px rgba(10,12,17,0.05), 0 6px 18px rgba(10,12,17,0.06)",
  glow: 0.2,
  tints: {
    violet: { fg: "#5F3BCE", bg: "rgba(95,59,206,0.10)" },
    amber: { fg: "#7A3E0C", bg: "rgba(200,110,30,0.13)" },
    teal: { fg: "#0B6E3F", bg: "rgba(20,150,90,0.11)" },
    rose: { fg: "#962A74", bg: "rgba(170,50,130,0.10)" },
    sky: { fg: "#1478B5", bg: "rgba(30,130,200,0.11)" },
    lime: { fg: "#6A7E0A", bg: "rgba(140,170,20,0.14)" },
  },
};

/**
 * Higher contrast: grey text goes nearly to ink (10:1 or more, against 4.5–6:1 normally), so the
 * switch is plain to see, and outlines clear 3:1 on every surface.
 */
export const DARK_HC: Palette = {
  ...DARK,
  line: "#646C80",
  line2: "#7A8193",
  muted: "#E0E4EC",
  dim: "#CDD2DC",
  scrim: "rgba(0,0,0,0.75)",
};

export const LIGHT_HC: Palette = {
  ...LIGHT,
  line: "#80879A",
  line2: "#6B7282",
  muted: "#262B36",
  dim: "#333946",
  accent: "#3A4BCF",
  accent2: "#2A3AB0",
  scrim: "rgba(10,12,17,0.55)",
};

export type Scheme = "dark" | "light";

const ThemeContext = createContext<{ C: Palette; scheme: Scheme; bold: boolean }>({ C: DARK, scheme: "dark", bold: false });

/**
 * The user's pick in Profile, else the phone's own dark/light setting. Higher contrast is on when
 * the phone's setting or the Profile switch is; Bold Text comes from the phone (iPhone only).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const pref = useSpoken((s) => s.themePref);
  const contrastPref = useSpoken((s) => s.highContrast);
  const sysContrast = useSpoken((s) => s.sysContrast);
  const bold = useSpoken((s) => s.boldText);
  const system = useColorScheme();
  const scheme: Scheme = pref === "system" ? (system === "light" ? "light" : "dark") : pref;
  const high = contrastPref || sysContrast;
  const value = useMemo(
    () => ({ C: scheme === "light" ? (high ? LIGHT_HC : LIGHT) : high ? DARK_HC : DARK, scheme, bold }),
    [scheme, high, bold],
  );
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/**
 * A style sheet built from the palette; rebuilt once per theme (and Bold Text), then cached.
 * Typed like StyleSheet.create.
 */
export function makeStyles<S extends Styles>(build: (C: Palette) => S & Styles): () => Readonly<S> {
  const cache = new Map<string, Readonly<S>>();
  const ids = new Map<Palette, number>();
  return () => {
    const { C, bold } = useTheme();
    if (!ids.has(C)) ids.set(C, ids.size);
    const key = `${ids.get(C)}${bold ? "b" : ""}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const built = build(C);
    if (bold)
      for (const style of Object.values(built) as { fontFamily?: string }[])
        if (style.fontFamily) style.fontFamily = bolder(style.fontFamily);
    const sheet = StyleSheet.create(built);
    cache.set(key, sheet);
    return sheet;
  };
}

/** Inter weights. The web uses variable weights 510/560; the nearest static cuts are 500/600. Bold is for Bold Text. */
export const F = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

const BOLDER: Record<string, string> = { [F.regular]: F.medium, [F.medium]: F.semibold, [F.semibold]: F.bold };

/** One Inter weight up, for the phone's Bold Text setting. */
export function bolder(family: string): string {
  return BOLDER[family] ?? family;
}

/** Text is at least this much bigger than default (the phone's text size): layouts stack and simplify. */
export const LARGE_TEXT = 1.3;

/** True when the phone's text size is large enough that side-by-side layouts should stack. */
export function useLargeText(): boolean {
  return useWindowDimensions().fontScale >= LARGE_TEXT;
}

/** Big headings grow less than body text, so they don't push the content off screen. */
export const HEADING_SCALE = 1.4;

/** CSS letter-spacing in em → React Native points. */
export const em = (v: number, size: number) => v * size;

/** The web's one easing curve, cubic-bezier(.2,.7,.2,1), and its short durations. */
export const ease = Easing.bezier(0.2, 0.7, 0.2, 1);

export const PAD = 20;

/** Small label text (who is speaking, field names, notes): plain sentence case. */
export const small = (size = 13) => ({ fontFamily: F.regular, fontSize: size, letterSpacing: em(-0.003, size) }) as const;
