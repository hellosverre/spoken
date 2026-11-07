import { useEffect, useState, type ReactNode } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import type { ThemePref } from "../lib/store";
import { em, F, makeStyles, PAD, small, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow } from "./Art";
import { AccountSection, useAccountCopy } from "./Account";
import { ContactsSection } from "./ContactPicker";
import { FeedbackSheet } from "./Feedback";
import { HeroDuet } from "./drawings/Hero";
import { Icon, type IconName } from "./Icon";
import { List, Row, Seg } from "./List";
import { Field, T } from "./ui";
import { VoicePicker } from "./VoicePicker";

/**
 * The Profile tab: who you are, how the app looks, how calls are made, and the
 * web's settings (language, replay intro), plus log out. Replaces the web's Settings tab.
 */
export function Profile() {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const themePref = useSpoken((s) => s.themePref);
  const profile = useSpoken((s) => s.profile);
  const serverCalls = useSpoken((s) => s.serverCalls);
  const savedCode = useSpoken((s) => s.passcode);
  const ac = useAccountCopy();
  const [contactsKey, setContactsKey] = useState(0);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [code, setCode] = useState(savedCode);
  useEffect(() => setCode(savedCode), [savedCode]);

  // Edit locally; save when a field is left, so typing doesn't write storage per key.
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  useEffect(() => {
    setName(profile.name);
    setPhone(profile.phone);
  }, [profile]);

  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "?";
  const first = name.trim().split(/\s+/)[0] ?? "";
  const hour = new Date().getHours();
  const greet = m.greet[hour < 5 ? "night" : hour < 11 ? "morning" : hour < 18 ? "day" : "evening"];
  const realOn = serverCalls && !!savedCode;
  const teal = C.tints.teal;

  return (
    <ScrollView style={styles.grow} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.h} accessibilityRole="header">
        {m.profileH}
      </Text>

      {/* Who you are: the one coloured, drawn card on the page. */}
      <View style={styles.card}>
        <Glow cx={0.12} cy={0.2} r={0.85} />
        <HeroDuet width={128} style={styles.cardArt} />
        <View style={styles.avatar}>
          <T size={24} weight="semibold" color={C.inv}>
            {initials}
          </T>
        </View>
        <Text style={styles.hello}>{first ? `${greet}, ${first}` : greet}</Text>
        <T size={22} weight="semibold">
          {name.trim() || "—"}
        </T>
        <Text style={styles.handle}>@demo</Text>
      </View>

      <SectionTitle icon="person" title={m.you} />
      <View style={styles.group}>
        <View>
          <FieldRow icon="person">
            <Field
              label={m.nameL}
              value={name}
              onChangeText={setName}
              onBlur={() => store.setProfile({ name: name.trim() })}
              autoComplete="name"
              textContentType="name"
              returnKeyType="done"
              style={styles.input}
            />
          </FieldRow>
          <Text style={styles.help}>{m.nameS}</Text>
        </View>
        <View>
          <FieldRow icon="phone">
            <Field
              label={m.phoneL}
              value={phone}
              onChangeText={setPhone}
              onBlur={() => store.setProfile({ phone: phone.trim() })}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              placeholder="+47"
              style={styles.input}
            />
          </FieldRow>
          <Text style={styles.help}>{m.phoneS}</Text>
        </View>
      </View>

      <SectionTitle icon="phone" title={lang === "no" ? "Stemme" : "Voice"} />
      <VoicePicker />

      <SectionTitle icon="phone" title={m.callsH} />
      <View style={[styles.group, realOn && { borderColor: teal.fg }]}>
        <View style={styles.switchRow}>
          <View style={[styles.tile, { backgroundColor: realOn ? teal.bg : C.accentSoft }]}>
            <Icon name="cloud" color={realOn ? teal.fg : C.accent} size={19} />
          </View>
          <View style={styles.grow}>
            <T size={15} weight="semibold">
              {m.serverL}
            </T>
            <T size={13} color={C.dim}>
              {m.serverS}
            </T>
          </View>
          <Switch
            value={serverCalls}
            onValueChange={(v) => store.setServerCalls(v)}
            trackColor={{ false: C.line2, true: C.accent }}
            thumbColor="#fff"
            ios_backgroundColor={C.line2}
            accessibilityLabel={m.serverL}
          />
        </View>
        {serverCalls ? (
          <>
            <View style={styles.divider} />
            <FieldRow icon="key" tint={realOn ? teal : undefined}>
              <Field
                label={m.passcodeL}
                value={code}
                onChangeText={setCode}
                onBlur={() => store.setPasscode(code)}
                onSubmitEditing={() => store.setPasscode(code)}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                style={styles.input}
              />
            </FieldRow>
            {/* The state of calls, said plainly: real phones can ring, or it's a demo. */}
            <View style={styles.state} accessibilityLiveRegion="polite">
              <Icon name={realOn ? "check" : "phone"} color={realOn ? teal.fg : C.dim} size={16} strokeWidth={realOn ? 2.4 : 1.7} />
              <Text style={[styles.stateText, { color: realOn ? teal.fg : C.dim }]}>{realOn ? m.passcodeSet : m.passcodeS}</Text>
            </View>
          </>
        ) : null}
      </View>

      <SectionTitle icon="key" title={ac.title} />
      <AccountSection onChange={() => setContactsKey((k) => k + 1)} />

      <SectionTitle icon="person" title={lang === "no" ? "Lagrede kontakter" : "Saved contacts"} />
      <ContactsSection key={contactsKey} />

      <SectionTitle icon="sliders" title={m.appearance} />
      <View style={styles.group}>
        <View style={styles.switchRow}>
          <View style={[styles.tile, { backgroundColor: C.accentSoft }]}>
            <Icon name={THEME_ICON[themePref]} color={C.accent} size={19} />
          </View>
          <View style={styles.grow}>
            <T size={15} weight="semibold">
              {m.themeL}
            </T>
            <T size={13} color={C.dim}>
              {m.themeS}
            </T>
          </View>
        </View>
        <Seg<ThemePref>
          wide
          label={m.themeL}
          value={themePref}
          onChange={(v) => store.setThemePref(v)}
          options={(["system", "light", "dark"] as const).map((v) => ({ v, label: m.themes[v], icon: THEME_ICON[v] }))}
        />
      </View>

      <SectionTitle icon="bubble" title={m.general} />
      <List>
        <Row
          first
          icon="globe"
          title={t.langL}
          sub={t.langS}
          go={
            <Seg
              label={t.langL}
              value={lang}
              onChange={(v) => store.setLang(v)}
              options={(["en", "no"] as const).map((v) => ({ v, label: v.toUpperCase() }))}
            />
          }
        />
        <Row icon="replay" title={t.replay} sub={t.replayS} go={<Icon name="chevron" color={C.dim} size={16} />} onPress={() => store.replay()} />
        <Row icon="bubble" title={m.fbRowT} sub={m.fbRowS} go={<Icon name="chevron" color={C.dim} size={16} />} onPress={() => setFeedbackOpen(true)} />
        <Row title={m.logout} icon="logout" tone="danger" onPress={() => store.logout()} />
      </List>

      <Text style={styles.about}>{t.foot}</Text>
      {feedbackOpen ? <FeedbackSheet onClose={() => setFeedbackOpen(false)} /> : null}
    </ScrollView>
  );
}

