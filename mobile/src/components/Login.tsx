import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApiError, startLogin, verifyLogin } from "../lib/account";
import type { Lang } from "../lib/i18n";
import { TERMS_VERSION } from "../lib/terms";
import { em, F, HEADING_SCALE, makeStyles, PAD, small } from "../lib/theme";
import { useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow } from "./Art";
import { Hero } from "./drawings/Hero";
import { Wordmark } from "./Icon";
import { toE164 } from "./phone";
import { TermsAgree, TermsSheet } from "./Terms";
import { Btn, Field, Rise } from "./ui";

/**
 * Sign up = sign in: phone number → 6-digit SMS code → in. The server needs this session
 * for everything else, so the app opens here after the intro. Same screen for new and returning users.
 * Same flow and copy as web/src/components/Login.tsx.
 */
const T = {
  no: {
    h: "Logg inn med telefonnummer",
    sub: "Spoken ringer for deg, og butikken får se nummeret ditt. Vi sender en kode på SMS.",
    phoneL: "Telefonnummer",
    phoneH: "Landkode +47 er satt for Norge. Endre den for et annet land.",
    send: "Send kode",
    sending: "Sender …",
    codeH: "Skriv inn koden",
    codeSub: (p: string) => `Vi sendte en kode på 6 siffer til ${p}.`,
    codeL: "Kode fra SMS",
    verify: "Logg inn",
    verifying: "Sjekker …",
    resend: "Send ny kode",
    resendIn: (s: number) => `Send ny kode om ${s} s`,
    resent: "Ny kode er sendt.",
    change: "Bruk et annet nummer",
    badPhone: "Det ser ikke ut som et telefonnummer. Sjekk at det er riktig.",
    wrongCode: "Feil kode. Sjekk SMS-en og prøv igjen.",
    expired: "Koden er utløpt. Be om en ny.",
    tooMany: "For mange forsøk. Vent litt og prøv igjen, eller be om en ny kode.",
    smsFail: "Fikk ikke sendt SMS. Prøv igjen om litt.",
    offline: "Får ikke kontakt med Spoken. Sjekk nettet og prøv igjen.",
    other: "Noe gikk galt. Prøv igjen.",
    hint: "Meldingspriser fra mobilselskapet kan gjelde.",
    finishH: "Siste steg: telefonnummeret ditt",
    finishSub: "Kontoen din er knyttet til telefonnummeret. Bekreft det med en kode på SMS, så er du i gang.",
  },
  en: {
    h: "Log in with your phone number",
    sub: "Spoken makes calls for you, and the shop sees your number. We'll text you a code.",
    phoneL: "Phone number",
    phoneH: "Country code +47 is set for Norway. Change it for another country.",
    send: "Send code",
    sending: "Sending …",
    codeH: "Enter the code",
    codeSub: (p: string) => `We sent a 6-digit code to ${p}.`,
    codeL: "Code from the text",
    verify: "Log in",
    verifying: "Checking …",
    resend: "Send a new code",
    resendIn: (s: number) => `Send a new code in ${s} s`,
    resent: "A new code is on its way.",
    change: "Use a different number",
    badPhone: "That doesn't look like a phone number. Check it and try again.",
    wrongCode: "Wrong code. Check the text message and try again.",
    expired: "That code has expired. Ask for a new one.",
    tooMany: "Too many attempts. Wait a bit and try again, or ask for a new code.",
    smsFail: "Couldn't send the text. Try again shortly.",
    offline: "Can't reach Spoken. Check your connection and try again.",
    other: "Something went wrong. Try again.",
    hint: "Your carrier's message rates may apply.",
    finishH: "Last step: your phone number",
    finishSub: "Your account is your phone number. Confirm it with a code by text, and you're in.",
  },
} as const;
type Copy = (typeof T)[Lang];

const RESEND_SECONDS = 30;

/** Maps the server's (Norwegian) errors to our own text in the UI language. */
function explain(e: unknown, step: "phone" | "code", c: Copy): string {
  if (!(e instanceof ApiError)) return c.other;
  if (e.status === 0) return c.offline;
  if (e.status === 429) return c.tooMany;
  if (e.status === 502) return c.smsFail;
  if (e.status === 400) return step === "phone" ? c.badPhone : /utløpt/i.test(e.message) ? c.expired : c.wrongCode;
  return c.other;
}

