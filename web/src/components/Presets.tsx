"use client";

import { useMemo, useState } from "react";
import { BUILT_IN_KEYS, resolvePreset, type Preset } from "@/lib/presets";
import { cx, useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { PresetEditor, UsePresetSheet } from "./PresetSheets";
import { Confirm } from "./ui";

/**
 * The Home tab: presets for calls you make often, plus the scripted demos.
 * Tap a preset to use it; Edit to change or delete them.
 */
export function Presets() {
  const store = useStore();
  const t = useCopy();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const stored = useSpoken((s) => s.presets);
  const presets = useMemo(() => stored.map((p) => resolvePreset(p, lang)), [stored, lang]);
  const missingBuiltIn = BUILT_IN_KEYS.some((k) => !stored.some((p) => p.builtIn === k));

  const [editing, setEditing] = useState(false);
  const [using, setUsing] = useState<Preset | null>(null);
  // undefined = editor closed, null = new preset, Preset = editing that one.
  const [editorFor, setEditorFor] = useState<Preset | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Preset | null>(null);

  const open = (p: Preset) => {
    if (editing) return setEditorFor(p);
    // Nothing to fill in: send it straight away.
    if (!p.fields.length) return store.runPreset({ presetId: p.id, text: p.template, contact: null });
    setUsing(p);
  };

  const demos = [
    { key: "pizza", title: t.sugPizza, sub: t.sugPizzaSub },
    { key: "doctor", title: t.sugDoctor, sub: t.sugDoctorSub },
  ] as const;

  return (
    <>
      <div className="scroll pad">
        <div className="pane-body">
          <div className="head-row">
            <h2 className="pane-h">{m.presetsH}</h2>
            <button className={cx("editbtn", editing && "on")} aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
              {editing ? m.done : m.edit}
            </button>
          </div>
          <p className="lede">{m.presetsSub}</p>

          <ul className="pgrid">
            {presets.map((p) => (
              <li key={p.id}>
                <button
                  className={cx("pcard", editing && "editing")}
                  onClick={() => open(p)}
                  aria-label={editing ? `${m.editPreset}: ${p.title}` : undefined}
                >
                  <span className="pcard-top">
                    <span className="pbadge">
                      <Icon name={p.icon} />
                    </span>
                    {editing && <Icon name="pencil" />}
                  </span>
                  <span className="pcard-tx">
                    <b>{p.title}</b>
                    <span>{p.contactName || m.noContact}</span>
                  </span>
                </button>
                {editing && (
                  <button className="pdelete" aria-label={`${m.deletePreset}: ${p.title}`} onClick={() => setDeleting(p)}>
                    <Icon name="trash" />
                  </button>
                )}
              </li>
            ))}
            <li>
              <button className="pcard new" onClick={() => setEditorFor(null)}>
                <span className="pbadge">
                  <Icon name="plus" />
                </span>
                <span className="pcard-tx">
                  <b>{m.newPreset}</b>
                </span>
              </button>
            </li>
          </ul>

          {editing && missingBuiltIn && (
            <button className="restore" onClick={() => store.restorePresets()}>
              <Icon name="replay" />
              {m.restore}
            </button>
          )}

          <h3 className="section">{m.demoH}</h3>
          <ul className="list">
            {demos.map((r) => (
              <li key={r.key}>
                <button className="row" data-demo={r.key} onClick={() => store.playDemo(r.key)}>
                  <span className="ic">
                    <Icon name={r.key} />
                  </span>
                  <span className="tx">
                    <b>{r.title}</b>
                    <span>{r.sub}</span>
                  </span>
                  <span className="go">
                    <Icon name="play" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {using && (
        <UsePresetSheet
          key={using.id}
          preset={using}
          onClose={() => setUsing(null)}
          onSend={(req) => {
            setUsing(null);
            store.runPreset(req);
          }}
          onEdit={(p) => {
            setUsing(null);
            setEditorFor(p);
          }}
        />
      )}
      {editorFor !== undefined && (
        <PresetEditor key={editorFor?.id ?? "new"} preset={editorFor} onClose={() => setEditorFor(undefined)} />
      )}
      {deleting && (
        <Confirm
          title={m.deleteQ}
          body={`${deleting.title}. ${m.deleteBody}`}
          cancel={m.cancel}
          confirm={m.deletePreset}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            store.deletePreset(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
