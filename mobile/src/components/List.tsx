import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { F, makeStyles } from "../lib/theme";
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
  go,
  onPress,
  tone,
}: {
  first?: boolean;
  title: string;
  sub?: string;
  icon?: IconName;
  go?: ReactNode;
  onPress?: () => void;
  /** "danger" for destructive rows such as Log out. */
  tone?: "danger";
}) {
  const styles = useStyles();
  const body = (
    <>
      {icon ? (
        <View style={styles.ic}>
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
  const style = [styles.row, !first && styles.rowLine];
  if (!onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [style, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

/** A small segmented control (.seg). */
export function Seg<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { v: V; label: string }[]; onChange(v: V): void }) {
  const styles = useStyles();
  return (
    <View style={styles.seg} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((o) => {
        const on = value === o.v;
        return (
          <Pressable
            key={o.v}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(o.v)}
            style={[styles.segBtn, on && styles.segOn]}
          >
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  list: { borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 14 },
  rowLine: { borderTopWidth: 1, borderTopColor: C.line },
  pressed: { backgroundColor: C.surface2 },
  ic: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: C.surface2 },
  accent: { color: C.accent },
  danger: { color: C.danger },
  dim: { color: C.dim },
  seg: { flexDirection: "row", borderWidth: 1, borderColor: C.line2, borderRadius: 9, padding: 2 },
  segBtn: { height: 28, paddingHorizontal: 10, borderRadius: 7, justifyContent: "center" },
  segOn: { backgroundColor: C.surface2 },
  segText: { fontFamily: F.medium, fontSize: 12, color: C.dim },
  segTextOn: { color: C.ink },
}));
