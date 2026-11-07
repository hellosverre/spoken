import { useEffect, useState, type FormEvent } from "react";
import type { Voice } from "../../../shared/contract.ts";
import { api } from "../api/index.ts";
import { Button, ChoiceGroup, ErrorNote, Progress, Screen, TextField, Toggle } from "../components/ui.tsx";
import { langNames } from "../i18n/index.ts";
import { useT } from "../i18n/useT.ts";
import { errorText } from "../lib/errors.ts";
import { href, navigate } from "../lib/router.tsx";
import { useStore } from "../state/store.tsx";

// Three steps: who you are, how you follow calls, which voice speaks for you.
// It asks preferences only, never anything medical (GDPR Art. 9).

const TOTAL = 3;

export function Onboarding({ step }: { step: 1 | 2 | 3 }) {
  if (step === 1) return <StepWelcome />;
  if (step === 2) return <StepPrefs />;
  return <StepVoice />;
}

function StepWelcome() {
  const { d, fmt } = useT();
  const { state, dispatch } = useStore();
  const [name, setName] = useState(state.profile.name);
  const [error, setError] = useState<string>();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(d.onboarding.nameLabel);
      return;
    }
    dispatch({ type: "profile", patch: { name: name.trim() } });
    navigate({ name: "onboarding", step: 2 });
  };

  return (
    <Screen
      kind="onboarding-1"
      title={d.onboarding.welcomeTitle}
      actions={
        <div className="sp-lang" role="group" aria-label={d.settings.language}>
          {(["en", "no"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className="sp-lang__opt"
              aria-pressed={state.profile.lang === l}
              onClick={() => dispatch({ type: "lang", lang: l })}
            >
              {langNames[l]}
            </button>
          ))}
        </div>
      }
    >
      <Progress step={1} total={TOTAL} label={fmt(d.onboarding.progress, { step: 1, total: TOTAL })} />
      <p className="sp-lead">{d.onboarding.welcomeBody}</p>
      <p className="sp-promise">{d.app.promise}</p>
      <form className="sp-form" onSubmit={submit} noValidate>
        <TextField
          label={d.onboarding.nameLabel}
          hint={d.onboarding.nameHint}
          error={error}
          value={name}
          autoComplete="given-name"
          onChange={(e) => {
            setName(e.target.value);
            setError(undefined);
          }}
        />
        <Button type="submit" variant="primary" size="lg">
          {d.app.next}
        </Button>
      </form>
    </Screen>
  );
}

function StepPrefs() {
  const { d, fmt } = useT();
  const { state, dispatch } = useStore();
  const { settings, profile } = state;

  return (
    <Screen kind="onboarding-2" title={d.onboarding.prefsTitle} back={href({ name: "onboarding", step: 1 })}>
      <Progress step={2} total={TOTAL} label={fmt(d.onboarding.progress, { step: 2, total: TOTAL })} />
      <p className="sp-lead">{d.onboarding.prefsBody}</p>
      <ChoiceGroup
        legend={d.onboarding.prefsTitle}
        hideLegend
        value={profile.hearCall ? "hear" : "read"}
        onChange={(v) => dispatch({ type: "profile", patch: { hearCall: v === "hear" } })}
        options={[
          { value: "read", label: d.onboarding.readOnly, hint: d.onboarding.readOnlyHint },
          { value: "hear", label: d.onboarding.hearCall, hint: d.onboarding.hearCallHint },
        ]}
      />
      <div className="sp-stack">
        <Toggle label={d.onboarding.bigText} checked={settings.bigText} onChange={(v) => dispatch({ type: "settings", patch: { bigText: v } })} />
        <Toggle
          label={d.onboarding.highContrast}
          checked={settings.highContrast}
          onChange={(v) => dispatch({ type: "settings", patch: { highContrast: v } })}
        />
        <Toggle
          label={d.onboarding.alerts}
          checked={settings.vibrate && settings.flash}
          onChange={(v) => dispatch({ type: "settings", patch: { vibrate: v, flash: v } })}
        />
      </div>
      <Button variant="primary" size="lg" onClick={() => navigate({ name: "onboarding", step: 3 })}>
        {d.app.next}
      </Button>
    </Screen>
  );
}

function StepVoice() {
  const { d, fmt } = useT();
  const { state, dispatch } = useStore();
  const [voices, setVoices] = useState<Voice[] | null>(null);
  const [error, setError] = useState<string>();
  const [description, setDescription] = useState("");
  const [designing, setDesigning] = useState(false);

  const load = () => {
    setError(undefined);
    api
      .voices()
      .then((v) => {
        setVoices(v);
        if (!state.profile.voiceId && v[0]) dispatch({ type: "profile", patch: { voiceId: v[0].id } });
      })
      .catch((e: unknown) => setError(errorText(e, d, fmt)));
  };
  // Load once on mount; retry goes through the same function.
  useEffect(load, []);

  const design = async (e: FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setDesigning(true);
    setError(undefined);
    try {
      const v = await api.designVoice(description.trim());
      setVoices((prev) => [...(prev ?? []), v]);
      dispatch({ type: "profile", patch: { voiceId: v.id } });
      setDescription("");
    } catch (err) {
      setError(errorText(err, d, fmt));
    } finally {
      setDesigning(false);
    }
  };

  const finish = async () => {
    dispatch({ type: "onboarded", value: true });
    try {
      await api.putProfile(state.profile);
    } catch (err) {
      // The profile is kept on this device either way; the server copy can sync later.
      console.warn("Profile not saved to server yet", err);
    }
    navigate({ name: "home" }, { replace: true });
  };

  return (
    <Screen kind="onboarding-3" title={d.onboarding.voiceTitle} back={href({ name: "onboarding", step: 2 })}>
      <Progress step={3} total={TOTAL} label={fmt(d.onboarding.progress, { step: 3, total: TOTAL })} />
      <p className="sp-lead">{d.onboarding.voiceBody}</p>
      {error ? <ErrorNote message={error} onRetry={voices ? undefined : load} /> : null}
      {voices === null && !error ? <p className="sp-loading">{d.app.loading}</p> : null}
      {voices ? (
        <ChoiceGroup
          legend={d.onboarding.voiceTitle}
          hideLegend
          value={state.profile.voiceId}
          onChange={(v) => dispatch({ type: "profile", patch: { voiceId: v } })}
          options={voices.map((v) => ({ value: v.id, label: v.name, hint: v.description }))}
        />
      ) : null}
      <form className="sp-form" data-variant="inline" onSubmit={design}>
        <TextField
          label={d.onboarding.designVoice}
          placeholder={d.onboarding.designPlaceholder}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button type="submit" busy={designing} disabled={!description.trim()}>
          {designing ? d.onboarding.designing : d.onboarding.designButton}
        </Button>
      </form>
      <Button variant="primary" size="lg" onClick={finish} disabled={!state.profile.voiceId}>
        {d.onboarding.finish}
      </Button>
    </Screen>
  );
}
