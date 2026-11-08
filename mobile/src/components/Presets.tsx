import { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { BUILT_IN_KEYS, resolvePreset, toRequest, type Preset } from "../lib/presets";
import { em, F, HEADING_SCALE, makeStyles, PAD, useTheme } from "../lib/theme";
import { useCopy, useMobileCopy, useSpoken, useStore } from "../lib/use-spoken";
import { Glow, useTint } from "./Art";
import { HeroDuet } from "./drawings/Hero";
import { hasPresetArt, PresetArt } from "./drawings/PresetArt";
import { Icon } from "./Icon";
import { List, Row } from "./List";
import { PresetEditor, UsePresetSheet } from "./PresetSheets";
import { Press, T } from "./ui";

/** With more presets than this, the grid shows these first and a Show more button. */
const FOLD_AT = 4;

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
  // Long lists fold to the first few; edit mode always shows them all.
  const [expanded, setExpanded] = useState(false);
  const folds = presets.length > FOLD_AT && !editing;
  const shown = folds && !expanded ? presets.slice(0, FOLD_AT) : presets;
  const [using, setUsing] = useState<Preset | null>(null);
  // undefined = editor closed, null = new preset, Preset = editing that one.
  const [editorFor, setEditorFor] = useState<Preset | null | undefined>(undefined);

  const open = (p: Preset) => {
    if (editing) return setEditorFor(p);
    // Nothing to fill in: send it straight away.
    if (!p.fields.length) return store.runPreset(toRequest(p, {}));
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
          <Text style={styles.h} accessibilityRole="header" maxFontSizeMultiplier={HEADING_SCALE}>
            {m.presetsH}
          </Text>
          <Press
            accessibilityLabel={editing ? m.done : m.edit}
            accessibilityState={{ selected: editing }}
            onPress={() => setEditing((e) => !e)}
            hitSlop={8}
            scale={0.9}
            style={[styles.editBtn, editing && styles.editBtnOn]}
          >
            <Icon name={editing ? "check" : "pencil"} color={editing ? C.inv : C.ink} size={18} strokeWidth={editing ? 2.4 : 1.8} />
          </Press>
        </View>

        {presets.length === 0 ? (
          <View style={styles.empty}>
            <HeroDuet width={170} />
            <Text style={styles.emptyText}>{m.noPresets}</Text>
            <Pressable accessibilityRole="button" onPress={() => store.restorePresets()} style={styles.more}>
              <Icon name="replay" color={C.accent} size={16} />
              <Text style={styles.moreText}>{m.restore}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.grid}>
          {shown.map((p) => (
            <Animated.View key={p.id} layout={LinearTransition.duration(250)} exiting={FadeOut.duration(180)} style={styles.cell}>
              <PresetCard preset={p} editing={editing} onPress={() => open(p)} onEdit={() => setEditorFor(p)} onDelete={() => confirmDelete(p)} />
            </Animated.View>
          ))}
          <Animated.View layout={LinearTransition.duration(250)} style={styles.cell}>
            <Press onPress={() => setEditorFor(null)} accessibilityLabel={m.newPreset} style={[styles.card, styles.newCard]}>
              <View style={[styles.badge, styles.newBadge]}>
                <Icon name="plus" color={C.accent} size={22} />
              </View>
              <T size={16} weight="semibold" color={C.ink} style={styles.cardTitle}>
                {m.newPreset}
              </T>
            </Press>
          </Animated.View>
        </View>

        {folds ? (
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((x) => !x)} style={styles.more}>
            <Text style={styles.moreText}>{expanded ? m.showLess : m.showMore}</Text>
            <View style={{ transform: [{ rotate: expanded ? "-90deg" : "90deg" }] }}>
              <Icon name="chevron" color={C.accent} size={16} />
            </View>
          </Pressable>
        ) : null}

        {editing && missingBuiltIn ? (
          <Pressable accessibilityRole="button" onPress={() => store.restorePresets()} style={styles.restore}>
            <Icon name="replay" color={C.accent} size={16} />
            <Text style={styles.restoreText}>{m.restore}</Text>
          </Pressable>
        ) : null}

        <Text style={styles.section} accessibilityRole="header" maxFontSizeMultiplier={HEADING_SCALE}>{m.demoH}</Text>
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
              art={<PresetArt icon={r.key} size={24} />}
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

/** One preset: its own colour tint, a soft glow in that colour, title and who it calls. */
function PresetCard({
  preset: p,
  editing,
  onPress,
  onEdit,
  onDelete,
}: {
  preset: Preset;
  editing: boolean;
  onPress(): void;
  onEdit(): void;
  onDelete(): void;
}) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const tint = useTint(p.icon);
  return (
    <>
      <Press
        onPress={onPress}
        accessibilityLabel={`${editing ? `${m.editPreset}: ` : ""}${p.title}, ${p.contactName || m.noContact}`}
        // Screen-reader and switch users edit or delete from here, without edit mode's small badges.
        accessibilityActions={[
          { name: "edit", label: m.editPreset },
          { name: "delete", label: m.deletePreset },
        ]}
        onAccessibilityAction={(e) => (e.nativeEvent.actionName === "edit" ? onEdit() : onDelete())}
        style={[styles.card, editing && styles.cardEditing]}
      >
        {editing ? null : <Glow color={tint.fg} opacity={C.glow * 0.7} cx={0} cy={0} r={0.85} />}
        <View style={styles.cardTop}>
          {hasPresetArt(p.icon) ? (
            <PresetArt icon={p.icon} tint={tint} size={58} />
          ) : (
            <View style={[styles.badge, { backgroundColor: tint.bg }]}>
              <Icon name={p.icon} color={tint.fg} size={22} />
            </View>
          )}
          {editing ? <Icon name="pencil" color={C.dim} size={16} /> : null}
        </View>
        <View style={styles.cardText}>
          <T size={16} weight="semibold" style={styles.cardTitle}>
            {p.title}
          </T>
          <T size={13} color={C.muted}>
            {p.contactName || m.noContact}
          </T>
        </View>
      </Press>
      {editing ? (
        <Animated.View entering={FadeIn.duration(150)} style={styles.deleteWrap}>
          <Press accessibilityLabel={`${m.deletePreset}: ${p.title}`} onPress={onDelete} hitSlop={8} scale={0.9} style={styles.delete}>
            <Icon name="trash" color="#fff" size={15} strokeWidth={2} />
          </Press>
        </Animated.View>
      ) : null}
    </>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  body: { paddingHorizontal: PAD, paddingTop: 18, paddingBottom: 32 },
  headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 6, marginBottom: 16 },
  h: { fontFamily: F.semibold, fontSize: 28, lineHeight: 32, letterSpacing: em(-0.022, 28), color: C.ink },
  empty: { alignItems: "center", gap: 12, paddingVertical: 20, marginBottom: 8 },
  emptyText: { fontFamily: F.medium, fontSize: 15, color: C.muted, textAlign: "center" },
  editBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.surface2, alignItems: "center", justifyContent: "center" },
  editBtnOn: { backgroundColor: C.accent },
  more: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "center", marginTop: 14, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999, backgroundColor: C.accentSoft },
  moreText: { fontFamily: F.medium, fontSize: 14, color: C.accent },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  // Two columns; a card alone on its row stays half width.
  cell: { flexBasis: "45%", flexGrow: 1, maxWidth: "50%" },
  card: {
    minHeight: 132,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    justifyContent: "space-between",
    gap: 14,
    overflow: "hidden",
    boxShadow: C.lift,
  },
  cardEditing: { borderColor: C.line2, borderStyle: "dashed", boxShadow: "none" },
  cardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  cardText: { gap: 2 },
  cardTitle: { lineHeight: 20 },
  badge: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.accentSoft },
  newCard: { backgroundColor: "transparent", borderStyle: "dashed", borderColor: C.line2, boxShadow: "none" },
  newBadge: { backgroundColor: C.accentSoft },
  deleteWrap: { position: "absolute", top: -8, right: -8 },
  delete: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.danger, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: C.app },
  restore: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start", marginTop: 16, paddingVertical: 6 },
  restoreText: { fontFamily: F.medium, fontSize: 14, color: C.accent },
  section: { fontFamily: F.semibold, fontSize: 17, letterSpacing: em(-0.01, 17), color: C.ink, marginTop: 34, marginBottom: 12 },
}));
