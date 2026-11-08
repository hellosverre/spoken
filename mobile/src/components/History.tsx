import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { fill } from "../lib/i18n";
import { formatWhen, type CallRecord } from "../lib/history";
import { em, F, makeStyles, small, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { HeadButton, SheetModal } from "./PresetSheets";
import { Btn, T, useSpeechLang } from "./ui";

/**
 * Profile → Call history: every finished call (title, date, outcome) with a button
 * to read its transcript, which opens in the same sheet. Saved on this phone only.
 */
export function HistorySheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const store = useStore();
  const m = useMobileCopy();
  const history = useSpoken((s) => s.history);
  const [selected, setSelected] = useState<CallRecord | null>(null);

  // Opening the sheet starts at the list.
  useEffect(() => {
    if (open) setSelected(null);
  }, [open]);

  const clearAll = () =>
    Alert.alert(m.deleteAllQ, m.historyLocal, [
      { text: m.cancel, style: "cancel" },
      { text: m.deleteAll, style: "destructive", onPress: () => store.clearHistory() },
    ]);

  const deleteOne = (c: CallRecord) =>
    Alert.alert(m.deleteCallQ, c.contact, [
      { text: m.cancel, style: "cancel" },
      {
        text: m.deleteCall,
        style: "destructive",
        onPress: () => {
          store.deleteCall(c.id);
          setSelected(null);
        },
      },
    ]);

  if (selected) {
    return (
      <SheetModal
        visible={open}
        onClose={onClose}
        title={m.transcriptH}
        left={<HeadButton label={`‹ ${m.back}`} onPress={() => setSelected(null)} />}
        right={<HeadButton label={m.close} onPress={onClose} strong />}
      >
        <TranscriptView call={selected} onDelete={() => deleteOne(selected)} />
      </SheetModal>
    );
  }

  return (
    <SheetModal
      visible={open}
      onClose={onClose}
      title={m.historyH}
      left={<HeadButton label={m.close} onPress={onClose} />}
      right={history.length ? <HeadButton label={m.deleteAll} onPress={clearAll} /> : undefined}
    >
      {history.length ? (
        history.map((c) => <CallCard key={c.id} call={c} onOpen={() => setSelected(c)} />)
      ) : (
        <Empty />
      )}
      <LocalNote />
    </SheetModal>
  );
}

function CallCard({ call, onOpen }: { call: CallRecord; onOpen(): void }) {
  const m = useMobileCopy();
  const lang = useSpoken((s) => s.lang);
  const { C } = useTheme();
  const styles = useStyles();
  const tint = call.ok ? C.ok : C.fail;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={[styles.badge, { backgroundColor: tint.bg }]}>
          <Icon name={call.ok ? "check" : "x"} color={tint.fg} size={18} strokeWidth={2.2} />
        </View>
        <View style={styles.grow}>
          <T size={16} weight="semibold" numberOfLines={1}>
            {call.contact}
          </T>
          <Text style={styles.when}>
            {formatWhen(call.at, lang)}
            {call.number ? ` · ${call.number}` : ""}
          </Text>
        </View>
        {call.scripted ? (
          <View style={styles.tag}>
            <Text style={styles.tagText}>{m.demoTag}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.outcomeRow}>
        <Text style={[styles.outcome, { color: tint.fg }]}>{call.ok ? m.done2 : m.notDone}</Text>
        <T size={14.5} color={C.muted} numberOfLines={2} style={styles.grow}>
          {call.title}
        </T>
      </View>
      <Btn kind="ghost" block label={m.viewTranscript} icon={<Icon name="bubble" color={C.ink} size={17} />} onPress={onOpen} />
    </View>
  );
}

