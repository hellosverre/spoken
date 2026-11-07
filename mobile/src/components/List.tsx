import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { F, makeStyles, useLargeText, useTheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";
import { T } from "./ui";

// The grouped list from the web's Demo and Settings tabs (.list, .row, .seg).

export function List({ children }: { children: ReactNode }) {
  const styles = useStyles();
  return <View style={styles.list}>{children}</View>;
}

export function Row({
  first,
  title,
  sub,
  icon,
  art,
  go,
  onPress,
  tone,
}: {
  first?: boolean;
  title: string;
  sub?: string;
  icon?: IconName;
  /** A picture shown in the icon badge instead of a glyph. */
  art?: ReactNode;
  go?: ReactNode;
  onPress?: () => void;
  /** "danger" for destructive rows such as Log out. */
  tone?: "danger";
}) {
  const styles = useStyles();
  // Large text: a control beside the title (a segmented switch) moves under it.
  const stack = useLargeText() && !onPress && !!go;
  const body = (
    <>
      {art ? <View style={styles.ic}>{art}</View> : icon ? (
        <View style={[styles.ic, tone === "danger" && styles.icDanger]}>
          <Icon name={icon} color={tone === "danger" ? styles.danger.color : styles.accent.color} size={17} />
        </View>
      ) : null}
      <View style={styles.grow}>
        <T size={14.5} weight="medium" color={tone === "danger" ? styles.danger.color : undefined}>
          {title}
        </T>
        {sub ? (
          <T size={13} color={styles.dim.color}>
            {sub}
          </T>
        ) : null}
      </View>
      {go}
    </>
  );
  const style = [styles.row, stack && styles.rowWrap, !first && styles.rowLine];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

/** A small segmented control (.seg). */
export function Seg<V extends string>({
  label,
  value,
  options,
  onChange,
  wide,
}: {
  label: string;
  value: V;
  /** `a11y` is what a screen reader says when the visible label is an abbreviation (EN, NO). */
  options: { v: V; label: string; a11y?: string; icon?: IconName }[];
  onChange(v: V): void;
  /** Fill the width, options sharing it equally. */
  wide?: boolean;
}) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.seg, wide && styles.segWide]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = value === o.v;
        return (
          <Pressable
            key={o.v}
            accessibilityRole="radio"
            accessibilityLabel={o.a11y ?? o.label}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.v)}
            style={[styles.segBtn, o.icon && styles.segIconBtn, wide && styles.grow, on && styles.segOn]}
          >
            {o.icon ? <Icon name={o.icon} color={on ? C.accent : C.dim} size={17} /> : null}
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  list: { borderWidth: 1, borderColor: C.line, borderRadius: 16, backgroundColor: C.surface, overflow: "hidden", boxShadow: C.lift },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowWrap: { flexWrap: "wrap" },
  rowLine: { borderTopWidth: 1, borderTopColor: C.line },
  pressed: { backgroundColor: C.surface2 },
  ic: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.accentSoft },
  icDanger: { backgroundColor: C.dangerSoft },
  accent: { color: C.accent },
  danger: { color: C.danger },
  dim: { color: C.dim },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: C.line2, borderRadius: 12, padding: 3 },
  // The chosen option gets an outline and a heavier label as well as the tint, so it doesn't rest on colour.
  segBtn: { minHeight: 40, paddingHorizontal: 11, borderRadius: 9, justifyContent: "center", alignItems: "center", borderWidth: 1.5, borderColor: "transparent" },
  // With an icon: the glyph over a small label, so three choices fit beside a row title.
  segIconBtn: { minHeight: 50, minWidth: 52, paddingHorizontal: 8, gap: 3 },
  segWide: { alignSelf: "stretch" },
  segOn: { backgroundColor: C.accentSoft, borderColor: C.accent },
  segText: { fontFamily: F.medium, fontSize: 12, color: C.dim },
  segTextOn: { color: C.accent, fontFamily: F.semibold },
}));
