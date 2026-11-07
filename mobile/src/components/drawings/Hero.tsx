import type { StyleProp, ViewStyle } from "react-native";
import { Circle, G, Path, Rect } from "react-native-svg";
import { useTheme } from "../../lib/theme";
import { Drawing, DuetHalf, STROKE } from "./base";

/** Which hero the app shows. Both are kept so they can be compared and swapped. */
export const HERO_VARIANT: "duet" | "figures" = "duet";

type Props = { width: number; style?: StyleProp<ViewStyle> };

export function Hero(props: Props) {
  return HERO_VARIANT === "duet" ? <HeroDuet {...props} /> : <HeroFigures {...props} />;
}

/**
 * Variant A: the Duet mark pulled apart into the two sides of a call. Your side
 * types (dots); Spoken's side speaks (sound bars); the phone passes between them.
 */
export function HeroDuet({ width, style }: Props) {
  const { C } = useTheme();
  const amber = C.tints.amber.fg;
  return (
    <Drawing width={width} viewBox="0 0 280 160" style={style}>
      {/* your side: the top half, typing */}
      <DuetHalf half="top" x={8} y={14} scale={3} fill={C.ink} fillOpacity={0.06} stroke={C.ink} />
      {[34, 50, 66].map((cx) => (
        <Circle key={cx} cx={cx} cy={30} r={4} fill={C.ink} />
      ))}
      {/* Spoken's side: the bottom half, speaking */}
      <DuetHalf half="bottom" x={167} y={88} scale={3} fill={C.accent} fillOpacity={0.18} stroke={C.accent} />
      {[0, 1, 2, 3, 4].map((i) => {
        const h = [8, 16, 22, 14, 9][i];
        const x = 214 + i * 10;
        return <Path key={i} d={`M${x} ${126 - h / 2}V${126 + h / 2}`} stroke={C.accent} {...STROKE} strokeWidth={3} />;
      })}
      {/* the call passing between them */}
      <Path d="M100 44C126 44 128 74 140 80" stroke={C.ink} strokeOpacity={0.45} {...STROKE} strokeDasharray="1 7" fill="none" />
      <Path d="M152 92C160 104 170 110 178 110" stroke={C.accent} strokeOpacity={0.7} {...STROKE} strokeDasharray="1 7" fill="none" />
      <G transform="translate(128 70) rotate(-18) scale(1.25)">
        <Rect x="-2" y="-2" width="28" height="28" rx="9" fill={C.accent} fillOpacity={0.16} />
        <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" fill="none" stroke={C.accent} {...STROKE} strokeWidth={1.7} />
      </G>
      {/* small accents */}
      <Path d="M150 30v10M145 35h10" stroke={amber} {...STROKE} />
      <Circle cx={250} cy={66} r={3.5} fill="none" stroke={amber} {...STROKE} />
      <Circle cx={30} cy={98} r={2.5} fill={C.accent} fillOpacity={0.6} />
    </Drawing>
  );
}

/**
 * Variant B: two people. You type on your phone; Spoken (the Duet mark) takes the
 * call to the person on the other end, who answers with a handset.
 */
export function HeroFigures({ width, style }: Props) {
  const { C } = useTheme();
  const teal = C.tints.teal.fg;
  return (
    <Drawing width={width} viewBox="0 0 280 160" style={style}>
      {/* you, typing */}
      <Circle cx={52} cy={52} r={16} fill={C.ink} fillOpacity={0.06} stroke={C.ink} {...STROKE} />
      <Path d="M22 136c0-30 13-48 30-48s30 18 30 48" fill={C.ink} fillOpacity={0.06} stroke={C.ink} {...STROKE} />
      <Rect x={60} y={94} width={22} height={34} rx={5} fill={C.app} stroke={C.ink} {...STROKE} />
      <Path d="M65 104h12M65 111h8" stroke={C.ink} strokeOpacity={0.5} {...STROKE} />
      {/* Spoken in the middle, carrying the call */}
      <DuetHalf half="top" x={112} y={52} scale={1.6} fill={C.accent} fillOpacity={0.2} stroke={C.accent} />
      <DuetHalf half="bottom" x={112} y={69} scale={1.6} fill={C.accent} fillOpacity={0.2} stroke={C.accent} />
      <Path d="M88 110C100 98 104 92 110 86" stroke={C.ink} strokeOpacity={0.4} {...STROKE} strokeDasharray="1 7" fill="none" />
      <Path d="M176 78C186 84 192 90 198 100" stroke={C.accent} strokeOpacity={0.7} {...STROKE} strokeDasharray="1 7" fill="none" />
      {/* the person who answers, with a handset */}
      <Circle cx={228} cy={52} r={16} fill={teal} fillOpacity={0.12} stroke={teal} {...STROKE} />
      <Path d="M198 136c0-30 13-48 30-48s30 18 30 48" fill={teal} fillOpacity={0.12} stroke={teal} {...STROKE} />
      <G transform="translate(236 40) scale(0.9)">
        <Path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" fill={C.app} stroke={teal} {...STROKE} />
      </G>
      {/* sound */}
      <Path d="M206 30c-4 4-4 10 0 14M198 26c-7 7-7 15 0 22" stroke={teal} strokeOpacity={0.7} {...STROKE} fill="none" />
      <Path d="M140 22v10M135 27h10" stroke={C.tints.amber.fg} {...STROKE} />
    </Drawing>
  );
}
