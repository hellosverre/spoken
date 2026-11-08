import { useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { api } from "../lib/account";
import type { ThemePref } from "../lib/store";
import { em, F, makeStyles, PAD, small, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow } from "./Art";
import { AccountSection, useAccountCopy } from "./Account";
import { ContactsSection } from "./ContactPicker";
import { resetContactCache } from "./ContactChip";
import { FeedbackSheet } from "./Feedback";
import { HeroDuet } from "./drawings/Hero";
import { Icon, type IconName } from "./Icon";
import { List, Row, Seg } from "./List";
import { Field, T } from "./ui";
import { VoicePicker } from "./VoicePicker";
import { VoiceSheet } from "./VoiceSheet";

const DELETE_COPY = {
  no: {
    row: "Slett kontoen min", sub: "Fjerner alt om deg fra Spoken", title: "Slette kontoen?",
    body: "Alt om deg slettes: profil, kontakter og samtalehistorikk. Kan ikke angres.", cancel: "Avbryt", confirm: "Slett alt",
    failedT: "Kunne ikke slette kontoen", failed: "Prøv igjen.",
  },
  en: {
    row: "Delete my account", sub: "Removes everything about you from Spoken", title: "Delete your account?",
    body: "Everything about you is deleted: profile, contacts and call history. This can't be undone.", cancel: "Cancel", confirm: "Delete everything",
    failedT: "Couldn't delete the account", failed: "Try again.",
  },
} as const;

/** Erase the account on the server, then forget everything on this device and log out. */
async function eraseAccount(logout: () => Promise<void>) {
  await api("DELETE", "/api/account");
  const keys = (await AsyncStorage.getAllKeys().catch(() => [])).filter((k) => k.toLowerCase().startsWith("spoken"));
  await AsyncStorage.multiRemove(keys).catch(() => {});
  resetContactCache();
  await logout();
}

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

      <ReasonSection />

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
        <Row title={m.logout} icon="logout" tone="danger" onPress={() => { resetContactCache(); void store.logout(); }} />
      </List>

      <Text style={styles.about}>{t.foot}</Text>
      <List>
        <Row
          first
          title={DELETE_COPY[lang].row}
          sub={DELETE_COPY[lang].sub}
          icon="logout"
          tone="danger"
          onPress={() => {
            const d = DELETE_COPY[lang];
            Alert.alert(d.title, d.body, [
              { text: d.cancel, style: "cancel" },
              {
                text: d.confirm,
                style: "destructive",
                onPress: () => eraseAccount(() => store.logout()).catch(() => Alert.alert(d.failedT, d.failed)),
              },
            ]);
          }}
        />
      </List>
      {feedbackOpen ? <FeedbackSheet onClose={() => setFeedbackOpen(false)} /> : null}
    </ScrollView>
  );
}

type Reason = "deaf" | "hard_of_hearing" | "speech" | "anxiety" | "other";
type Mode = "always" | "when_helpful" | "never";
interface ReasonState { reason?: Reason; reasonText?: string; reasonMode?: Mode }
const REASONS: Reason[] = ["deaf", "hard_of_hearing", "speech", "anxiety", "other"];
const MODES: Mode[] = ["always", "when_helpful", "never"];

const REASON_COPY = {
  no: {
    title: "Fortell hvorfor jeg bruker Spoken", none: "Ikke satt", done: "Ferdig", clear: "Fjern",
    hint: "Valgfritt. Sies bare i samtaler, og lagres først når du velger noe. Du kan fjerne det når som helst.",
    why: "Grunn", when: "Når skal Spoken nevne det?", otherL: "Egen tekst", otherPh: "f.eks. har dysleksi", saveFail: "Fikk ikke lagret.",
    reasons: { deaf: "Døv", hard_of_hearing: "Hørselshemmet", speech: "Talevansker", anxiety: "Telefonangst", other: "Annet" },
    modes: { always: "Alltid", when_helpful: "Bare når det hjelper", never: "Aldri" },
  },
  en: {
    title: "Tell why I use Spoken", none: "Not set", done: "Done", clear: "Remove",
    hint: "Optional. Only said on calls, and stored only once you choose something. You can remove it any time.",
    why: "Reason", when: "When should Spoken mention it?", otherL: "Your own words", otherPh: "e.g. has dyslexia", saveFail: "Couldn't save.",
    reasons: { deaf: "Deaf", hard_of_hearing: "Hard of hearing", speech: "Speech", anxiety: "Phone anxiety", other: "Other" },
    modes: { always: "Always", when_helpful: "Only when it helps", never: "Never" },
  },
} as const;

