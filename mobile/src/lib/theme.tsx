import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccessibilityInfo, StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { Easing } from "react-native-reanimated";
import { useSpoken } from "./use-spoken";

/* Midnight, the tokens from web/src/app/globals.css: blue-black base, porcelain
   text, one periwinkle accent used sparingly. The web is dark only; Light is the
   mobile counterpart: the same roles on a cool white, with the accent deepened
   so it still reads on white. Inter for everything, small labels included: the
   web's uppercase mono labels are left out here on purpose, so the app reads
   like plain writing rather than a terminal. */

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
  danger: string;
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
  danger: "#E5484D",
  scrim: "rgba(0,0,0,0.6)",
  accentSoft: "rgba(165,180,255,0.12)",
  lift: "0 1px 0 rgba(255,255,255,0.04) inset, 0 8px 24px rgba(0,0,0,0.35)",
  glow: 0.32,
  tints: {
    violet: { fg: "#B9A8FF", bg: "rgba(185,168,255,0.14)" },
    amber: { fg: "#FFC46B", bg: "rgba(255,196,107,0.13)" },
    teal: { fg: "#5FD8C4", bg: "rgba(95,216,196,0.13)" },
    rose: { fg: "#FF8FA8", bg: "rgba(255,143,168,0.13)" },
    sky: { fg: "#7CC4FF", bg: "rgba(124,196,255,0.13)" },
    lime: { fg: "#B5E36B", bg: "rgba(181,227,107,0.13)" },
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
  danger: "#D93B40",
  scrim: "rgba(10,12,17,0.35)",
  accentSoft: "rgba(85,102,232,0.09)",
  lift: "0 1px 2px rgba(10,12,17,0.05), 0 6px 18px rgba(10,12,17,0.06)",
  glow: 0.2,
  tints: {
    violet: { fg: "#6B4FE0", bg: "rgba(107,79,224,0.10)" },
    amber: { fg: "#B86A00", bg: "rgba(232,150,20,0.13)" },
    teal: { fg: "#0E8A78", bg: "rgba(14,160,138,0.11)" },
    rose: { fg: "#D2335C", bg: "rgba(226,60,100,0.10)" },
    sky: { fg: "#1C74C9", bg: "rgba(40,130,220,0.11)" },
    lime: { fg: "#4E8A10", bg: "rgba(100,170,30,0.12)" },
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

/** iOS Bold Text. The system only bolds its own fonts, so Inter steps up one cut when it is on. */
export function useBoldText(): boolean {
  const [bold, setBold] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isBoldTextEnabled().then((v) => live && setBold(v)).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("boldTextChanged", setBold);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return bold;
}

const BOLDER = { regular: "medium", medium: "semibold", semibold: "semibold" } as const;
export const boldWeight = (w: keyof typeof BOLDER, bold: boolean) => (bold ? BOLDER[w] : w);

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
