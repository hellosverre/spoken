import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sendFeedback } from "../lib/real-call";
import { F, makeStyles, PAD, useLargeText, useTheme } from "../lib/theme";
import { useMobileCopy } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { Btn, T } from "./ui";

type Rating = "up" | "down";

/**
 * "Did it go well?" under the call result. A tap on a thumb is sent at once (so a rating
 * is never lost if the sheet is closed), then an optional note can follow.
 */
export function CallFeedback() {
  const m = useMobileCopy();
  const { C, scheme } = useTheme();
  const styles = useStyles();
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const stack = useLargeText();

  function rate(r: Rating) {
    if (busy) return;
    setRating(r);
    setFailed(false);
    // A failed rating is not worth interrupting the user; the note still carries it.
    sendFeedback({ source: "call", rating: r }).catch(() => {});
  }

  async function submit() {
    if (!rating || busy) return;
    const text = comment.trim();
    if (!text) return setDone(true);
    setBusy(true);
    try {
      await sendFeedback({ source: "call", rating, comment: text });
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <View style={styles.thanks} accessibilityRole="alert">
        <Icon name="check" color={C.accent} size={18} />
        <T size={14} color={C.muted}>
          {m.fbThanks}
        </T>
      </View>
    );
  }

  return (
    <View style={styles.fb}>
      <View style={[styles.ask, stack && styles.askStack]}>
        <T size={14} weight="medium">
          {m.fbAsk}
        </T>
        <View style={styles.thumbs}>
          {(["up", "down"] as const).map((r) => {
            const on = rating === r;
            return (
              <Pressable
                key={r}
                accessibilityRole="button"
                accessibilityLabel={r === "up" ? m.fbUp : m.fbDown}
                accessibilityState={{ selected: on }}
                onPress={() => rate(r)}
                style={[styles.thumb, on && { backgroundColor: C.accentSoft, borderColor: C.accent }]}
              >
                <Icon name={r === "up" ? "thumbUp" : "thumbDown"} color={on ? C.accent : C.muted} size={20} />
              </Pressable>
            );
          })}
        </View>
      </View>
      {rating ? (
        <>
          <View style={[styles.send, stack && styles.sendStack]}>
            <TextInput
              accessibilityLabel={m.fbCommentPh}
              placeholder={m.fbCommentPh}
              placeholderTextColor={C.dim}
              selectionColor={C.accent}
              cursorColor={C.accent}
              keyboardAppearance={scheme}
              maxLength={1000}
              value={comment}
              onChangeText={setComment}
              style={styles.input}
            />
            <Btn label={m.fbSend} disabled={busy} onPress={submit} />
          </View>
          {failed ? (
            <T size={14} color={C.danger}>
              {m.fbFail}
            </T>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** Profile → "Send feedback": a short note in a native page sheet. */
export function FeedbackSheet({ onClose }: { onClose(): void }) {
  const m = useMobileCopy();
  const { C, scheme } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const ready = text.trim().length > 0;

  async function submit() {
    if (!ready || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await sendFeedback({ source: "profile", comment: text.trim() });
      setDone(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const headBtn = (label: string, onPress: () => void, strong?: boolean): ReactNode => (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10} style={styles.headHit}>
      <Text style={[styles.headBtn, strong && styles.headBtnStrong]}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "android" ? "height" : undefined} style={styles.modal}>
        <View style={[styles.head, Platform.OS === "android" && { paddingTop: insets.top + 8 }]}>
          <View style={styles.headSide}>{headBtn(m.cancel, onClose)}</View>
          <Text style={styles.headTitle} accessibilityRole="header" numberOfLines={1}>
            {m.fbH}
          </Text>
          <View style={[styles.headSide, styles.headRight]}>{done ? headBtn(m.done, onClose, true) : headBtn(busy ? "…" : m.fbSend, submit, true)}</View>
        </View>
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {done ? (
            <View style={styles.thanks} accessibilityRole="alert">
              <Icon name="check" color={C.accent} size={18} />
              <T size={14} color={C.muted}>
                {m.fbThanks}
              </T>
            </View>
          ) : (
            <>
              <TextInput
                autoFocus
                multiline
                accessibilityLabel={m.fbH}
                placeholder={m.fbPh}
                placeholderTextColor={C.dim}
                selectionColor={C.accent}
                cursorColor={C.accent}
                keyboardAppearance={scheme}
                maxLength={1000}
                value={text}
                onChangeText={setText}
                textAlignVertical="top"
                style={[styles.input, styles.multi, failed && { borderColor: C.danger }]}
              />
              <T size={13} color={C.dim}>
                {m.fbHelp}
              </T>
              {failed ? (
                <T size={14} color={C.danger}>
                  {m.fbFail}
                </T>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((C) => ({
  fb: { gap: 10, borderTopWidth: 1, borderTopColor: C.line },
  ask: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 12 },
  askStack: { flexDirection: "column", alignItems: "flex-start" },
  thumbs: { flexDirection: "row", gap: 8 },
  thumb: { width: 48, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: C.line2, alignItems: "center", justifyContent: "center" },
  send: { flexDirection: "row", gap: 8, alignItems: "center" },
  sendStack: { flexDirection: "column", alignItems: "stretch" },
  input: { flex: 1, minHeight: 44, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, fontFamily: F.regular, fontSize: 16, color: C.ink },
  multi: { flex: 0, minHeight: 120, paddingTop: 12, paddingBottom: 12 },
  thanks: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 12 },
  modal: { flex: 1, backgroundColor: C.app },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  headSide: { width: 80 },
  headRight: { alignItems: "flex-end" },
  headHit: { minHeight: 44, justifyContent: "center" },
  headTitle: { flex: 1, textAlign: "center", fontFamily: F.semibold, fontSize: 16, color: C.ink },
  headBtn: { fontFamily: F.regular, fontSize: 16, color: C.accent },
  headBtnStrong: { fontFamily: F.semibold },
  body: { paddingHorizontal: PAD, paddingTop: 20, gap: 16 },
}));
