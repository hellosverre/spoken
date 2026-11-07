import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import Svg, { G, Path } from "react-native-svg";

// Shared by every drawing: one hand (rounded 2 pt strokes, flat low-opacity fills),
// hidden from screen readers. Each drawing lives in its own file so it's easy to swap.

export const STROKE = { strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** The Duet mark's two halves on its 64 grid (see web/src/app/icon.svg). */
export const DUET_TOP = "M9 18H44C44 25 38 29 31 29H24C18 29 13 33 9 37Z";
export const DUET_BOTTOM = "M55 46H20C20 39 26 35 33 35H40C46 35 51 31 55 27Z";

export function Drawing({
  width,
  viewBox,
  style,
  children,
}: {
  width: number;
  /** "minX minY w h" */
  viewBox: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const [, , w, h] = viewBox.split(" ").map(Number);
  return (
    <View pointerEvents="none" style={style} accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={(width * h) / w} viewBox={viewBox}>
        {children}
      </Svg>
    </View>
  );
}

/**
 * One half of the Duet mark, placed at (x, y) and scaled, with the stroke kept at 2 pt.
 * The halves' boxes on the 64 grid: top 9..44 × 18..37, bottom 20..55 × 27..46.
 */
export function DuetHalf({
  half,
  x,
  y,
  scale,
  fill,
  fillOpacity,
  stroke,
}: {
  half: "top" | "bottom";
  x: number;
  y: number;
  scale: number;
  fill: string;
  fillOpacity: number;
  stroke: string;
}) {
  const [ox, oy] = half === "top" ? [9, 18] : [20, 27];
  return (
    <G transform={`translate(${x} ${y}) scale(${scale}) translate(${-ox} ${-oy})`}>
      <Path
        d={half === "top" ? DUET_TOP : DUET_BOTTOM}
        fill={fill}
        fillOpacity={fillOpacity}
        stroke={stroke}
        strokeWidth={2 / scale}
        strokeLinejoin="round"
      />
    </G>
  );
}