/** Optional «why I use Spoken»: a collapsed row like the voice row, details in a sheet. Health data: only exists once the user sets it. */
function ReasonSection() {
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const c = REASON_COPY[lang];
  const [st, setSt] = useState<ReasonState>({});
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ReasonState>("GET", "/api/profile").then((p) => { setSt({ reason: p.reason, reasonText: p.reasonText, reasonMode: p.reasonMode }); setDraft(p.reasonText ?? ""); }).catch(() => {});
  }, []);

  /** next = null clears all three; the server keeps the old value when the keys are absent. */
  async function save(next: ReasonState | null) {
    const prev = st;
    const value = next ?? {};
    setSt(value);
    setError("");
    try {
      const cur = await api<Record<string, unknown>>("GET", "/api/profile");
      await api("PUT", "/api/profile", {
        hearCall: true, personality: "warm", ...cur, lang,
        reason: value.reason ?? null, reasonText: value.reasonText ?? null, reasonMode: value.reasonMode ?? null,
      });
    } catch {
      setSt(prev);
      setError(c.saveFail);
    }
  }

  const mode = st.reasonMode ?? "when_helpful";
  const label = st.reason ? `${st.reason === "other" && st.reasonText ? st.reasonText : c.reasons[st.reason]} · ${c.modes[mode]}` : c.none;

  return (
    <>
      <List>
        <Row first icon="person" title={c.title} sub={label} go={<Icon name="chevron" color={C.dim} size={16} />} onPress={() => setOpen(true)} />
      </List>
      {error ? <Text style={styles.help} accessibilityLiveRegion="polite">{error}</Text> : null}
      <VoiceSheet visible={open} title={c.title} closeLabel={c.done} onClose={() => setOpen(false)}>
        <Text style={[styles.help, { marginBottom: 12 }]}>{c.hint}</Text>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={c.why}>
          {REASONS.map((r) => {
            const on = st.reason === r;
            return (
              <Pressable
                key={r}
                accessibilityRole="radio"
                accessibilityLabel={c.reasons[r]}
                accessibilityState={{ checked: on }}
                onPress={() => void save({ reason: r, reasonMode: mode, reasonText: r === "other" ? draft.trim().slice(0, 60) || undefined : undefined })}
                style={[styles.chip, on && { borderColor: C.accent, backgroundColor: C.accentSoft }]}
              >
                <T size={14} weight="medium" color={on ? C.accent : undefined}>{c.reasons[r]}</T>
              </Pressable>
            );
          })}
        </View>
        {st.reason === "other" ? (
          <Field
            label={c.otherL}
            placeholder={c.otherPh}
            maxLength={60}
            value={draft}
            onChangeText={setDraft}
            onBlur={() => draft.trim() !== (st.reasonText ?? "") && void save({ ...st, reasonText: draft.trim() || undefined })}
            returnKeyType="done"
            style={styles.input}
          />
        ) : null}
        {st.reason ? (
          <>
            <Text style={[styles.help, { marginTop: 16, marginBottom: 8 }]}>{c.when}</Text>
            <Seg<Mode> wide label={c.when} value={mode} onChange={(v) => void save({ ...st, reasonMode: v })} options={MODES.map((v) => ({ v, label: c.modes[v] }))} />
            <Pressable accessibilityRole="button" accessibilityLabel={c.clear} onPress={() => { setDraft(""); void save(null); }} style={styles.clear}>
              <T size={14} color={C.dim}>{c.clear}</T>
            </Pressable>
          </>
        ) : null}
      </VoiceSheet>
    </>
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
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: C.line2, justifyContent: "center" },
  clear: { minHeight: 44, marginTop: 12, alignSelf: "flex-start", justifyContent: "center" },
  divider: { height: 1, backgroundColor: C.line },
  state: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: -4 },
  stateText: { flex: 1, fontFamily: F.medium, fontSize: 13, lineHeight: 18 },
  about: { marginTop: 22, marginHorizontal: 2, fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim, maxWidth: 320 },
}));
