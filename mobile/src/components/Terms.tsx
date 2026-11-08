import { Pressable, Text, View } from "react-native";
import { fill } from "../lib/i18n";
import { formatDay } from "../lib/history";
import { TERMS } from "../lib/terms";
import { F, HEADING_SCALE, makeStyles, useTheme } from "../lib/theme";
import { useMobileCopy, useSpoken } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { HeadButton, SheetModal } from "./PresetSheets";
import { T, useSpeechLang } from "./ui";

/** The terms of use in a page sheet: from the login screen and from Profile. */
export function TermsSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const terms = useSpoken((s) => s.terms);
  const speechLang = useSpeechLang();
  const doc = TERMS[lang];

  return (
    <SheetModal visible={open} onClose={onClose} title={doc.title} right={<HeadButton label={m.close} onPress={onClose} strong />}>
      <View style={styles.note}>
        <Icon name="alert" color={C.muted} size={18} />
        <T size={14} color={C.muted} style={styles.grow}>
          {doc.note}
        </T>
      </View>
      {doc.sections.map((sec) => (
        <View key={sec.h} style={styles.section}>
          <Text style={styles.h} accessibilityRole="header" accessibilityLanguage={speechLang} maxFontSizeMultiplier={HEADING_SCALE}>
            {sec.h}
          </Text>
          {sec.body.map((p) => (
            <T key={p} size={16} style={styles.p}>
              {p}
            </T>
          ))}
        </View>
      ))}
      {terms ? (
        <T size={13} color={C.dim}>
          {fill(m.termsAccepted, { date: formatDay(terms.at, lang) })}
        </T>
      ) : null}
    </SheetModal>
  );
}

/**
 * The agreement on the login screen: a checkbox, and a separate button that opens the terms,
 * so a screen reader finds two plain controls instead of a link inside a checkbox label.
 */
export function TermsAgree({ checked, onChange, onRead, error }: { checked: boolean; onChange(v: boolean): void; onRead(): void; error?: string }) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.agree}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={m.termsAgree}
        accessibilityState={{ checked }}
        accessibilityHint={error}
        onPress={() => onChange(!checked)}
        style={styles.check}
      >
        <View style={[styles.box, checked && styles.boxOn, !!error && !checked && styles.boxBad]}>
          {checked ? <Icon name="check" color={C.inv} size={16} strokeWidth={2.6} /> : null}
        </View>
        <T size={15} style={styles.grow}>
          {m.termsAgree}
        </T>
      </Pressable>
      <Pressable accessibilityRole="link" onPress={onRead} hitSlop={6} style={styles.read}>
        <Text style={styles.readText}>{m.termsRead}</Text>
        <Icon name="chevron" color={C.accent} size={14} />
      </Pressable>
      {error && !checked ? (
        <View style={styles.err} accessibilityRole="alert" accessibilityLiveRegion="assertive">
          <Icon name="alert" color={C.danger} size={16} />
          <Text style={styles.errText}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  note: { flexDirection: "row", gap: 10, padding: 14, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  section: { gap: 8 },
  h: { fontFamily: F.semibold, fontSize: 18, lineHeight: 24, color: C.ink, marginTop: 6 },
  p: { lineHeight: 24 },
  agree: { gap: 4 },
  check: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingVertical: 4 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: C.muted, alignItems: "center", justifyContent: "center", backgroundColor: C.surface },
  boxOn: { backgroundColor: C.accent, borderColor: C.accent },
  boxBad: { borderColor: C.danger },
  read: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", minHeight: 44, marginLeft: 38 },
  readText: { fontFamily: F.medium, fontSize: 15, color: C.accent, textDecorationLine: "underline" },
  err: { flexDirection: "row", alignItems: "center", gap: 6 },
  errText: { fontFamily: F.medium, fontSize: 13.5, color: C.danger, flexShrink: 1 },
}));
