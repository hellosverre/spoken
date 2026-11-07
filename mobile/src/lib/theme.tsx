import { createContext, useContext, useMemo, type ReactNode } from "react";
import { StyleSheet, useColorScheme, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { Easing } from "react-native-reanimated";
import { useSpoken } from "./use-spoken";

/* Midnight, the tokens from web/src/app/globals.css: blue-black base, porcelain
   text, one periwinkle accent used sparingly. The web is dark only; Light is the
   mobile counterpart: the same roles on a cool white, with the accent deepened
   so it still reads on white. Inter for everything, small labels included: the
   web's uppercase mono labels are left out here on purpose, so the app reads
   like plain writing rather than a terminal. */

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