const THEME_ICON: Record<ThemePref, IconName> = { system: "auto", light: "sun", dark: "moon" };

/** A field with an icon tile beside its input. */
function FieldRow({ icon, tint, children }: { icon: IconName; tint?: { fg: string; bg: string }; children: ReactNode }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.fieldRow}>
      <View style={[styles.fieldTile, { backgroundColor: tint?.bg ?? C.accentSoft }]}>
        <Icon name={icon} color={tint?.fg ?? C.accent} size={19} />
      </View>
      <View style={styles.grow}>{children}</View>
    </View>
  );
}

function SectionTitle({ icon, title }: { icon: IconName; title: string }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Icon name={icon} color={C.accent} size={16} />
      <Text style={styles.sectionText} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  body: { paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 32 },
  h: { fontFamily: F.semibold, fontSize: 28, lineHeight: 32, letterSpacing: em(-0.022, 28), color: C.ink, marginTop: 6, marginBottom: 16 },
  card: {
    padding: 20,
    paddingTop: 22,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    overflow: "hidden",
    boxShadow: C.lift,
  },
  cardArt: { position: "absolute", right: -8, top: 14, opacity: 0.9 },
  // The accent avatar with a soft halo, so the one coloured thing on the page reads as you.
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: C.accentSoft,
    marginBottom: 14,
  },
  hello: { fontFamily: F.medium, fontSize: 14, color: C.accent, marginBottom: 2 },
  handle: { ...small(13), color: C.dim, marginTop: 2 },
  section: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 28, marginBottom: 10, marginLeft: 2 },
  sectionText: { fontFamily: F.semibold, fontSize: 17, letterSpacing: em(-0.01, 17), color: C.ink },
  group: { gap: 14, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, boxShadow: C.lift },
  input: { backgroundColor: C.app },
  help: { fontFamily: F.regular, fontSize: 12.5, lineHeight: 17, color: C.dim, marginTop: 6, marginLeft: 2 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  tile: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  fieldRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  fieldTile: { width: 48, height: 48, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  divider: { height: 1, backgroundColor: C.line },
  state: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: -4 },
  stateText: { flex: 1, fontFamily: F.medium, fontSize: 13, lineHeight: 18 },
  about: { marginTop: 22, marginHorizontal: 2, fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim, maxWidth: 320 },
}));
