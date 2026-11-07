import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { fill } from "../lib/i18n";
import { kr, LOW_MINUTES, perMinute, PLANS, TOP_UPS, totalMinutes, type PaidPlanId } from "../lib/plans";
import { F, makeStyles, useLargeText, useTheme } from "../lib/theme";
import { useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { DemoNote, EnterpriseSheet, RedeemForm } from "./Enterprise";
import { Icon } from "./Icon";
import { HeadButton, SheetModal } from "./PresetSheets";
import { Btn, T } from "./ui";

/** "449 kr/month", "Free", or "Paid by NAV": what the current plan costs you. */
function usePlanDetail() {
  const m = useMobileCopy();
  const lang = useSpoken((s) => s.lang);
  const { plan, org } = useSpoken((s) => s.minutes);
  if (plan === "org") return fill(m.paidBy, { org: org ?? m.yourOrg });
  const price = PLANS.find((p) => p.id === plan)?.price ?? 0;
  return price ? fill(m.perMonth, { price: kr(price, lang) }) : m.free;
}

/**
 * Profile: this month's call minutes used and left, with a bar, and the ways to change them.
 * The numbers are dummies for the showcase (calls don't count down yet), and nothing is charged.
 */
export function MinutesCard() {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const minutes = useSpoken((s) => s.minutes);
  const detail = usePlanDetail();
  const stack = useLargeText();
  const [topUp, setTopUp] = useState(false);
  const [change, setChange] = useState(false);
  const total = totalMinutes(minutes);
  const used = minutes.used;
  const left = Math.max(0, total - used);
  const low = left <= LOW_MINUTES;
  const n = (v: number) => String(v);
  const planName = m.planNames[minutes.plan];

  return (
    <View style={styles.card}>
      {/* Read as one sentence: plan and price, used of total, left. */}
      <View accessible accessibilityLabel={fill(m.minutesSummary, { plan: planName, detail, used: n(used), total: n(total), left: n(left) })}>
        <View style={styles.top}>
          <View style={styles.grow}>
            <T size={15} weight="semibold">
              {planName}
            </T>
            <T size={13} color={C.muted}>
              {detail}
            </T>
          </View>
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
      <View style={stack ? styles.actsCol : styles.acts}>
        <Btn
          kind={low ? "primary" : "ghost"}
          label={m.addMinutes}
          icon={<Icon name="plus" color={low ? C.inv : C.ink} size={18} />}
          onPress={() => setTopUp(true)}
          style={stack ? undefined : styles.grow}
        />
        <Btn kind="ghost" label={m.changePlan} icon={<Icon name="sliders" color={C.ink} size={18} />} onPress={() => setChange(true)} style={stack ? undefined : styles.grow} />
      </View>
      <TopUpSheet open={topUp} onClose={() => setTopUp(false)} />
      <ChangePlanSheet open={change} onClose={() => setChange(false)} />
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
  const minutes = useSpoken((s) => s.minutes);
  const [pick, setPick] = useState(TOP_UPS[1]!.minutes);
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    if (open) setAdded(null);
  }, [open]);

  const chosen = TOP_UPS.find((t) => t.minutes === pick) ?? TOP_UPS[0]!;
  const left = Math.max(0, totalMinutes(minutes) - minutes.used);

  return (
    <SheetModal visible={open} onClose={onClose} title={m.topUpH} left={<HeadButton label={m.cancel} onPress={onClose} />}>
      {added !== null ? (
        <>
          <Done text={fill(m.topUpDone, { n: String(added), left: String(left) })} />
          <Btn block label={m.done} onPress={onClose} />
        </>
      ) : (
        <>
          <T size={15} color={C.muted}>
            {m.topUpSub}
          </T>
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={m.topUpH}>
            {TOP_UPS.map((t) => {
              const minutesL = fill(m.minutesN, { n: String(t.minutes) });
              const price = kr(t.price, lang);
              const rate = perMinute(t.price, t.minutes, lang);
              return (
                <Choice key={t.minutes} on={t.minutes === pick} label={`${minutesL}, ${price}, ${rate}`} onPress={() => setPick(t.minutes)}>
                  <T size={17} weight={t.minutes === pick ? "semibold" : "medium"} style={styles.grow}>
                    +{minutesL}
                  </T>
                  <View style={styles.priceCol}>
                    <T size={16} weight="semibold">
                      {price}
                    </T>
                    <T size={12.5} color={C.muted}>
                      {rate}
                    </T>
                  </View>
                </Choice>
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
          <DemoNote text={m.demoPayShort} />
        </>
      )}
    </SheetModal>
  );
}

/**
 * Profile → Change plan: the monthly plans with the current one marked, a code from an
 * organisation, and Enterprise. Picking a plan asks once more, then switches (nothing charged).
 */
function ChangePlanSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const store = useStore();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const current = useSpoken((s) => s.minutes.plan);
  const [pick, setPick] = useState<PaidPlanId | null>(null);
  const [switched, setSwitched] = useState<PaidPlanId | null>(null);
  const [contact, setContact] = useState(false);

  useEffect(() => {
    if (open) {
      setPick(null);
      setSwitched(null);
    }
  }, [open]);

  const chosen = PLANS.find((p) => p.id === pick);

  return (
    <SheetModal visible={open} onClose={onClose} title={m.changePlan} left={<HeadButton label={m.close} onPress={onClose} />}>
      {switched ? (
        <>
          <Done text={fill(m.switched, { plan: m.planNames[switched], n: String(PLANS.find((p) => p.id === switched)?.minutes ?? 0) })} />
          <Btn block label={m.done} onPress={onClose} />
        </>
      ) : (
        <>
          {current === "org" ? (
            <T size={15} color={C.muted}>
              {m.orgNote}
            </T>
          ) : null}
          <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={m.changePlan}>
            {PLANS.map((p) => {
              const isCurrent = p.id === current;
              const price = p.price ? fill(m.perMonth, { price: kr(p.price, lang) }) : m.free;
              const minutesL = fill(m.minutesMonth, { n: String(p.minutes) });
              const name = m.planNames[p.id];
              return (
                <Choice
                  key={p.id}
                  on={(pick ?? current) === p.id}
                  label={[name, minutesL, price, isCurrent ? m.currentPlan : null].filter(Boolean).join(", ")}
                  onPress={() => setPick(isCurrent ? null : p.id)}
                >
                  <View style={styles.grow}>
                    <T size={16} weight="semibold">
                      {name}
                    </T>
                    <T size={13} color={C.muted}>
                      {isCurrent ? `${minutesL} · ${m.currentPlan}` : minutesL}
                    </T>
                  </View>
                  <T size={15} weight="semibold">
                    {price}
                  </T>
                </Choice>
              );
            })}
          </View>
          {chosen ? (
            <>
              <T size={14} color={C.muted}>
                {m.changeNote}
              </T>
              <Btn
                block
                label={fill(m.switchTo, { plan: m.planNames[chosen.id] })}
                onPress={() => {
                  store.changePlan(chosen.id);
                  setSwitched(chosen.id);
                }}
                style={styles.buy}
              />
              <DemoNote text={m.demoPayShort} />
            </>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.h} accessibilityRole="header">
              {m.codeH}
            </Text>
            <T size={14} color={C.muted}>
              {m.codeSub}
            </T>
            <RedeemForm />
          </View>

          <View style={styles.section}>
            <Text style={styles.h} accessibilityRole="header">
              {m.entH}
            </Text>
            <T size={14} color={C.muted}>
              {m.entSub}
            </T>
            <Btn kind="ghost" block label={m.entBtn} onPress={() => setContact(true)} />
          </View>
          <EnterpriseSheet open={contact} onClose={() => setContact(false)} />
        </>
      )}
    </SheetModal>
  );
}

/** One option in a list of choices: a ring that fills with a check, a thicker outline when chosen. */
function Choice({ on, label, onPress, children }: { on: boolean; label: string; onPress(): void; children: React.ReactNode }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: on }} onPress={onPress} style={[styles.option, on && styles.optionOn]}>
      <View style={[styles.radio, on && styles.radioOn]}>{on ? <Icon name="check" color={C.inv} size={14} strokeWidth={2.6} /> : null}</View>
      {children}
    </Pressable>
  );
}

function Done({ text }: { text: string }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.done} accessibilityRole="alert">
      <Icon name="check" color={C.accent} size={22} strokeWidth={2.4} />
      <T size={17} weight="medium" style={styles.grow}>
        {text}
      </T>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  card: { gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, boxShadow: C.lift },
  top: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2, overflow: "hidden", marginBottom: 8 },
  fill: { height: "100%", backgroundColor: C.accent },
  low: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  lowText: { flex: 1, fontFamily: F.medium, fontSize: 13.5, lineHeight: 19, color: C.danger },
  acts: { flexDirection: "row", gap: 8 },
  actsCol: { gap: 8 },
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
  section: { gap: 10, marginTop: 18, paddingTop: 18, borderTopWidth: 1, borderTopColor: C.line },
  h: { fontFamily: F.semibold, fontSize: 17, color: C.ink },
  done: { flexDirection: "row", gap: 12, alignItems: "center", padding: 16, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
}));
