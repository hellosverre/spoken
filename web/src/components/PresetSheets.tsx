"use client";

import { useRef, useState } from "react";
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
} from "@/lib/presets";
import { cx, useAppCopy, useStore } from "@/lib/use-spoken";
import { tintOf } from "./Art";
import { Icon } from "./Icon";
import { Confirm, Field, HeadButton, PageSheet } from "./ui";

/* ---------- use a preset ---------- */

/** Fill in a preset's fields, see what Spoken will be asked, and send it. */
export function UsePresetSheet({
  preset,
  onClose,
  onSend,
  onEdit,
}: {
  preset: Preset;
  onClose(): void;
  onSend(req: PresetRequest): void;
  onEdit(p: Preset): void;
}) {
  const m = useAppCopy();
  // Start from the preset's usual values each time it opens (the parent remounts it per preset).
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(preset.fields.map((f) => [f.id, f.value])));
  const req = toRequest(preset, values);

  return (
    <PageSheet title="" onClose={onClose} left={<HeadButton label={m.cancel} onClick={onClose} />}>
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (req.text) onSend(req);
        }}
      >
        <div className="use-head">
          <span className="pbadge big" data-tint={tintOf(preset.icon)}>
            <Icon name={preset.icon} />
          </span>
          <div>
            <b>{preset.title}</b>
            <span>{req.contact ? [req.contact.name, req.contact.phone].filter(Boolean).join(" · ") : m.noContact}</span>
          </div>
        </div>

        {preset.fields.map((f, i) => (
          <Field
            key={f.id}
            label={f.label}
            value={values[f.id] ?? ""}
            placeholder={f.value}
            onChange={(e) => setValues((s) => ({ ...s, [f.id]: e.target.value }))}
            enterKeyHint={i === preset.fields.length - 1 ? "send" : "next"}
          />
        ))}

        <div className="preview">
          <p className="preview-l">{m.usePreview}</p>
          <p>{req.text || "…"}</p>
        </div>

        <div className="sheet-acts">
          <button className="btn primary block tall" type="submit" disabled={!req.text}>
            <Icon name="send" />
            {m.useSend}
          </button>
          <button className="btn ghost block" type="button" onClick={() => onEdit(preset)}>
            <Icon name="pencil" />
            {m.editPreset}
          </button>
        </div>
      </form>
    </PageSheet>
  );
}

/* ---------- create / edit ---------- */

/**
 * Create a preset or change one. `preset` null = new. Built-ins can be edited too;
 * they then keep their own text instead of following the app language.
 */
export function PresetEditor({ preset, onClose }: { preset: Preset | null; onClose(): void }) {
  const store = useStore();
  const m = useAppCopy();
  const [draft, setDraft] = useState<PresetContent>(() => {
    if (!preset) return emptyContent();
    const { title, icon, contactName, contactPhone, template, fields } = preset;
    return { title, icon, contactName, contactPhone, template, fields: fields.map((f) => ({ ...f })) };
  });
  const [invalid, setInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const sel = useRef<{ start: number; end: number } | null>(null);

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

  // Put {Label} where the cursor was in the text (or at the end).
  const insertToken = (f: PresetField) => {
    if (!f.label.trim()) return;
    const t = token(f);
    const s = sel.current;
    setDraft((d) => {
      const at = s ? s.start : d.template.length;
      const end = s ? s.end : at;
      const before = d.template.slice(0, at);
      const pad = before && !/\s$/.test(before) ? " " : "";
      return { ...d, template: `${before}${pad}${t}${d.template.slice(end)}` };
    });
    sel.current = null;
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

  const preview = fillTemplate(draft);
  const named = draft.fields.filter((f) => f.label.trim());

  return (
    <PageSheet
      title={preset ? m.editorEdit : m.editorNew}
      onClose={onClose}
      left={<HeadButton label={m.cancel} onClick={onClose} />}
      right={<HeadButton label={m.save} onClick={save} strong />}
    >
      <form
        className="sheet-form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field
          label={m.presetName}
          value={draft.title}
          placeholder={m.presetNamePh}
          onChange={(e) => patch({ title: e.target.value })}
          error={invalid && !draft.title.trim()}
        />

        <div className="group">
          <p className="group-l" id="icon-l">
            {m.iconL}
          </p>
          <div className="icons" role="radiogroup" aria-labelledby="icon-l">
            {PRESET_ICONS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={draft.icon === name}
                aria-label={name}
                className={cx("iconopt", draft.icon === name && "on")}
                onClick={() => patch({ icon: name })}
              >
                <Icon name={name} />
              </button>
            ))}
          </div>
        </div>

        <h3 className="section">{m.whoL}</h3>
        <Field
          label={m.contactName}
          value={draft.contactName}
          placeholder={m.contactNamePh}
          onChange={(e) => patch({ contactName: e.target.value })}
        />
        <Field
          label={m.contactPhone}
          value={draft.contactPhone}
          placeholder="+47"
          type="tel"
          inputMode="tel"
          help={m.contactPhoneHint}
          onChange={(e) => patch({ contactPhone: e.target.value })}
        />

        <h3 className="section">{m.fieldsL}</h3>
        <p className="help top">{m.fieldsS}</p>
        {draft.fields.map((f) => (
          <div key={f.id} className="fieldcard">
            <div className="fieldrow">
              <Field
                label={m.fieldLabel}
                value={f.label}
                placeholder={m.fieldLabelPh}
                onChange={(e) => setField(f.id, { label: e.target.value })}
              />
              <button type="button" className="remove" aria-label={m.removeField} onClick={() => removeField(f)}>
                <Icon name="trash" />
              </button>
            </div>
            <Field
              label={m.fieldValue}
              value={f.value}
              placeholder={m.fieldValuePh}
              onChange={(e) => setField(f.id, { value: e.target.value })}
            />
          </div>
        ))}
        <button type="button" className="btn ghost block" onClick={addField}>
          <Icon name="plus" />
          {m.addField}
        </button>

        <h3 className="section">{m.templateL}</h3>
        <Field
          multiline
          label={m.templateL}
          value={draft.template}
          placeholder={m.templatePh}
          rows={3}
          onChange={(e) => patch({ template: e.target.value })}
          onSelect={(e) => {
            const el = e.currentTarget;
            sel.current = { start: el.selectionStart, end: el.selectionEnd };
          }}
          error={invalid && !draft.template.trim()}
          help={named.length ? m.templateS : undefined}
        />
        {named.length > 0 && (
          <div className="tokens">
            {named.map((f) => (
              <button key={f.id} type="button" className="token" aria-label={token(f)} onClick={() => insertToken(f)}>
                <Icon name="plus" />
                {f.label}
              </button>
            ))}
          </div>
        )}

        {preview && (
          <div className="preview">
            <p className="preview-l">{m.preview}</p>
            <p>{preview}</p>
          </div>
        )}

        {invalid && (
          <p className="bad-msg" role="alert">
            {m.needName}
          </p>
        )}

        <button className="btn primary block tall" type="submit">
          {m.save}
        </button>
        {preset && (
          <button type="button" className="deleterow" onClick={() => setConfirming(true)}>
            <Icon name="trash" />
            {m.deletePreset}
          </button>
        )}
      </form>
      {confirming && preset && (
        <Confirm
          title={m.deleteQ}
          body={m.deleteBody}
          cancel={m.cancel}
          confirm={m.deletePreset}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            store.deletePreset(preset.id);
            onClose();
          }}
        />
      )}
    </PageSheet>
  );
}
