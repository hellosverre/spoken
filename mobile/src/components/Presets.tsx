import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { BUILT_IN_KEYS, resolvePreset, type Preset } from "../lib/presets";
import { em, F, makeStyles, PAD, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { List, Row } from "./List";
import { PresetEditor, UsePresetSheet } from "./PresetSheets";
import { Press, T } from "./ui";

/**
 * The Home tab (the web's Demo tab): presets for calls you make often, plus the
 * scripted demos. Tap a preset to use it; Edit to change or delete them.
 */
export function Presets() {
  const store = useStore();
  const t = useCopy();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const lang = useSpoken((s) => s.lang);
  const stored = useSpoken((s) => s.presets);
  const presets = useMemo(() => stored.map((p) => resolvePreset(p, lang)), [stored, lang]);
  const missingBuiltIn = BUILT_IN_KEYS.some((k) => !stored.some((p) => p.builtIn === k));

  const [editing, setEditing] = useState(false);
  const [using, setUsing] = useState<Preset | null>(null);
  // undefined = editor closed, null = new preset, Preset = editing that one.
  const [editorFor, setEditorFor] = useState<Preset | null | undefined>(undefined);

  const open = (p: Preset) => {
    if (editing) return setEditorFor(p);
    // Nothing to fill in: send it straight away.
    if (!p.fields.length) return store.runPreset({ presetId: p.id, text: p.template, contact: null });
    setUsing(p);
  };

  const confirmDelete = (p: Preset) =>
    Alert.alert(m.deleteQ, `${p.title}\n${m.deleteBody}`, [
      { text: m.cancel, style: "cancel" },
      { text: m.deletePreset, style: "destructive", onPress: () => store.deletePreset(p.id) },
    ]);

  return (
    <>
      <ScrollView style={styles.grow} contentContainerStyle={styles.body}>
        <View style={styles.headRow}>
          <Text style={styles.h} accessibilityRole="header">
            {m.presetsH}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: editing }}
            onPress={() => setEditing((e) => !e)}
            hitSlop={10}
            style={[styles.editBtn, editing && styles.editBtnOn]}
          >
            <Text style={[styles.editText, editing && { color: C.inv }]}>{editing ? m.done : m.edit}</Text>
          </Pressable>
        </View>
        <Text style={styles.lede}>{m.presetsSub}</Text>

        <View style={styles.grid}>
          {presets.map((p) => (
            <Animated.View key={p.id} layout={LinearTransition.duration(250)} exiting={FadeOut.duration(180)} style={styles.cell}>
              <Press
                onPress={() => open(p)}
                accessibilityLabel={editing ? `${m.editPreset}: ${p.title}` : p.title}
                accessibilityHint={p.contactName || undefined}
                style={[styles.card, editing && styles.cardEditing]}
              >
                <View style={styles.cardTop}>
                  <View style={styles.badge}>
                    <Icon name={p.icon} color={C.accent} size={20} />
                  </View>
                  {editing ? <Icon name="pencil" color={C.dim} size={16} /> : null}
                </View>
                <View>
                  <T size={15} weight="medium" numberOfLines={2}>
                    {p.title}
                  </T>
                  <T size={13} color={C.dim} numberOfLines={1}>
                    {p.contactName || m.noContact}
                  </T>
                </View>
              </Press>
              {editing ? (
                <Animated.View entering={FadeIn.duration(150)} style={styles.deleteWrap}>
                  <Press accessibilityLabel={`${m.deletePreset}: ${p.title}`} onPress={() => confirmDelete(p)} scale={0.9} style={styles.delete}>
                    <Icon name="trash" color="#fff" size={15} strokeWidth={2} />
                  </Press>
                </Animated.View>
              ) : null}
            </Animated.View>
          ))}
          <Animated.View layout={LinearTransition.duration(250)} style={styles.cell}>
            <Press onPress={() => setEditorFor(null)} accessibilityLabel={m.newPreset} style={[styles.card, styles.newCard]}>
              <View style={[styles.badge, styles.newBadge]}>
                <Icon name="plus" color={C.muted} size={20} />
              </View>
              <T size={15} weight="medium" color={C.muted}>
                {m.newPreset}
              </T>
            </Press>
          </Animated.View>
        </View>

        {editing && missingBuiltIn ? (
          <Pressable accessibilityRole="button" onPress={() => store.restorePresets()} style={styles.restore}>
            <Icon name="replay" color={C.accent} size={16} />
            <Text style={styles.restoreText}>{m.restore}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.section}>{m.demoH}</Text>
        <List>
          {(
            [
              { key: "pizza", title: t.sugPizza, sub: t.sugPizzaSub },
              { key: "doctor", title: t.sugDoctor, sub: t.sugDoctorSub },
            ] as const
          ).map((r, i) => (
            <Row
              key={r.key}
              first={i === 0}
              title={r.title}
              sub={r.sub}
              icon={r.key}
              go={<Icon name="play" color={C.dim} size={12} filled />}
              onPress={() => store.playDemo(r.key)}
            />
          ))}
        </List>
      </ScrollView>

      <UsePresetSheet
        preset={using}
        onClose={() => setUsing(null)}
        onSend={(req) => {
          setUsing(null);
          store.runPreset(req);
        }}
        onEdit={(p) => {
          setUsing(null);
          // Let the first sheet close before the editor opens.
          setTimeout(() => setEditorFor(p), 350);
        }}
      />
      <PresetEditor open={editorFor !== undefined} preset={editorFor ?? null} onClose={() => setEditorFor(undefined)} />
    </>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  body: { paddingHorizontal: PAD, paddingTop: 20, paddingBottom: 24 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6, marginBottom: 8 },
  h: { fontFamily: F.semibold, fontSize: 28, lineHeight: 31, letterSpacing: em(-0.02, 28), color: C.ink },
  editBtn: { height: 34, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: C.line2, justifyContent: "center" },
  editBtnOn: { backgroundColor: C.ink, borderColor: C.ink },
  editText: { fontFamily: F.medium, fontSize: 14, color: C.ink },
  lede: { fontFamily: F.regular, fontSize: 15, lineHeight: 22, color: C.muted, marginBottom: 20 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  // Two columns; a card alone on its row stays half width.
  cell: { flexBasis: "45%", flexGrow: 1, maxWidth: "50%" },
  card: { minHeight: 118, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, justifyContent: "space-between", gap: 12 },
  cardEditing: { borderColor: C.line2, borderStyle: "dashed" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  badge: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.surface2 },
  newCard: { backgroundColor: "transparent", borderStyle: "dashed", borderColor: C.line2 },
  newBadge: { backgroundColor: "transparent", borderWidth: 1, borderColor: C.line2 },
  deleteWrap: { position: "absolute", top: -8, right: -8 },
  delete: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.app },
  restore: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", marginTop: 16, paddingVertical: 6 },
  restoreText: { fontFamily: F.medium, fontSize: 14, color: C.accent },
  section: { fontFamily: F.semibold, fontSize: 15, color: C.ink, marginTop: 30, marginBottom: 10, marginLeft: 2 },
}));
