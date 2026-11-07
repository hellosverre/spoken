import type { ReactNode } from "react";
import { Circle, Path, Rect } from "react-native-svg";
import type { PresetIcon } from "../../lib/presets";
import type { Tint } from "../../lib/theme";
import { Drawing, STROKE } from "./base";

// Spot illustrations for the built-in presets, drawn on a 64 grid in the preset's tint.
// hasPresetArt() says which icons have one; other icons keep the plain badge.

type Art = (t: Tint) => ReactNode;

const ART: Partial<Record<PresetIcon, Art>> = {
  // One slice: crust along the top, cheese body, pepperoni.
  pizza: (t) => (
    <>
      <Path d="M32 57L10.5 18.5A25 25 0 0 1 53.5 18.5z" fill={t.fg} fillOpacity={0.14} stroke={t.fg} {...STROKE} />
      <Path d="M13.8 24.4A19 19 0 0 1 50.2 24.4" fill="none" stroke={t.fg} strokeOpacity={0.55} {...STROKE} />
      <Circle cx={25} cy={31} r={3.6} fill={t.fg} fillOpacity={0.85} />
      <Circle cx={38.5} cy={33} r={3.2} fill={t.fg} fillOpacity={0.85} />
      <Circle cx={31.5} cy={45} r={2.8} fill={t.fg} fillOpacity={0.85} />
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
  // Open scissors: two finger rings, blades crossing at the pivot.
  scissors: (t) => (
    <>
      <Path d="M25 43L42.5 8L45.5 10.5L29.5 44.5z" fill={t.fg} fillOpacity={0.16} stroke={t.fg} {...STROKE} />
      <Path d="M39 43L21.5 8L18.5 10.5L34.5 44.5z" fill={t.fg} fillOpacity={0.16} stroke={t.fg} {...STROKE} />
      <Circle cx={20} cy={50} r={7} fill={t.bg} stroke={t.fg} {...STROKE} />
      <Circle cx={44} cy={50} r={7} fill={t.bg} stroke={t.fg} {...STROKE} />
      <Circle cx={32} cy={32.5} r={2.2} fill={t.fg} />
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
