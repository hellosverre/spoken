import type { ReactNode } from "react";
import { Circle, Path, Rect } from "react-native-svg";
import type { PresetIcon } from "../../lib/presets";
import type { Tint } from "../../lib/theme";
import { Drawing, STROKE } from "./base";

// Spot illustrations for the built-in presets, drawn on a 64 grid in the preset's tint.
// hasPresetArt() says which icons have one; other icons keep the plain badge.

type Art = (t: Tint) => ReactNode;

const ART: Partial<Record<PresetIcon, Art>> = {
  // A whole pizza, one slice pulled out, with pepperoni and the cut lines.
  pizza: (t) => (
    <>
      <Path d="M29 35V13a22 22 0 1 0 19.05 11z" fill={t.fg} fillOpacity={0.14} stroke={t.fg} {...STROKE} />
      <Path d="M29 35L10 46M29 35L22 56" fill="none" stroke={t.fg} strokeOpacity={0.45} {...STROKE} />
      <Path d="M34 30V9a21 21 0 0 1 18.19 10.5z" fill={t.fg} fillOpacity={0.24} stroke={t.fg} {...STROKE} />
      <Circle cx={18} cy={30} r={3} fill={t.fg} />
      <Circle cx={31} cy={46} r={3} fill={t.fg} />
      <Circle cx={18} cy={45} r={2.4} fill={t.fg} />
      <Circle cx={40} cy={19} r={2.4} fill={t.fg} />
    </>
  ),
  // A clipboard with a cross and a few lines.
  doctor: (t) => (
    <>
      <Rect x={14} y={12} width={36} height={44} rx={7} fill={t.fg} fillOpacity={0.12} stroke={t.fg} {...STROKE} />
      <Rect x={24} y={8} width={16} height={9} rx={3} fill={t.bg} stroke={t.fg} {...STROKE} />
      <Path d="M32 24v12M26 30h12" stroke={t.fg} {...STROKE} strokeWidth={2.5} />
      <Path d="M22 43h20M22 49h12" stroke={t.fg} strokeOpacity={0.55} {...STROKE} />
    </>
  ),
  // A heart with a small handset tucked in, and sound coming off it.
  heart: (t) => (
    <>
      <Path d="M32 54s-20-11.5-20-26a10.5 10.5 0 0 1 20-5 10.5 10.5 0 0 1 20 5c0 14.5-20 26-20 26z" fill={t.fg} fillOpacity={0.16} stroke={t.fg} {...STROKE} />
      <Path
        d="M26 26h3.5l1.8 4.4-2.2 1.3a9.6 9.6 0 0 0 4.4 4.4l1.3-2.2 4.4 1.8v3.5a1.8 1.8 0 0 1-1.8 1.8A14 14 0 0 1 24.2 27.8 1.8 1.8 0 0 1 26 26z"
        fill="none"
        stroke={t.fg}
        {...STROKE}
        strokeWidth={1.8}
      />
      <Path d="M52 12c3 3 3 8 0 11M57 8c5 5 5 14 0 19" fill="none" stroke={t.fg} strokeOpacity={0.6} {...STROKE} />
    </>
  ),
  // Scissors crossing a comb.
  scissors: (t) => (
    <>
      <Rect x={30} y={10} width={10} height={44} rx={3} fill={t.fg} fillOpacity={0.12} stroke={t.fg} {...STROKE} transform="rotate(28 35 32)" />
      <Path d="M27 19h-6M26 25h-6M25 31h-6M24 37h-6" stroke={t.fg} strokeOpacity={0.55} {...STROKE} transform="rotate(28 35 32) translate(14 0)" />
      <Circle cx={18} cy={46} r={6} fill={t.bg} stroke={t.fg} {...STROKE} />
      <Circle cx={30} cy={52} r={6} fill={t.bg} stroke={t.fg} {...STROKE} />
      <Path d="M22 41l26-28M34 47l12-32" stroke={t.fg} {...STROKE} strokeWidth={2.4} />
    </>
  ),
};

export function hasPresetArt(icon: PresetIcon): boolean {
  return icon in ART;
}

export function PresetArt({ icon, tint, size = 56 }: { icon: PresetIcon; tint: Tint; size?: number }) {
  const art = ART[icon];
  if (!art) return null;
  return (
    <Drawing width={size} viewBox="0 0 64 64">
      {art(tint)}
    </Drawing>
  );
}
