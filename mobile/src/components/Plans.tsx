import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fill } from "../lib/i18n";
import { kr, perMinute, PLANS, SUGGESTED_PLAN, type Plan } from "../lib/plans";
import { em, F, HEADING_SCALE, makeStyles, PAD, small, useLargeText, useTheme } from "../lib/theme";
import { useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow } from "./Art";
import { Icon, Wordmark } from "./Icon";
import { Press, Rise, T } from "./ui";

/**
 * After sign-up: pick a pack of call minutes. A showcase: no payment, and any plan logs in
 * as the demo user. Each card is one button, read out whole (name, minutes, price, per minute).
 */
export function Plans() {
  const store = useStore();
  const m = useMobileCopy();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const on = useSpoken((s) => s.screen === "plans");

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Glow cx={0.15} cy={0.1} r={0.7} />
      <View style={styles.topbar}>
        <Pressable accessibilityRole="button" accessibilityLabel={m.back} onPress={() => store.openSignup()} hitSlop={8} style={styles.back}>
          <View style={styles.flip}>
            <Icon name="chevron" size={18} />
          </View>
          <Text style={styles.backText}>{m.back}</Text>
        </Pressable>
        <Wordmark />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]}>
        <Rise i={0} on={on}>
          <Text style={styles.h} accessibilityRole="header" maxFontSizeMultiplier={HEADING_SCALE}>
            {m.plansH}
          </Text>
          <Text style={styles.lede}>{m.plansSub}</Text>
        </Rise>
        <View style={styles.list}>
          {PLANS.map((p, i) => (
            <Rise key={p.id} i={i + 1} on={on}>
              <PlanCard plan={p} onChoose={() => store.choosePlan(p.id)} />
            </Rise>
          ))}
        </View>
        <View style={styles.demo}>
          <Icon name="alert" size={16} color={styles.demoText.color} />
          <Text style={styles.demoText}>{m.demoPay}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function PlanCard({ plan, onChoose }: { plan: Plan; onChoose(): void }) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const stack = useLargeText();
  const name = m.planNames[plan.id];
  const suggested = plan.id === SUGGESTED_PLAN;
  const price = plan.price ? kr(plan.price, lang) : m.free;
  const rate = plan.price ? perMinute(plan.price, plan.minutes, lang) : null;
  const minutes = fill(m.minutesN, { n: String(plan.minutes) });
  const label = [name, minutes, price, rate, suggested ? m.suggested : null, m.planNotes[plan.id]].filter(Boolean).join(", ");

  return (
    <Press
      accessibilityLabel={label}
      accessibilityHint={fill(m.choosePlan, { plan: name })}
      onPress={onChoose}
      scale={0.98}
      style={[styles.card, suggested && styles.cardSuggested]}
    >
      {suggested ? (
        <View style={styles.badge}>
          <Icon name="check" color={C.inv} size={14} strokeWidth={2.4} />
          <Text style={styles.badgeText}>{m.suggested}</Text>
        </View>
      ) : null}
      <View style={[styles.cardTop, stack && styles.cardTopStack]}>
        <View style={styles.grow}>
          <T size={17} weight="semibold">
            {name}
          </T>
          <T size={30} weight="semibold" maxFontSizeMultiplier={HEADING_SCALE}>
            {minutes}
          </T>
        </View>
        <View style={stack ? undefined : styles.priceCol}>
          <T size={20} weight="semibold">
            {price}
          </T>
          {rate ? (
            <T size={13} color={C.muted}>
              {rate}
            </T>
          ) : null}
        </View>
      </View>
      <T size={14} color={C.muted}>
        {m.planNotes[plan.id]}
      </T>
      <View style={styles.choose}>
        <Text style={styles.chooseText}>{fill(m.choosePlan, { plan: name })}</Text>
        <Icon name="chevron" color={C.accent} size={16} />
      </View>
    </Press>
  );
}

const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  grow: { flex: 1 },
  topbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: PAD, paddingTop: 8, minHeight: 44 },
  back: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, paddingRight: 8 },
  flip: { transform: [{ scaleX: -1 }] },
  backText: { fontFamily: F.medium, fontSize: 15, color: C.ink },
  body: { paddingHorizontal: PAD, paddingTop: 12 },
  h: { fontFamily: F.semibold, fontSize: 34, lineHeight: 38, letterSpacing: em(-0.024, 34), color: C.ink, marginBottom: 8 },
  lede: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted, maxWidth: 340 },
  list: { gap: 12, marginTop: 22 },
  card: { gap: 10, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: C.line2, backgroundColor: C.surface, boxShadow: C.lift },
  // The suggested plan: a thicker accent outline and a labelled badge, not colour alone.
  cardSuggested: { borderWidth: 2, borderColor: C.accent },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: C.accent },
  badgeText: { fontFamily: F.semibold, fontSize: 12.5, color: C.inv },
  cardTop: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  cardTopStack: { flexDirection: "column", alignItems: "flex-start", gap: 4 },
  priceCol: { alignItems: "flex-end" },
  choose: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 28, marginTop: 2 },
  chooseText: { fontFamily: F.medium, fontSize: 15, color: C.accent },
  demo: { flexDirection: "row", gap: 8, marginTop: 20, alignItems: "flex-start" },
  demoText: { ...small(13), color: C.dim, flex: 1, lineHeight: 18 },
}));
