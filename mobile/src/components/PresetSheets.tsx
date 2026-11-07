import { useEffect, useState, type ReactNode } from "react";
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  emptyContent,
  fillTemplate,
  newId,
  PRESET_ICONS,
  toRequest,
  token,
  type Preset,
  type PresetContent,
  type PresetField,
  type PresetRequest,
} from "../lib/presets";
import { em, F, makeStyles, PAD, small, useTheme } from "../lib/theme";
import { useMobileCopy, useStore } from "../lib/use-spoken";
import { Icon } from "./Icon";
import { Btn, Field, Press, T } from "./ui";

/** A native page sheet (swipe down on iOS) with a header: left action, title, right action. */
function SheetModal({
  visible,
  onClose,
  title,
  left,
  right,
  children,
}: {
  visible: boolean;
  onClose(): void;
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "android" ? "height" : undefined} style={styles.modal}>
        <View style={[styles.head, Platform.OS === "android" && { paddingTop: insets.top + 8 }]}>
          <View style={styles.headSide}>{left}</View>
          <Text style={styles.headTitle} accessibilityRole="header" numberOfLines={1}>
            {title}
          </Text>
          <View style={[styles.headSide, styles.headRight]}>{right}</View>
        </View>
        <ScrollView
          contentContainerStyle={[styles.sheetBody, { paddingBottom: 24 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function HeadButton({ label, onPress, strong }: { label: string; onPress(): void; strong?: boolean }) {
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10}>
      <Text style={[styles.headBtn, strong && styles.headBtnStrong]}>{label}</Text>
    </Pressable>
  );
}

function PresetBadge({ preset, size = 44 }: { preset: Pick<PresetContent, "icon">; size?: number }) {
  const { C } = useTheme();
  const styles = useStyles();
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Icon name={preset.icon} color={C.accent} size={size * 0.48} />
    </View>
  );
}

/* ---------- use a preset ---------- */

/** Fill in a preset's fields, see what Spoken will be asked, and send it. */
export function UsePresetSheet({
  preset,
  onClose,
  onSend,
  onEdit,
}: {
  preset: Preset | null;
  onClose(): void;
  onSend(req: PresetRequest): void;
  onEdit(p: Preset): void;
}) {
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [values, setValues] = useState<Record<string, string>>({});

  // Start from the preset's usual values each time it opens.
  useEffect(() => {
    if (preset) setValues(Object.fromEntries(preset.fields.map((f) => [f.id, f.value])));
  }, [preset]);

  if (!preset) return null;
  const req = toRequest(preset, values);

  return (
    <SheetModal visible onClose={onClose} title="" left={<HeadButton label={m.cancel} onPress={onClose} />}>
      <View style={styles.useHead}>
        <PresetBadge preset={preset} size={52} />
        <View style={styles.grow}>
          <T size={22} weight="semibold">
            {preset.title}
          </T>
          <T size={14} color={C.muted}>
            {req.contact ? [req.contact.name, req.contact.phone].filter(Boolean).join(" · ") : m.noContact}
          </T>
        </View>
      </View>

      {preset.fields.map((f, i) => (
        <Field
          key={f.id}
          label={f.label}
          value={values[f.id] ?? ""}
          placeholder={f.value}
          onChangeText={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
          autoFocus={i === 0 && !f.value}
          returnKeyType={i === preset.fields.length - 1 ? "send" : "next"}
          onSubmitEditing={i === preset.fields.length - 1 && req.text ? () => onSend(req) : undefined}
        />
      ))}

      <View style={styles.preview}>
        <Text style={styles.previewLabel}>{m.usePreview}</Text>
        <T size={16} style={styles.previewText}>
          {req.text || "…"}
        </T>
      </View>

      <View style={styles.actions}>
        <Btn block label={m.useSend} icon={<Icon name="send" color={C.inv} />} disabled={!req.text} onPress={() => onSend(req)} style={styles.tall} />
        <Btn kind="ghost" block label={m.editPreset} icon={<Icon name="pencil" color={C.ink} size={18} />} onPress={() => onEdit(preset)} />
      </View>
    </SheetModal>
  );
}

/* ---------- create / edit ---------- */

/**
 * Create a preset or change one. `preset` null = new. Built-ins can be edited too;
 * they then keep their own text instead of following the app language.
 */
export function PresetEditor({ open, preset, onClose }: { open: boolean; preset: Preset | null; onClose(): void }) {
  const store = useStore();
  const m = useMobileCopy();
  const { C } = useTheme();
  const styles = useStyles();
  const [draft, setDraft] = useState<PresetContent>(emptyContent);
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(preset ? { ...preset, fields: preset.fields.map((f) => ({ ...f })) } : emptyContent());
    setSel(null);
    setInvalid(false);
  }, [open, preset]);

  const patch = (p: Partial<PresetContent>) => {
    setDraft((d) => ({ ...d, ...p }));
    setInvalid(false);
  };

  const setField = (id: string, p: Partial<PresetField>) =>
    setDraft((d) => {
      const old = d.fields.find((f) => f.id === id);
      const fields = d.fields.map((f) => (f.id === id ? { ...f, ...p } : f));
      // Renaming a field renames its {token} in the text too.
      let template = d.template;
      if (old && p.label !== undefined && old.label) template = template.split(token(old)).join(token({ ...old, label: p.label }));
      return { ...d, fields, template };
    });

  const addField = () => setDraft((d) => ({ ...d, fields: [...d.fields, { id: newId("field"), label: "", value: "" }] }));

  const removeField = (f: PresetField) =>
    setDraft((d) => ({
      ...d,
      fields: d.fields.filter((x) => x.id !== f.id),
      template: f.label ? d.template.split(token(f)).join("") : d.template,
    }));

  // Put {Label} where the cursor is in the text (or at the end).
  const insertToken = (f: PresetField) => {
    if (!f.label.trim()) return;
    const t = token(f);
    setDraft((d) => {
      const at = sel ? sel.start : d.template.length;
      const end = sel ? sel.end : at;
      const before = d.template.slice(0, at);
      const pad = before && !/\s$/.test(before) ? " " : "";
      return { ...d, template: `${before}${pad}${t}${d.template.slice(end)}` };
    });
    setSel(null);
  };

  const save = () => {
    const content: PresetContent = {
      ...draft,
      title: draft.title.trim(),
      contactName: draft.contactName.trim(),
      contactPhone: draft.contactPhone.trim(),
      template: draft.template.trim(),
      fields: draft.fields.filter((f) => f.label.trim()).map((f) => ({ ...f, label: f.label.trim() })),
    };
    if (!content.title || !content.template) return setInvalid(true);
    store.savePreset({ id: preset?.id ?? newId("preset"), builtIn: preset?.builtIn, content });
    onClose();
  };

  const remove = () => {
    if (!preset) return;
    Alert.alert(m.deleteQ, m.deleteBody, [
      { text: m.cancel, style: "cancel" },
      {
        text: m.deletePreset,
        style: "destructive",
        onPress: () => {
          store.deletePreset(preset.id);
          onClose();
        },
      },
    ]);
  };

  const preview = fillTemplate(draft);

  return (
    <SheetModal
      visible={open}
      onClose={onClose}
      title={preset ? m.editorEdit : m.editorNew}
      left={<HeadButton label={m.cancel} onPress={onClose} />}
      right={<HeadButton label={m.save} onPress={save} strong />}
    >
      <Field label={m.presetName} value={draft.title} placeholder={m.presetNamePh} onChangeText={(title) => patch({ title })} error={invalid && !draft.title.trim()} />

      <View style={styles.group}>
        <Text style={styles.groupLabel}>{m.iconL}</Text>
        <View style={styles.icons} accessibilityRole="radiogroup" accessibilityLabel={m.iconL}>
          {PRESET_ICONS.map((name) => {
            const on = draft.icon === name;
            return (
              <Press
                key={name}
                accessibilityRole="radio"
                accessibilityLabel={name}
                accessibilityState={{ checked: on }}
                onPress={() => patch({ icon: name })}
                style={[styles.iconOpt, on && styles.iconOn]}
              >
                <Icon name={name} color={on ? C.accent : C.muted} size={22} />
              </Press>
            );
          })}
        </View>
      </View>

      <Text style={styles.section}>{m.whoL}</Text>
      <Field label={m.contactName} value={draft.contactName} placeholder={m.contactNamePh} onChangeText={(contactName) => patch({ contactName })} />
      <View>
        <Field
          label={m.contactPhone}
          value={draft.contactPhone}
          placeholder="+47"
          keyboardType="phone-pad"
          onChangeText={(contactPhone) => patch({ contactPhone })}
        />
        <Text style={styles.help}>{m.contactPhoneHint}</Text>
      </View>

      <Text style={styles.section}>{m.fieldsL}</Text>
      <Text style={[styles.help, styles.helpTop]}>{m.fieldsS}</Text>
      {draft.fields.map((f) => (
        <View key={f.id} style={styles.fieldCard}>
          <View style={styles.fieldRow}>
            <View style={styles.grow}>
              <Field label={m.fieldLabel} value={f.label} placeholder={m.fieldLabelPh} onChangeText={(label) => setField(f.id, { label })} />
            </View>
            <Press accessibilityLabel={m.removeField} onPress={() => removeField(f)} style={styles.remove}>
              <Icon name="trash" color={C.danger} size={18} />
            </Press>
          </View>
          <Field label={m.fieldValue} value={f.value} placeholder={m.fieldValuePh} onChangeText={(value) => setField(f.id, { value })} />
        </View>
      ))}
      <Btn kind="ghost" block label={m.addField} icon={<Icon name="plus" color={C.ink} size={18} />} onPress={addField} />

      <Text style={styles.section}>{m.templateL}</Text>
      <Field
        label={m.templateL}
        value={draft.template}
        placeholder={m.templatePh}
        onChangeText={(template) => patch({ template })}
        onSelectionChange={(e) => setSel(e.nativeEvent.selection)}
        multiline
        error={invalid && !draft.template.trim()}
        style={styles.multiline}
      />
      {draft.fields.some((f) => f.label.trim()) ? (
        <>
          <Text style={styles.help}>{m.templateS}</Text>
          <View style={styles.tokens}>
            {draft.fields
              .filter((f) => f.label.trim())
              .map((f) => (
                <Press key={f.id} onPress={() => insertToken(f)} accessibilityLabel={token(f)} style={styles.tokenChip}>
                  <Icon name="plus" color={C.accent} size={14} />
                  <Text style={styles.tokenText}>{f.label}</Text>
                </Press>
              ))}
          </View>
        </>
      ) : null}

      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.previewLabel}>{m.preview}</Text>
          <T size={16} style={styles.previewText}>
            {preview}
          </T>
        </View>
      ) : null}

      {invalid ? (
        <Text style={styles.error} accessibilityRole="alert">
          {m.needName}
        </Text>
      ) : null}

      <Btn block label={m.save} onPress={save} style={styles.tall} />
      {preset ? (
        <Pressable accessibilityRole="button" onPress={remove} style={styles.deleteRow}>
          <Icon name="trash" color={C.danger} size={18} />
          <Text style={styles.deleteText}>{m.deletePreset}</Text>
        </Pressable>
      ) : null}
    </SheetModal>
  );
}

