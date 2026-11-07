import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { ThemePref } from "../lib/store";
import { em, F, makeStyles, PAD, small, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { List, Row, Seg } from "./List";
import { Field, T } from "./ui";

/**
 * The Profile tab: who you are, how the app looks, and the web's settings
 * (language, replay intro), plus log out. Replaces the web's Settings tab.
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

  return (
    <ScrollView style={styles.grow} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
      <Text style={styles.h} accessibilityRole="header">
        {m.profileH}
      </Text>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <T size={20} weight="semibold" color={C.inv}>
            {initials}
          </T>
        </View>
        <View style={styles.grow}>
          <T size={18} weight="semibold" numberOfLines={1}>
            {name.trim() || "—"}
          </T>
          <Text style={styles.handle}>@demo</Text>
        </View>
      </View>

      <Text style={styles.section}>{m.you}</Text>
      <View style={styles.fields}>
        <View>
          <Field
            label={m.nameL}
            value={name}
            onChangeText={setName}
            onBlur={() => store.setProfile({ name: name.trim() })}
            autoComplete="name"
            textContentType="name"
            returnKeyType="done"
          />
          <Text style={styles.help}>{m.nameS}</Text>
        </View>
        <View>
          <Field
            label={m.phoneL}
            value={phone}
            onChangeText={setPhone}
            onBlur={() => store.setProfile({ phone: phone.trim() })}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            placeholder="+47"
          />
          <Text style={styles.help}>{m.phoneS}</Text>
        </View>
      </View>

      <Text style={styles.section}>{m.appearance}</Text>
      <List>
        <Row
          first
          title={m.themeL}
          sub={m.themeS}
          go={
            <Seg<ThemePref>
              label={m.themeL}
              value={themePref}
              onChange={(v) => store.setThemePref(v)}
              options={(["system", "light", "dark"] as const).map((v) => ({ v, label: m.themes[v] }))}
            />
          }
        />
      </List>

      <Text style={styles.section}>{m.general}</Text>
      <List>
        <Row
          first
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
        <Row title={t.replay} sub={t.replayS} go={<Icon name="replay" color={C.dim} size={16} />} onPress={() => store.replay()} />
        <Row title={m.logout} icon="logout" tone="danger" onPress={() => store.logout()} />
      </List>

      <Text style={styles.about}>{t.foot}</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  body: { paddingHorizontal: PAD, paddingTop: 20, paddingBottom: 24 },
  h: { fontFamily: F.semibold, fontSize: 28, lineHeight: 31, letterSpacing: em(-0.02, 28), color: C.ink, marginTop: 6, marginBottom: 18 },
  card: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.accent, alignItems: "center", justifyContent: "center" },
  handle: { ...small(13), color: C.dim, marginTop: 2 },
  section: { fontFamily: F.semibold, fontSize: 15, color: C.ink, marginTop: 26, marginBottom: 10, marginLeft: 2 },
  fields: { gap: 14 },
  help: { fontFamily: F.regular, fontSize: 12.5, color: C.dim, marginTop: 6, marginLeft: 2 },
  about: { marginTop: 18, marginHorizontal: 2, fontFamily: F.regular, fontSize: 13, lineHeight: 19, color: C.dim, maxWidth: 320 },
}));
