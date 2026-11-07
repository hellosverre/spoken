import { useRef, useState } from "react";
import { KeyboardAvoidingView, ScrollView, Text, View, type TextInputInstance } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { em, F, makeStyles, PAD, small } from "../lib/theme";
import { useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow } from "./Art";
import { Hero } from "./drawings/Hero";
import { Wordmark } from "./Icon";
import { Btn, Field, Rise } from "./ui";

/**
 * Sign-in at startup, after the intro. A placeholder until real accounts exist:
 * only demo / demo gets in (checked in store.login), and nothing leaves the phone.
 */
export function Login() {
  const store = useStore();
  const m = useMobileCopy();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const on = useSpoken((s) => s.screen === "login");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [bad, setBad] = useState(false);
  const passRef = useRef<TextInputInstance>(null);

  const submit = () => {
    const ok = store.login(user, pass);
    setBad(!ok);
    if (ok) setPass("");
  };

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
          <Text style={styles.h} accessibilityRole="header">
            {m.loginH}
          </Text>
          <Text style={styles.lede}>{m.loginSub}</Text>
        </Rise>
        <Rise i={2} on={on} style={styles.form}>
          <Field
            label={m.userL}
            value={user}
            onChangeText={(v) => {
              setUser(v);
              setBad(false);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="username"
            textContentType="username"
            returnKeyType="next"
            onSubmitEditing={() => passRef.current?.focus()}
            error={bad}
          />
          <Field
            ref={passRef}
            label={m.passL}
            value={pass}
            onChangeText={(v) => {
              setPass(v);
              setBad(false);
            }}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={submit}
            error={bad}
          />
          {bad ? (
            <Text style={styles.bad} accessibilityRole="alert" accessibilityLiveRegion="assertive">
              {m.loginBad}
            </Text>
          ) : null}
          <Btn block label={m.loginBtn} onPress={submit} disabled={!user || !pass} style={styles.btn} />
          <Text style={styles.hint}>{m.loginHint}</Text>
        </Rise>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((C) => ({
  root: { flex: 1, backgroundColor: C.app },
  topbar: { paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 6, minHeight: 34, justifyContent: "center" },
  body: { flexGrow: 1, justifyContent: "center", paddingHorizontal: PAD },
  h: { fontFamily: F.semibold, fontSize: 40, lineHeight: 43, letterSpacing: em(-0.026, 40), color: C.ink, marginTop: 26, marginBottom: 10 },
  lede: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted, maxWidth: 300 },
  form: { gap: 14, marginTop: 28 },
  bad: { fontFamily: F.regular, fontSize: 13.5, color: C.danger },
  btn: { marginTop: 4, minHeight: 48 },
  hint: { ...small(13), color: C.dim, textAlign: "center", marginTop: 4 },
}));
