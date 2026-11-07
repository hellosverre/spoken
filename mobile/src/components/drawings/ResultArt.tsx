import { Circle, Path } from "react-native-svg";
import { useTheme } from "../../lib/theme";
import { Drawing, DuetHalf, STROKE } from "./base";

/** The call went through: the Duet halves meet around a check, with a little confetti. */
export function DoneArt({ width = 120 }: { width?: number }) {
  const { C } = useTheme();
  const { amber, rose, teal } = C.tints;
  return (
    <Drawing width={width} viewBox="0 0 120 84">
      <DuetHalf half="top" x={14} y={12} scale={1.9} fill={C.accent} fillOpacity={0.14} stroke={C.accent} />
      <DuetHalf half="bottom" x={39} y={36} scale={1.9} fill={C.accent} fillOpacity={0.14} stroke={C.accent} />
      <Circle cx={60} cy={42} r={16} fill={C.accent} />
      <Path d="M52 42.5l5.5 5.5L69 36.5" fill="none" stroke={C.inv} {...STROKE} strokeWidth={3} />
      {/* confetti */}
      <Path d="M12 60l4 4M104 14l-4 4" stroke={amber.fg} {...STROKE} />
      <Circle cx={100} cy={64} r={3} fill={rose.fg} />
      <Circle cx={22} cy={14} r={2.5} fill={teal.fg} />
      <Path d="M92 34h6M95 31v6" stroke={teal.fg} {...STROKE} />
    </Drawing>
  );
}

/** Nothing was agreed: the two halves resting apart, a quiet pause between them. */
export function NothingAgreedArt({ width = 120 }: { width?: number }) {
  const { C } = useTheme();
  return (
    <Drawing width={width} viewBox="0 0 120 84">
      <DuetHalf half="top" x={6} y={14} scale={1.6} fill={C.ink} fillOpacity={0.06} stroke={C.muted} />
      <DuetHalf half="bottom" x={58} y={40} scale={1.6} fill={C.ink} fillOpacity={0.06} stroke={C.muted} />
      <Circle cx={60} cy={42} r={14} fill={C.surface2} stroke={C.muted} {...STROKE} />
      <Path d="M56 37v10M64 37v10" stroke={C.muted} {...STROKE} strokeWidth={2.6} />
      <Circle cx={98} cy={18} r={2.5} fill={C.muted} fillOpacity={0.5} />
      <Circle cx={22} cy={66} r={2} fill={C.muted} fillOpacity={0.5} />
    </Drawing>
  );
}
