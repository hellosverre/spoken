import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "../lib/account";
import { F, makeStyles, small, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import { T } from "./ui";
import { VoiceOrb } from "./VoiceOrb";

interface VoiceItem {
  id: string;
  name: string;
  lang?: "no" | "en";
  gender?: "male" | "female";
}

// Same eight ids as server/src/voice/voices.ts: shown until (or without) the server list.
const OFFLINE: VoiceItem[] = [
  { id: "4kCDY3HJwvO7Zp3con83", name: "Sebastian", lang: "no", gender: "male" },
  { id: "xF681s0UeE04gsf0mVsJ", name: "Olaf", lang: "no", gender: "male" },
  { id: "BRY5wALXFkJsxVM6sEOH", name: "Nadia", lang: "no", gender: "female" },
  { id: "uNsWM1StCcpydKYOjKyu", name: "Mia", lang: "no", gender: "female" },
  { id: "ii0s2u4R3UFnxKL6DOrz", name: "Maya", lang: "en", gender: "female" },
  { id: "OZxMHsGaBmV5pjMIDIn0", name: "Amy", lang: "en", gender: "female" },
  { id: "OEHTkiHZj6OczWZHu0Aj", name: "John", lang: "en", gender: "male" },
  { id: "Cz0K1kOv9tD8l0b5Qu53", name: "Jon", lang: "en", gender: "male" },
];
const DEFAULTS = { no: "4kCDY3HJwvO7Zp3con83", en: "Cz0K1kOv9tD8l0b5Qu53" } as const;

const COPY = {
  en: {
    no: "Norsk", en: "English", choose: "Choose", chosen: "Chosen", standard: "Default", male: "male", female: "female",
    play: (n: string) => `Preview ${n}`, stop: (n: string) => `Stop preview of ${n}`, pick: (n: string) => `Choose ${n} as your voice`,
    fail: "Couldn't save on the server.",
    hint: "The voice your calls use. A call uses it when it matches the call's language.",
  },
  no: {
    no: "Norsk", en: "English", choose: "Velg", chosen: "Valgt", standard: "Standard", male: "mann", female: "kvinne",
    play: (n: string) => `Hør ${n}`, stop: (n: string) => `Stopp ${n}`, pick: (n: string) => `Velg ${n} som stemme`,
    fail: "Fikk ikke lagret på serveren.",
    hint: "Stemmen samtalene dine bruker. Den brukes når den passer til språket i samtalen.",
  },
} as const;

/** Profile → Voice: eight voices as orbs, grouped Norsk / English. Tap the orb to preview, Velg to keep it.
 *  Preview audio needs expo-audio, which isn't a dependency yet: until then the orb only animates. */
export function VoicePicker() {
  const lang = useSpoken((s) => s.lang);
  const c = COPY[lang];
  const { C } = useTheme();
  const styles = useStyles();
  const [voices, setVoices] = useState<VoiceItem[]>(OFFLINE);
  const [selected, setSelected] = useState("");
  const [playing, setPlaying] = useState("");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    api<VoiceItem[]>("GET", "/api/voices").then((l) => {
      const got = l.filter((v) => v.lang);
      if (got.length) setVoices(got);
    }).catch(() => {});
    api<{ voiceId?: string }>("GET", "/api/profile").then((p) => p.voiceId && setSelected(p.voiceId)).catch(() => {});
    return () => clearTimeout(timer.current);
  }, []);

  const toggle = useCallback((id: string) => {
    clearTimeout(timer.current);
    setPlaying((cur) => (cur === id ? "" : id));
    timer.current = setTimeout(() => setPlaying(""), 3500);
  }, []);

  async function choose(id: string) {
    setSelected(id);
    setError("");
    try {
      const cur = await api<Record<string, unknown>>("GET", "/api/profile");
      await api("PUT", "/api/profile", { hearCall: true, personality: "warm", ...cur, lang, voiceId: id });
    } catch {
      setError(c.fail);
    }
  }

  return (
    <View>
      <Text style={styles.hint}>{c.hint}</Text>
      {(["no", "en"] as const).map((l) => (
        <View key={l} accessibilityRole="none">
          <Text style={styles.group} accessibilityRole="header">{c[l]}</Text>
          <View style={styles.grid}>
            {voices.filter((v) => v.lang === l).map((v) => {
              const on = selected === v.id;
              const isPlaying = playing === v.id;
              const isDefault = !selected && DEFAULTS[l] === v.id;
              return (
                <View key={v.id} style={[styles.card, on && { borderColor: C.accent }]}>
                  <Pressable
                    onPress={() => toggle(v.id)}
                    accessibilityRole="button"
                    accessibilityLabel={isPlaying ? c.stop(v.name) : c.play(v.name)}
                    accessibilityState={{ selected: isPlaying }}
                    style={styles.orb}
                  >
                    <VoiceOrb voiceId={v.id} playing={isPlaying} />
                  </Pressable>
                  <T size={15} weight="semibold">{v.name}</T>
                  <Text style={styles.sub}>{`${v.gender ? c[v.gender] : ""}${isDefault ? ` · ${c.standard}` : ""}`}</Text>
                  <Pressable
                    onPress={() => void choose(v.id)}
                    accessibilityRole="button"
                    accessibilityLabel={c.pick(v.name)}
                    accessibilityState={{ selected: on }}
                    style={[styles.choose, on && { backgroundColor: C.accentSoft, borderColor: C.accent }]}
                  >
                    <T size={13} weight="medium" color={on ? C.accent : C.ink}>{on ? `✓ ${c.chosen}` : c.choose}</T>
                  </Pressable>
                </View>
              );
            })}
          </View>
        </View>
      ))}
      {error ? <Text style={styles.hint} accessibilityLiveRegion="polite">{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  hint: { ...small(13), color: C.dim, marginBottom: 6 },
  group: { fontFamily: F.medium, fontSize: 13, color: C.muted, marginTop: 10, marginBottom: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  card: {
    width: "48%", flexGrow: 1, alignItems: "center", gap: 2, paddingTop: 14, paddingBottom: 10, paddingHorizontal: 8,
    borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface,
  },
  orb: { padding: 4, marginBottom: 4, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  sub: { ...small(12), color: C.muted, minHeight: 16 },
  choose: {
    marginTop: 6, alignSelf: "stretch", minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line2,
    alignItems: "center", justifyContent: "center",
  },
}));