export function Login() {
  const store = useStore();
  const lang = useSpoken((s) => s.lang);
  const c = T[lang];
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const on = useSpoken((s) => s.screen === "login");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+47 ");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [wait, setWait] = useState(0);
  const codeRef = useRef<TextInputInstance>(null);
  const m = useMobileCopy();
  // From sign-up and a plan: this is the last step. Terms: agreed (this version) or a checkbox.
  const finishing = useSpoken((s) => s.signupPending);
  const terms = useSpoken((s) => s.terms);
  const termsOk = terms?.version === TERMS_VERSION;
  const [agreed, setAgreed] = useState(false);
  const [needTerms, setNeedTerms] = useState(false);
  const [reading, setReading] = useState(false);

  // Resend countdown.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // A fresh Login (after logout or a 401) starts from the phone step.
  useEffect(() => {
    if (on) return;
    setStep("phone");
    setCode("");
    setError("");
    setNote("");
    setWait(0);
  }, [on]);

  const e164 = toE164(phone);

  async function sendCode(again = false) {
    if (busy) return;
    if (!termsOk && !agreed) return setNeedTerms(true);
    if (!e164) {
      setError(c.badPhone);
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      await startLogin(e164);
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
      if (again) setNote(c.resent);
    } catch (e) {
      setError(explain(e, "phone", c));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await verifyLogin(e164, code);
      setCode("");
      store.signedIn(agreed);
    } catch (e) {
      setError(explain(e, "code", c));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { paddingTop: insets.top }]}>
      <Glow cx={0.15} cy={0.18} r={0.75} />
      <View style={styles.topbar}>
        <Wordmark />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Rise i={0} on={on}>
          <Hero width={210} />
        </Rise>
        <Rise i={1} on={on}>
          <Text style={styles.h} accessibilityRole="header" maxFontSizeMultiplier={HEADING_SCALE}>
            {step === "phone" ? (finishing ? c.finishH : c.h) : c.codeH}
          </Text>
          <Text style={styles.lede}>{step === "phone" ? (finishing ? c.finishSub : c.sub) : c.codeSub(e164 || phone.trim())}</Text>
        </Rise>
        <Rise i={2} on={on} style={styles.form}>
          {step === "phone" ? (
            <Field
              label={c.phoneL}
              value={phone}
              onChangeText={(v) => {
                setPhone(v);
                setError("");
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              returnKeyType="go"
              onSubmitEditing={() => void sendCode()}
              accessibilityHint={c.phoneH}
              error={!!error}
            />
          ) : (
            <Field
              ref={codeRef}
              label={c.codeL}
              value={code}
              onChangeText={(v) => {
                setCode(v.replace(/\D/g, "").slice(0, 6));
                setError("");
              }}
              keyboardType="number-pad"
              autoComplete="sms-otp"
              textContentType="oneTimeCode"
              maxLength={6}
              autoFocus
              returnKeyType="go"
              onSubmitEditing={() => void verify()}
              error={!!error}
            />
          )}
          {step === "phone" ? <Text style={styles.help}>{c.phoneH}</Text> : null}
          {error ? (
            <Text style={styles.bad} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {error}
            </Text>
          ) : null}
          {step === "phone" && !termsOk ? (
            <>
              {terms ? <Text style={styles.hint}>{m.termsChanged}</Text> : null}
              <TermsAgree
                checked={agreed}
                onChange={(v) => {
                  setAgreed(v);
                  setNeedTerms(false);
                }}
                onRead={() => setReading(true)}
                error={needTerms ? m.termsNeeded : undefined}
              />
            </>
          ) : null}
          {note ? (
            <Text style={styles.hint} accessibilityLiveRegion="polite">
              {note}
            </Text>
          ) : null}
          <Btn
            block
            label={step === "phone" ? (busy ? c.sending : c.send) : busy ? c.verifying : c.verify}
            onPress={() => void (step === "phone" ? sendCode() : verify())}
            disabled={busy || (step === "phone" ? !e164 : code.length !== 6)}
            style={styles.btn}
          />
          {step === "code" ? (
            <>
              <Btn
                block
                kind="ghost"
                label={wait > 0 ? c.resendIn(wait) : c.resend}
                onPress={() => void sendCode(true)}
                disabled={busy || wait > 0}
              />
              <Btn
                block
                kind="ghost"
                label={c.change}
                onPress={() => {
                  setStep("phone");
                  setError("");
                  setNote("");
                }}
              />
            </>
          ) : null}
          <Text style={styles.hint}>{c.hint}</Text>
          {step === "phone" && !finishing ? (
            <View style={styles.switch}>
              <Text style={styles.switchText}>{m.newHere}</Text>
              <Pressable accessibilityRole="button" onPress={() => store.openSignup()} hitSlop={8} style={styles.link}>
                <Text style={styles.linkText}>{m.createAccount}</Text>
              </Pressable>
            </View>
          ) : null}
          {termsOk ? <Btn kind="ghost" label={m.termsL} onPress={() => setReading(true)} style={styles.termsBtn} /> : null}
        </Rise>
      </ScrollView>
      <TermsSheet open={reading} onClose={() => setReading(false)} />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  topbar: { paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 6, minHeight: 34, justifyContent: "center" },
  body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: PAD },
  h: { fontFamily: F.semibold, fontSize: 36, lineHeight: 40, letterSpacing: em(-0.026, 36), color: C.ink, marginTop: 26, marginBottom: 10 },
  lede: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted, maxWidth: 320 },
  form: { gap: 14, marginTop: 28 },
  help: { ...small(13), color: C.dim, marginTop: -6 },
  bad: { fontFamily: F.regular, fontSize: 13.5, color: C.danger },
  btn: { marginTop: 4, minHeight: 48 },
  hint: { ...small(13), color: C.dim, textAlign: "center", marginTop: 4 },
  termsBtn: { alignSelf: "center" },
  switch: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 6 },
  switchText: { ...small(14), color: C.muted },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontFamily: F.medium, fontSize: 14, color: C.accent, textDecorationLine: "underline" },
}));
