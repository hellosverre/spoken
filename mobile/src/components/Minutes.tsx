import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fill } from "../lib/i18n";
import { kr, LOW_MINUTES, perMinute, TOP_UPS } from "../lib/plans";
import { F, makeStyles, useTheme } from "../lib/theme";
import { useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { HeadButton, SheetModal } from "./PresetSheets";
import { Btn, T } from "./ui";

/**
 * Profile: call minutes used and left, with a bar, and the way to add more. The numbers are
 * dummies for the showcase (calls don't count down yet), and adding minutes charges nothing.
 */
export function MinutesCard() {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const { plan, total, used } = useSpoken((s) => s.minutes);
  const [open, setOpen] = useState(false);
  const left = Math.max(0, total - used);
  const low = left <= LOW_MINUTES;
  const n = (v: number) => String(v);
  const planName = m.planNames[plan];

  return (
    <View style={styles.card}>
      {/* Read as one sentence: plan, used of total, left. */}
      <View accessible accessibilityLabel={fill(m.minutesSummary, { plan: planName, used: n(used), total: n(total), left: n(left) })}>
        <View style={styles.top}>
          <T size={15} weight="semibold" style={styles.grow}>
            {planName}
          </T>
          <T size={22} weight="semibold">
            {fill(m.minutesLeft, { n: n(left) })}
          </T>
        </View>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${total ? Math.min(100, (used / total) * 100) : 0}%` }]} />
        </View>
        <T size={13} color={C.muted}>
          {fill(m.minutesUsed, { used: n(used), total: n(total) })}
        </T>
      </View>
      {low ? (
        <View style={styles.low}>
          <Icon name="alert" color={C.danger} size={16} />
          <Text style={styles.lowText}>{m.minutesLow}</Text>
        </View>
      ) : null}
      <Btn kind={low ? "primary" : "ghost"} block label={m.addMinutes} icon={<Icon name="plus" color={low ? C.inv : C.ink} size={18} />} onPress={() => setOpen(true)} />
      <TopUpSheet open={open} onClose={() => setOpen(false)} />
    </View>
  );
}

/** Pick a top-up, see its price, "buy" it. Then a plain confirmation of what you have now. */
function TopUpSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const store = useStore();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const { total, used } = useSpoken((s) => s.minutes);
  const [pick, setPick] = useState(TOP_UPS[1]!.minutes);
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    if (open) setAdded(null);
  }, [open]);

  const chosen = TOP_UPS.find((t) => t.minutes === pick) ?? TOP_UPS[0]!;
  const left = Math.max(0, total - used);

  return (
    <SheetModal visible={open} onClose={onClose} title={m.topUpH} left={<HeadButton label={m.cancel} onPress={onClose} />}>
      {added !== null ? (
        <>
          <View style={styles.done} accessibilityRole="alert">
            <Icon name="check" color={C.accent} size={22} strokeWidth={2.4} />
            <T size={17} weight="medium" style={styles.grow}>
              {fill(m.topUpDone, { n: String(added), left: String(left) })}
            </T>
          </View>
          <Btn block label={m.done} onPress={onClose} />
        </>
      ) : (
        <>
          <T size={15} color={C.muted}>
            {m.topUpSub}
          </T>
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={m.topUpH}>
            {TOP_UPS.map((t) => {
              const on = t.minutes === pick;
              const minutes = fill(m.minutesN, { n: String(t.minutes) });
              const price = kr(t.price, lang);
              const rate = perMinute(t.price, t.minutes, lang);
              return (
                <Pressable
                  key={t.minutes}
                  accessibilityRole="radio"
                  accessibilityLabel={`${minutes}, ${price}, ${rate}`}
                  accessibilityState={{ checked: on }}
                  onPress={() => setPick(t.minutes)}
                  style={[styles.option, on && styles.optionOn]}
                >
                  {/* Chosen: a filled ring with a check, a thicker outline and a heavier label, not colour alone. */}
                  <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" color={C.inv} size={14} strokeWidth={2.6} /> : null}</View>
                  <T size={17} weight={on ? "semibold" : "medium"} style={styles.grow}>
                    +{minutes}
                  </T>
                  <View style={styles.priceCol}>
                    <T size={16} weight="semibold">
                      {price}
                    </T>
                    <T size={12.5} color={C.muted}>
                      {rate}
                    </T>
                  </View>
                </Pressable>
              );
            })}
          </View>
          <Btn
            block
            label={fill(m.buyN, { n: String(chosen.minutes), price: kr(chosen.price, lang) })}
            onPress={() => {
              store.addMinutes(chosen.minutes);
              setAdded(chosen.minutes);
            }}
            style={styles.buy}
          />
          <View style={styles.demo}>
            <Icon name="alert" color={C.dim} size={16} />
            <T size={13} color={C.dim} style={styles.grow}>
              {m.demoPayShort}
            </T>
          </View>
        </>
      )}
    </SheetModal>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  card: { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, boxShadow: C.lift },
  top: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2, overflow: "hidden", marginBottom: 8 },
  fill: { height: "100%", backgroundColor: C.accent },
  low: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  lowText: { flex: 1, fontFamily: F.medium, fontSize: 13.5, lineHeight: 19, color: C.danger },
  options: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: C.surface,
  },
  optionOn: { borderWidth: 2, borderColor: C.accent, backgroundColor: C.accentSoft },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.muted, alignItems: "center", justifyContent: "center" },
  radioOn: { backgroundColor: C.accent, borderColor: C.accent },
  priceCol: { alignItems: "flex-end" },
  buy: { minHeight: 52, marginTop: 4 },
  demo: { flexDirection: "row", gap: 8, alignItems: "center" },
  done: { flexDirection: "row", gap: 12, alignItems: "center", padding: 16, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
}));
