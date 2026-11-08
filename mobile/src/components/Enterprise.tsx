import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { fill } from "../lib/i18n";
import { parseCode } from "../lib/plans";
import { F, makeStyles, useTheme } from "../lib/theme";
import { useMobileCopy, useStore } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { HeadButton, SheetModal } from "./PresetSheets";
import { Btn, Field, T } from "./ui";

/*
 * Enterprise: organisations buy many accounts at an agreed price and hand out one code per
 * person. A showcase: the contact form sends nothing, and any well-formed code is accepted.
 */

/** The Enterprise card at the bottom of the plans: no price, a way to get in touch. */
export function EnterpriseCard({ onContact }: { onContact(): void }) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.tile}>
          <Icon name="person" color={C.accent} size={20} />
        </View>
        <View style={styles.grow}>
          <T size={17} weight="semibold" accessibilityRole="header">
            {m.entH}
          </T>
          <T size={14} color={C.muted}>
            {m.entPrice}
          </T>
        </View>
      </View>
      <T size={14} color={C.muted} style={styles.lh}>
        {m.entSub}
      </T>
      <Btn kind="ghost" block label={m.entBtn} onPress={onContact} />
    </View>
  );
}

/** "Contact us for a price": who you are and how many accounts. Sends nothing; says so. */
export function EnterpriseSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [count, setCount] = useState("");
  const [msg, setMsg] = useState("");
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      setTried(false);
      setSent(false);
    }
  }, [open]);

  const n = Number.parseInt(count.replace(/\s/g, ""), 10);
  const errors = {
    org: org.trim() ? undefined : m.needOrg,
    name: name.trim() ? undefined : m.needSignupName,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : m.needEmail,
    count: n > 0 ? undefined : m.needCount,
  };
  const show = (e?: string) => (tried ? e : undefined);
  const send = () => {
    setTried(true);
    if (!Object.values(errors).some(Boolean)) setSent(true);
  };

  return (
    <SheetModal
      visible={open}
      onClose={onClose}
      title={m.entFormH}
      left={<HeadButton label={m.cancel} onPress={onClose} />}
      right={sent ? <HeadButton label={m.done} onPress={onClose} strong /> : <HeadButton label={m.entSend} onPress={send} strong />}
    >
      {sent ? (
        <View style={styles.done} accessibilityRole="alert">
          <Icon name="check" color={C.accent} size={22} strokeWidth={2.4} />
          <T size={16} style={styles.grow}>
            {fill(m.entThanks, { name: name.trim(), email: email.trim(), n: String(n) })}
          </T>
        </View>
      ) : (
        <>
          <T size={15} color={C.muted} style={styles.lh}>
            {m.entFormSub}
          </T>
          <Field label={m.entOrgL} value={org} onChangeText={setOrg} autoComplete="organization" textContentType="organizationName" error={show(errors.org)} />
          <Field label={m.entNameL} value={name} onChangeText={setName} autoComplete="name" textContentType="name" error={show(errors.name)} />
          <Field
            label={m.entEmailL}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            error={show(errors.email)}
          />
          <Field label={m.entCountL} value={count} onChangeText={setCount} placeholder={m.entCountPh} keyboardType="number-pad" error={show(errors.count)} />
          <Field label={m.entMsgL} value={msg} onChangeText={setMsg} multiline style={styles.multi} />
          <Btn block label={m.entSend} onPress={send} style={styles.tall} />
          <DemoNote text={m.demoNothingSent} />
        </>
      )}
    </SheetModal>
  );
}

/**
 * Redeem an organisation's code. On the plans page it logs in (`login`); in Profile it just
 * changes the plan and says who pays.
 */
export function RedeemForm({ login }: { login?: boolean }) {
  const store = useStore();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const redeem = () => {
    const r = parseCode(code);
    setBad(!r.ok);
    if (!r.ok) return;
    if (!login) setDone(fill(m.redeemed, { org: r.org ?? m.yourOrg }));
    store.redeemCode(code, login);
  };

  if (done) {
    return (
      <View style={styles.done} accessibilityRole="alert">
        <Icon name="check" color={C.accent} size={22} strokeWidth={2.4} />
        <T size={16} style={styles.grow}>
          {done}
        </T>
      </View>
    );
  }

  return (
    <View style={styles.redeem}>
      <Field
        label={m.codeL}
        value={code}
        onChangeText={(v) => {
          setCode(v);
          setBad(false);
        }}
        placeholder={m.codePh}
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={redeem}
        error={bad ? m.badCode : undefined}
      />
      <Btn block label={m.redeem} onPress={redeem} disabled={!code.trim()} />
      <DemoNote text={m.codeDemo} />
    </View>
  );
}

export function DemoNote({ text }: { text: string }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.demo}>
      <Icon name="alert" color={C.dim} size={16} />
      <Text style={styles.demoText}>{text}</Text>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  lh: { lineHeight: 21 },
  card: { gap: 12, padding: 18, borderRadius: 20, borderWidth: 1, borderColor: C.line2, borderStyle: "dashed", backgroundColor: C.surface },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.accentSoft },
  multi: { minHeight: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top" },
  tall: { minHeight: 50 },
  redeem: { gap: 12 },
  demo: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  demoText: { flex: 1, fontFamily: F.regular, fontSize: 13, lineHeight: 18, color: C.dim },
  done: { flexDirection: "row", gap: 12, alignItems: "center", padding: 16, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
}));
