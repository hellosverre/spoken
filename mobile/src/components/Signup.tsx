import { useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, Text, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { em, F, HEADING_SCALE, makeStyles, PAD, small } from "../lib/theme";
import { useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow } from "./Art";
import { Wordmark } from "./Icon";
import { TermsAgree, TermsSheet } from "./Terms";
import { Btn, Field, Rise } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create an account: name, email, password and the terms, then on to the plans. A showcase:
 * nothing is saved or sent, and the plan that follows logs in as the demo user.
 * Mistakes show under their field when Continue is pressed, never while typing.
 */
export function Signup() {
  const store = useStore();
  const m = useMobileCopy();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const on = useSpoken((s) => s.screen === "signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [reading, setReading] = useState(false);
  const emailRef = useRef<TextInputInstance>(null);
  const passRef = useRef<TextInputInstance>(null);

  const errors = {
    name: name.trim() ? undefined : m.needSignupName,
    email: EMAIL.test(email.trim()) ? undefined : m.needEmail,
    pass: pass.length >= 8 ? undefined : m.needPass,
    terms: agreed ? undefined : m.termsNeeded,
  };
  const show = (e?: string) => (tried ? e : undefined);

  const submit = () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    store.signup();
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, { paddingTop: insets.top }]}>
      <Glow cx={0.85} cy={0.12} r={0.7} />
      <View style={styles.topbar}>
        <Wordmark />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Rise i={0} on={on}>
          <Text style={styles.h} accessibilityRole="header" maxFontSizeMultiplier={HEADING_SCALE}>
            {m.signupH}
          </Text>
          <Text style={styles.lede}>{m.signupSub}</Text>
        </Rise>
        <Rise i={1} on={on} style={styles.form}>
          <Field
            label={m.signupNameL}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
            error={show(errors.name)}
          />
          <Field
            ref={emailRef}
            label={m.emailL}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
            error={show(errors.email)}
          />
          <View>
            <Field
              ref={passRef}
              label={m.newPassL}
              value={pass}
              onChangeText={setPass}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={submit}
              error={show(errors.pass)}
            />
            {show(errors.pass) ? null : <Text style={styles.help}>{m.newPassHelp}</Text>}
          </View>
          <TermsAgree checked={agreed} onChange={setAgreed} onRead={() => setReading(true)} error={show(errors.terms)} />
          <Btn block label={m.signupBtn} onPress={submit} style={styles.btn} />
          <View style={styles.switch}>
            <Text style={styles.switchText}>{m.haveAccount}</Text>
            <Pressable accessibilityRole="button" onPress={() => store.openLogin()} hitSlop={8} style={styles.link}>
              <Text style={styles.linkText}>{m.loginBtn}</Text>
            </Pressable>
          </View>
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
  h: { fontFamily: F.semibold, fontSize: 36, lineHeight: 40, letterSpacing: em(-0.024, 36), color: C.ink, marginTop: 20, marginBottom: 10 },
  lede: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted, maxWidth: 320 },
  form: { gap: 14, marginTop: 26 },
  help: { ...small(12.5), color: C.dim, marginTop: 6, marginLeft: 2 },
  btn: { marginTop: 4, minHeight: 48 },
  switch: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: 6 },
  switchText: { ...small(14), color: C.muted },
  link: { minHeight: 44, justifyContent: "center" },
  linkText: { fontFamily: F.medium, fontSize: 14, color: C.accent, textDecorationLine: "underline" },
}));