const useStyles = makeStyles((C) => ({
  grow: { flex: 1 },
  modal: { flex: 1, backgroundColor: C.app },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  headSide: { width: 80 },
  headRight: { alignItems: "flex-end" },
  headTitle: { flex: 1, textAlign: "center", fontFamily: F.semibold, fontSize: 16, color: C.ink },
  headBtn: { fontFamily: F.regular, fontSize: 16, color: C.accent },
  headBtnStrong: { fontFamily: F.semibold },
  sheetBody: { paddingHorizontal: PAD, paddingTop: 20, gap: 16 },
  badge: { alignItems: "center", justifyContent: "center", backgroundColor: C.surface2 },
  useHead: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 4 },
  preview: { borderLeftWidth: 2, borderLeftColor: C.accent, paddingLeft: 12, paddingVertical: 2, gap: 4 },
  previewLabel: { ...small(13), color: C.dim },
  previewText: { lineHeight: 23 },
  actions: { gap: 8, marginTop: 4 },
  tall: { height: 50 },
  group: { gap: 8 },
  groupLabel: { fontFamily: F.medium, fontSize: 13, color: C.muted },
  icons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  iconOpt: { width: 48, height: 48, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  iconOn: { borderColor: C.accent, backgroundColor: C.surface2 },
  section: { fontFamily: F.semibold, fontSize: 17, letterSpacing: em(-0.01, 17), color: C.ink, marginTop: 10, marginBottom: -6 },
  help: { ...small(12.5), color: C.dim, marginTop: 6 },
  helpTop: { marginTop: -4 },
  fieldCard: { gap: 10, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  fieldRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  remove: { width: 48, height: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.surface2 },
  multiline: { height: undefined, minHeight: 96, paddingTop: 12, paddingBottom: 12, textAlignVertical: "top", lineHeight: 22 },
  tokens: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tokenChip: { flexDirection: "row", alignItems: "center", gap: 4, height: 32, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: C.accent },
  tokenText: { fontFamily: F.medium, fontSize: 13, color: C.accent2 },
  error: { ...small(13.5), color: C.danger },
  deleteRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 48 },
  deleteText: { fontFamily: F.medium, fontSize: 15, color: C.danger },
}));
