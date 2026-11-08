import { useEffect, useState, useSyncExternalStore } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { em, F, makeStyles, PAD, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";
import { Btn, Press, T } from "./ui";

// Planning questions as a bottom sheet: one question at a time, tap an option or type an answer.
// real-call.ts calls askQuestions() and awaits the answers; the sheet is mounted once in Home.
// Same module as web/src/components/QuestionSheet.tsx.
export interface PlanQuestion { id: string; text: string; options?: string[] }
interface Pending { questions: PlanQuestion[]; resolve: (answers: string[] | null) => void }

let pending: Pending | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Resolves with one answer per question, or null if the user skips the questions. */
export function askQuestions(questions: PlanQuestion[]): Promise<string[] | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { questions, resolve };
    emit();
  });
}

function finish(answers: string[] | null) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(answers);
}

const COPY = {
  no: { step: (i: number, n: number) => `Spørsmål ${i} av ${n}`, own: "Skriv svar", ph: "Skriv ditt eget svar", ok: "Neste", send: "Ferdig", back: "Tilbake", skip: "Hopp over" },
  en: { step: (i: number, n: number) => `Question ${i} of ${n}`, own: "Type an answer", ph: "Type your own answer", ok: "Next", send: "Done", back: "Back", skip: "Skip" },
} as const;

export function QuestionSheet() {
  const p = useSyncExternalStore(subscribe, () => pending, () => null);
  const lang = useSpoken((s) => s.lang);
  const t = COPY[lang === "en" ? "en" : "no"];
  const { C, scheme } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [text, setText] = useState("");

  useEffect(() => { setStep(0); setAnswers([]); setText(""); }, [p]);

  const qs = p?.questions ?? [];
  const q = qs[step];
  const last = step >= qs.length - 1;

  function pick(value: string) {
    const v = value.trim();
    if (!v || !p) return;
    const next = [...answers.slice(0, step), v];
    setText("");
    if (last) finish(next);
    else { setAnswers(next); setStep(step + 1); }
  }

  return (
    <Modal visible={!!p} transparent animationType="slide" onRequestClose={() => finish(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.wrap}>
        <Pressable style={styles.scrim} onPress={() => finish(null)} accessibilityLabel={t.skip} accessibilityRole="button" />
        <View style={[styles.sheet, { paddingBottom: 18 + insets.bottom }]} accessibilityViewIsModal>
          {q ? (
            <>
              <View style={styles.top}>
                <Press onPress={() => setStep(Math.max(0, step - 1))} disabled={step === 0} accessibilityRole="button" accessibilityLabel={t.back} style={[styles.link, step === 0 && { opacity: 0.35 }]}>
                  <T size={15} color={C.muted}>‹ {t.back}</T>
                </Press>
                <View style={styles.dots} accessible accessibilityLabel={t.step(step + 1, qs.length)}>
                  {qs.map((_, i) => <View key={i} style={[styles.dot, i <= step && { backgroundColor: C.accent }]} />)}
                </View>
                <Press onPress={() => finish(null)} accessibilityRole="button" accessibilityLabel={t.skip} style={styles.link}>
                  <T size={15} color={C.muted}>{t.skip}</T>
                </Press>
              </View>
              <Text style={styles.h3} accessibilityRole="header" accessibilityLiveRegion="polite">{q.text}</Text>
              <View style={styles.opts}>
                {q.options?.map((o) => (
                  <Btn key={o} kind="ghost" label={o} onPress={() => pick(o)} pressed={answers[step] === o} style={styles.opt} />
                ))}
              </View>
              <View style={styles.own}>
                <TextInput
                  accessibilityLabel={t.own}
                  placeholder={t.ph}
                  placeholderTextColor={C.dim}
                  selectionColor={C.accent}
                  keyboardAppearance={scheme}
                  value={text}
                  onChangeText={setText}
                  onSubmitEditing={() => pick(text)}
                  returnKeyType={last ? "done" : "next"}
                  style={styles.input}
                />
                <Btn label={last ? t.send : t.ok} disabled={!text.trim()} onPress={() => pick(text)} />
              </View>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((C) => ({
  wrap: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 } as const), backgroundColor: C.scrim },
  sheet: {
    backgroundColor: C.surface,
    borderTopWidth: 1,
    borderTopColor: C.accent,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 12,
    paddingHorizontal: PAD,
    gap: 14,
  },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: 4 },
  dots: { flexDirection: "row", gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.line2 },
  h3: { fontFamily: F.semibold, fontSize: 27, lineHeight: 31, letterSpacing: em(-0.02, 27), color: C.ink },
  opts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  opt: { flexBasis: "48%", flexGrow: 1, minHeight: 52 },
  own: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 48, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.app, color: C.ink, fontFamily: F.regular, fontSize: 16 },
}));
