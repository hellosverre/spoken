import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
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
   signal: status always has an icon and words too (ACCESSIBILITY.md). */

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
  dim: "#5D6475",
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
  dim: "#868D9D",
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

export type Scheme = "dark" | "light";

const ThemeContext = createContext<{ C: Palette; scheme: Scheme }>({ C: DARK, scheme: "dark" });

/** The user's pick in Profile, else the phone's own dark/light setting. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const pref = useSpoken((s) => s.themePref);
  const system = useColorScheme();
  const scheme: Scheme = pref === "system" ? (system === "light" ? "light" : "dark") : pref;
  const value = useMemo(() => ({ C: scheme === "light" ? LIGHT : DARK, scheme }), [scheme]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

type Styles = Record<string, ViewStyle | TextStyle | ImageStyle>;

/** A style sheet built from the palette; rebuilt once per theme, then cached. Typed like StyleSheet.create. */
export function makeStyles<S extends Styles>(build: (C: Palette) => S & Styles): () => Readonly<S> {
  const cache = new Map<Palette, Readonly<S>>();
  return () => {
    const { C } = useTheme();
    const hit = cache.get(C);
    if (hit) return hit;
    const sheet = StyleSheet.create(build(C));
    cache.set(C, sheet);
    return sheet;
  };
}

/** Inter weights. The web uses variable weights 510/560; the nearest static cuts are 500/600. */
export const F = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
} as const;

/** CSS letter-spacing in em → React Native points. */
export const em = (v: number, size: number) => v * size;

/** The web's one easing curve, cubic-bezier(.2,.7,.2,1), and its short durations. */
export const ease = Easing.bezier(0.2, 0.7, 0.2, 1);

export const PAD = 20;

/** Small label text (who is speaking, field names, notes): plain sentence case. */
export const small = (size = 13) => ({ fontFamily: F.regular, fontSize: size, letterSpacing: em(-0.003, size) }) as const;