/** One call: title, date, the result rows, then every line of the conversation. */
function TranscriptView({ call, onDelete }: { call: CallRecord; onDelete(): void }) {
  const t = useCopy();
  const m = useMobileCopy();
  const lang = useSpoken((s) => s.lang);
  const { C } = useTheme();
  const styles = useStyles();
  const speechLang = useSpeechLang();
  return (
    <>
      <View>
        <T size={26} weight="semibold" accessibilityRole="header" maxFontSizeMultiplier={1.4}>
          {call.contact}
        </T>
        <Text style={styles.when}>
          {formatWhen(call.at, lang)}
          {call.number ? ` · ${call.number}` : ""}
          {call.scripted ? ` · ${m.demoTag}` : ""}
        </Text>
      </View>

      <View style={styles.result}>
        <T size={16} weight="semibold">
          {call.title}
        </T>
        {call.rows.map(([k, v]) => (
          <View key={k} style={styles.dl}>
            <T size={14} color={C.muted}>
              {k}
            </T>
            <T size={14} weight="medium" style={styles.dd}>
              {v}
            </T>
          </View>
        ))}
      </View>

      <View style={styles.lines} accessibilityRole="list">
        {call.lines.map((l, i) => {
          if (l.who === "sys") {
            return (
              <Text key={i} style={styles.sys}>
                {l.text}
              </Text>
            );
          }
          const right = l.who !== "them";
          const who = l.who === "ai" ? m.aiLabel : l.who === "you" ? m.youLabel : call.contact;
          return (
            <View
              key={i}
              style={[styles.msg, right ? styles.right : styles.left]}
              accessible
              accessibilityLabel={`${who}: ${l.text}`}
              accessibilityLanguage={speechLang}
            >
              <Text style={styles.who}>{who}</Text>
              <View style={[styles.bubble, l.who === "ai" ? styles.ai : l.who === "you" ? styles.you : styles.them]}>
                <Text style={[styles.lineText, l.who === "ai" && { color: C.inv }, l.who === "you" && { color: C.muted, fontSize: 14 }]}>{l.text}</Text>
              </View>
            </View>
          );
        })}
        {call.lines.length ? null : <Text style={styles.sys}>{t.ended}</Text>}
      </View>

      <Pressable accessibilityRole="button" onPress={onDelete} style={styles.deleteRow}>
        <Icon name="trash" color={C.danger} size={18} />
        <Text style={styles.deleteText}>{m.deleteCall}</Text>
      </Pressable>
      <LocalNote />
    </>
  );
}

function Empty() {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIc, { backgroundColor: C.accentSoft }]}>
        <Icon name="history" color={C.accent} size={26} />
      </View>
      <T size={18} weight="semibold">
        {m.historyNone}
      </T>
      <T size={14.5} color={C.muted} style={styles.center}>
        {m.historyEmpty}
      </T>
    </View>
  );
}

function LocalNote() {
  const m = useMobileCopy();
  const styles = useStyles();
  return <Text style={styles.local}>{m.historyLocal}</Text>;
}

/** "3 calls, saved on this phone" for the Profile row. */
export function historyCount(n: number, m: ReturnType<typeof useMobileCopy>): string {
  if (!n) return m.historyNone;
  return n === 1 ? m.historyOne : fill(m.historyCount, { n: String(n) });
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  center: { textAlign: "center" },
  card: { gap: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, boxShadow: C.lift },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  badge: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  when: { ...small(13), color: C.dim, marginTop: 2 },
  tag: { paddingHorizontal: 9, paddingVertical: 3, minHeight: 24, borderRadius: 999, justifyContent: "center", backgroundColor: C.surface2 },
  tagText: { fontFamily: F.medium, fontSize: 12, color: C.muted },
  outcomeRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  outcome: { fontFamily: F.semibold, fontSize: 13, marginTop: 1.5 },
  result: { gap: 2, padding: 14, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line },
  dl: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: C.line },
  dd: { textAlign: "right", flexShrink: 1 },
  lines: { gap: 12, marginTop: 4 },
  sys: { ...small(12.5), color: C.dim, textAlign: "center", paddingVertical: 2 },
  msg: { maxWidth: "88%", gap: 4 },
  left: { alignSelf: "flex-start" },
  right: { alignSelf: "flex-end", alignItems: "flex-end" },
  who: { ...small(12.5), color: C.dim, paddingHorizontal: 2 },
  bubble: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 16 },
  them: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderBottomLeftRadius: 6 },
  ai: { backgroundColor: C.ink, borderBottomRightRadius: 6 },
  you: { borderWidth: 1, borderColor: C.line2, borderBottomRightRadius: 6 },
  lineText: { fontFamily: F.regular, fontSize: 16, lineHeight: 22, letterSpacing: em(-0.006, 16), color: C.ink },
  deleteRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48, marginTop: 8 },
  deleteText: { fontFamily: F.medium, fontSize: 15, color: C.danger },
  empty: { alignItems: "center", gap: 8, paddingVertical: 40, paddingHorizontal: 16 },
  emptyIc: { width: 56, height: 56, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  local: { ...small(12.5), color: C.dim, textAlign: "center", marginTop: 6 },
}));
