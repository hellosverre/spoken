import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { accountPhone, logoutAccount, startLogin, verifyLogin } from "../lib/account";
import { F, makeStyles, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { List, Row } from "./List";
import { Btn, Field } from "./ui";

const COPY = {
  en: {
    title: "Account",
    login: "Log in with phone number",
    loginS: "Optional. Keeps your contacts and calls on all your devices.",
    phoneL: "Phone number",
    send: "Send code",
    codeL: "Code from the text message",
    verify: "Log in",
    back: "Other number",
    cancel: "Cancel",
    loggedIn: "Logged in",
    logout: "Log out",
    busy: "One moment…",
  },
  no: {
    title: "Konto",
    login: "Logg inn med telefonnummer",
    loginS: "Valgfritt. Gir deg kontaktene og samtalene dine på alle enhetene dine.",
    phoneL: "Telefonnummer",
    send: "Send kode",
    codeL: "Kode fra tekstmeldingen",
    verify: "Logg inn",
    back: "Annet nummer",
    cancel: "Avbryt",
    loggedIn: "Innlogget",
    logout: "Logg ut",
    busy: "Et øyeblikk …",
  },
} as const;

export function useAccountCopy() {
  return COPY[useSpoken((s) => s.lang)];
}

/** Profile → Account: log in with an SMS code, or see the number and log out. */
export function AccountSection({ onChange }: { onChange?: () => void }) {
  const c = useAccountCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [me, setMe] = useState("");
  const [step, setStep] = useState<"idle" | "phone" | "code">("idle");
  const [phone, setPhone] = useState("+47");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    accountPhone().then(setMe, () => {});
  }, []);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (me) {
    return (
      <List>
        <Row first icon="person" title={me} sub={c.loggedIn} />
        <Row
          icon="logout"
          tone="danger"
          title={c.logout}
          onPress={() =>
            run(async () => {
              await logoutAccount();
              setMe("");
              setStep("idle");
              onChange?.();
            })
          }
        />
      </List>
    );
  }

  if (step === "idle") {
    return (
      <List>
        <Row first icon="phone" title={c.login} sub={c.loginS} go={<Icon name="chevron" color={C.dim} size={16} />} onPress={() => setStep("phone")} />
      </List>
    );
  }

  return (
    <View style={styles.box}>
      {step === "phone" ? (
        <Field label={c.phoneL} value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel" autoFocus />
      ) : (
        <Field
          label={c.codeL}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          autoFocus
        />
      )}
      {error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Btn
        block
        label={busy ? c.busy : step === "phone" ? c.send : c.verify}
        disabled={busy || (step === "phone" ? phone.trim().length < 8 : code.length !== 6)}
        onPress={() =>
          step === "phone"
            ? run(async () => {
                await startLogin(phone.trim());
                setCode("");
                setStep("code");
              })
            : run(async () => {
                await verifyLogin(phone.trim(), code);
                setMe(await accountPhone());
                setStep("idle");
                onChange?.();
              })
        }
      />
      <Btn kind="ghost" block label={step === "code" ? c.back : c.cancel} onPress={() => setStep(step === "code" ? "phone" : "idle")} />
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  box: { gap: 12 },
  error: { fontFamily: F.regular, fontSize: 13, color: C.danger },
}));
