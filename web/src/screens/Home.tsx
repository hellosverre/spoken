import { useRef, useState, type FormEvent } from "react";
import type { Contact } from "../../../shared/contract.ts";
import { api } from "../api/index.ts";
import { Button, ErrorNote, Icon, Screen, Section, TextArea, TextField, type IconName } from "../components/ui.tsx";
import { useT } from "../i18n/useT.ts";
import { errorText } from "../lib/errors.ts";
import { href, navigate } from "../lib/router.tsx";
import { formatPhone } from "../lib/phone.ts";
import { useStore } from "../state/store.tsx";

// One big box: what do you want done? Shortcuts prefill the start of a task;
// saved places attach a number so Spoken doesn't have to look it up.

const E164 = /^\+?[0-9 ]{3,20}$/;

export function Home() {
  const { d, fmt, lang } = useT();
  const { state, dispatch } = useStore();
  const [text, setText] = useState(state.flow.task?.text ?? "");
  const [phone, setPhone] = useState(state.flow.task?.phone ?? "");
  const [place, setPlace] = useState<Contact | undefined>(() => state.places.find((p) => p.id === state.flow.task?.contactId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<{ text?: string; phone?: string }>({});
  const box = useRef<HTMLTextAreaElement>(null);

  const shortcuts: { icon: IconName; label: string; text: string }[] = [
    { icon: "food", label: d.home.shortcutFood, text: d.home.shortcutFoodText },
    { icon: "calendar", label: d.home.shortcutBook, text: d.home.shortcutBookText },
    { icon: "clock", label: d.home.shortcutHours, text: d.home.shortcutHoursText },
    { icon: "cancel", label: d.home.shortcutCancel, text: d.home.shortcutCancelText },
  ];

  const applyShortcut = (prefix: string) => {
    setText(prefix + (place ? place.name : ""));
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const pickPlace = (p: Contact) => {
    const same = place?.id === p.id;
    setPlace(same ? undefined : p);
    setPhone(same ? "" : p.phone);
    if (!same && !text.includes(p.name)) setText((t) => (t.trim() ? `${t.trim()} ${p.name}` : t));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof fieldError = {};
    if (!text.trim()) errs.text = d.home.empty;
    const cleanPhone = phone.replace(/\s/g, "");
    if (cleanPhone && !E164.test(phone)) errs.phone = d.home.phoneLabel;
    setFieldError(errs);
    if (errs.text || errs.phone) return;

    setBusy(true);
    setError(undefined);
    const task = { text: text.trim(), lang, phone: cleanPhone || undefined, contactId: place?.id };
    try {
      const clarify = await api.createTask(task);
      dispatch({ type: "flow/task", task, clarify });
      navigate({ name: "clarify" });
    } catch (err) {
      setError(errorText(err, d, fmt));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      kind="home"
      title={d.home.title}
      actions={
        <a className="sp-iconlink" href={href({ name: "settings" })} aria-label={d.app.settings}>
          <Icon name="settings" />
        </a>
      }
    >
      <form className="sp-form" data-variant="task" onSubmit={submit} noValidate>
        <TextArea
          ref={box}
          hero
          label={d.home.title}
          placeholder={d.home.placeholder}
          value={text}
          error={fieldError.text}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <TextField
          label={d.home.phoneLabel}
          hint={place ? place.name : d.home.phoneHint}
          error={fieldError.phone}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setPlace(undefined);
          }}
        />
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit" variant="primary" size="lg" busy={busy}>
          {busy ? d.home.submitting : d.home.submit}
        </Button>
      </form>

      <Section title={d.home.shortcuts} kind="shortcuts">
        <ul className="sp-shortcuts">
          {shortcuts.map((s) => (
            <li key={s.label}>
              <button type="button" className="sp-shortcut" onClick={() => applyShortcut(s.text)}>
                <Icon name={s.icon} />
                <span>{s.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Section>

      <Section title={d.home.places} kind="places">
        <ul className="sp-places">
          {state.places.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="sp-place"
                aria-pressed={place?.id === p.id}
                aria-label={fmt(d.home.callPlace, { name: p.name })}
                onClick={() => pickPlace(p)}
              >
                <span className="sp-place__mark" aria-hidden="true">
                  {p.name.slice(0, 1)}
                </span>
                <span className="sp-place__name">{p.name}</span>
                <span className="sp-place__phone">{formatPhone(p.phone)}</span>
                <Icon name={p.kind === "business" ? "place" : "person"} />
              </button>
            </li>
          ))}
        </ul>
      </Section>
    </Screen>
  );
}
