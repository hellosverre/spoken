import Svg, { Defs, G, LinearGradient, Path, Stop } from "react-native-svg";
import { useTheme } from "../../lib/theme";

/*
  The empty chat's header (the user's artwork, redrawn as react-native-svg): a typed
  message becomes a voice waveform and reaches a person answering a call. Its lower
  part fades into the app background and is left free for the heading on top of it.

  Light uses the artwork's own colours, with the accent and background from the palette.
  Dark is its own set rather than an inversion: the line work goes light, the face and
  hand take a dark fill and the hair and shirt a near-black indigo, so the person still reads
  as a person.
*/

export const CHAT_HERO_RATIO = 460 / 314;

interface HeroColors {
  base: [string, string, string];
  ribbon: [string, number, string, number, string, number];
  bubble: string;
  line: string;
  /** Hair and shirt. */
  solid: string;
  /** Face and hand. */
  skin: string;
  accent: string;
}

export function ChatHero({ width }: { width: number }) {
  const { C, scheme } = useTheme();
  const k: HeroColors =
    scheme === "dark"
      ? {
          base: ["#1D2252", "#121530", C.app],
          ribbon: ["#3B45A8", 0.45, "#4350C4", 0.5, "#5562D8", 0.22],
          bubble: "#1B2044",
          line: C.ink,
          // Darker than the ribbon behind it, as the hair is the darkest thing in the light version.
          solid: "#0B0E24",
          skin: C.surface2,
          accent: C.accent,
        }
      : {
          base: ["#DCDFFF", "#F0F1FC", C.app],
          ribbon: ["#BFC6FC", 0.69, "#C5CBFF", 0.77, "#D8DCFF", 0.42],
          bubble: "#EEF0FF",
          line: "#101423",
          solid: "#101423",
          skin: "#F5F6FA",
          accent: C.accent,
        };

  return (
    <Svg width={width} height={width / CHAT_HERO_RATIO} viewBox="0 0 460 314" accessible={false}>
      <Defs>
        <LinearGradient id="base" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={k.base[0]} />
          <Stop offset="0.52" stopColor={k.base[1]} />
          <Stop offset="0.83" stopColor={k.base[2]} />
        </LinearGradient>
        <LinearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={k.ribbon[0]} stopOpacity={k.ribbon[1]} />
          <Stop offset="0.7" stopColor={k.ribbon[2]} stopOpacity={k.ribbon[3]} />
          <Stop offset="1" stopColor={k.ribbon[4]} stopOpacity={k.ribbon[5]} />
        </LinearGradient>
      </Defs>

      {/* The lower part of this background is reserved for live app text. */}
      <Path fill="url(#base)" d="M0 0h460v314H0z" />
      <Path
        fill="url(#ribbon)"
        d="M0 62C45 25 93 27 145 49s90 33 140 27C358 67 417 44 460 0v109c-44 7-69 33-131 33-62 0-100-14-145-13-45 1-69 15-105 14-30-1-55-14-79-24z"
      />

      {/* Typed request and the line carrying it into speech. */}
      <Path fill={k.bubble} d="M47 48h87a19 19 0 0 1 19 19v26a19 19 0 0 1-19 19H47a19 19 0 0 1-19-19V67a19 19 0 0 1 19-19z" />
      <G fill="none" stroke={k.line} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M47 48h87a19 19 0 0 1 19 19v23c10-8 22-12 34-12" />
        <Path d="M153 90v3a19 19 0 0 1-19 19H47a19 19 0 0 1-19-19V67a19 19 0 0 1 19-19" />
        <Path d="M252 78c14 0 21-10 33-10" />
      </G>
      <G fill="none" stroke={k.accent} strokeLinecap="round">
        <Path strokeWidth={7} d="M46 69h59M46 88h66" />
        <Path strokeWidth={4} d="M126 81v15" />
        <Path strokeWidth={7.5} d="M201 70v16m15-29v42m15-31v20m13-14v8" />
      </G>

      {/* A person receiving the call. */}
      <Path fill={k.solid} d="M308 112c-17 7-27 18-34 32h120c-7-17-17-27-32-32l-13-4-28-1z" />
      <Path fill={k.solid} d="M365 43c4-12 14-17 24-14 11 3 17 14 14 24-3 11-12 17-23 16l-16-7z" />
      <Path
        fill={k.skin}
        stroke={k.line}
        strokeWidth={4.5}
        strokeLinejoin="round"
        d="M344 24c21 0 35 16 33 37-1 13-9 25-23 32l2 20c-6 10-21 14-32 9-7-3-10-7-11-12l5-14c-11 0-19-5-22-14l-2-9-6-4c-2-1-2-4 0-6l8-8c3-18 21-31 48-31z"
      />
      <Path fill={k.solid} d="M297 55c0-22 17-39 40-39 24 0 41 12 44 31 2 15-3 27-17 34l-13-14c-19-5-33-16-37-31-6 4-12 11-17 19z" />
      <Path fill="none" stroke={k.line} strokeWidth={3.3} strokeLinecap="round" d="M302 62c2-3 6-3 8 0m-12 17c4 2 8 2 11-1" />
      <Path fill={k.accent} stroke={k.line} strokeWidth={4.5} d="m354 59 15 5c4 1 5 4 4 8l-10 30c-1 4-4 5-8 4l-15-5c-4-1-5-4-4-8l10-30c1-4 4-5 8-4z" />
      <Path
        fill={k.skin}
        stroke={k.line}
        strokeWidth={4}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m359 144-12-29c-2-4-3-8-2-12l3-12c1-4 4-6 7-5 3 1 4 4 3 7l-1 4c3-4 7-4 9-1l4 5c2 3 2 7 1 10l-2 5 13 28"
      />
    </Svg>
  );
}
