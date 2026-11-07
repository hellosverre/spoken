import { useState, type FormEvent } from "react";
import type { Profile } from "../../../shared/contract.ts";
import { api } from "../api/index.ts";
import { Button, ChoiceGroup, LinkButton, Screen, Section, TextField, Toggle } from "../components/ui.tsx";
import { langNames } from "../i18n/index.ts";
import { useT } from "../i18n/useT.ts";
import { useAlerts } from "../lib/alerts.tsx";
import { href, navigate } from "../lib/router.tsx";
import { useStore, type ThemePref } from "../state/store.tsx";

export function Settings() {
  const { d } = useT();
  const { state, dispatch } = useStore();
  const { notify } = useAlerts();
  const { settings, profile } = state;
  const [draft, setDraft] = useState<Profile>(profile);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof settings>) => dispatch({ type: "settings", patch });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const next = { ...profile, ...draft, lang: profile.lang };
    dispatch({ type: "profile", patch: next });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    try {
      await api.putProfile(next);
    } catch (err) {
      console.warn("Profile kept on this device; server sync failed", err);
    }
  };

  const field = (key: "name" | "phone" | "address" | "email" | "allergies", label: string, auto: string) => (
    <TextField
      label={label}
      value={draft[key] ?? ""}
      autoComplete={auto}
      onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
    />
  );

  return (
    <Screen kind="settings" title={d.settings.title} back={href({ name: "home" })}>
      <Section title={d.settings.appearance} kind="appearance">
        <ChoiceGroup<ThemePref>
          legend={d.settings.theme}
          layout="row"
          value={settings.theme}
          onChange={(theme) => set({ theme })}
          options={(["system", "dark", "light"] as const).map((v) => ({ value: v, label: d.settings.themes[v] }))}
        />
        <ChoiceGroup
          legend={d.settings.language}
          layout="row"
          value={profile.lang}
          onChange={(lang) => dispatch({ type: "lang", lang })}
          options={(["en", "no"] as const).map((v) => ({ value: v, label: langNames[v] }))}
        />
      </Section>

      <Section title={d.settings.accessibility} kind="accessibility">
        <ChoiceGroup
          legend={d.onboarding.prefsTitle}
          value={profile.hearCall ? "hear" : "read"}
          onChange={(v) => dispatch({ type: "profile", patch: { hearCall: v === "hear" } })}
          options={[
            { value: "read", label: d.onboarding.readOnly, hint: d.onboarding.readOnlyHint },
            { value: "hear", label: d.onboarding.hearCall, hint: d.onboarding.hearCallHint },
          ]}
        />
        <div className="sp-stack">
          <Toggle label={d.onboarding.bigText} checked={settings.bigText} onChange={(bigText) => set({ bigText })} />
          <Toggle label={d.onboarding.highContrast} checked={settings.highContrast} onChange={(highContrast) => set({ highContrast })} />
          <Toggle label={d.settings.reduceMotion} checked={settings.reduceMotion} onChange={(reduceMotion) => set({ reduceMotion })} />
          <Toggle label={d.settings.vibrate} checked={settings.vibrate} onChange={(vibrate) => set({ vibrate })} />
          <Toggle label={d.settings.flash} checked={settings.flash} onChange={(flash) => set({ flash })} />
        </div>
        <Button variant="ghost" onClick={() => notify("approval", d.alerts.approval)}>
          {d.settings.testAlert}
        </Button>
      </Section>

      <Section title={d.settings.profile} kind="profile">
        <p className="sp-section__body">{d.settings.profileHint}</p>
        <form className="sp-form" onSubmit={save}>
          {field("name", d.onboarding.nameLabel, "given-name")}
          {field("phone", d.settings.phone, "tel")}
          {field("address", d.settings.address, "street-address")}
          {field("email", d.settings.email, "email")}
          {field("allergies", d.settings.allergies, "off")}
          <ChoiceGroup
            legend={d.settings.personality}
            value={draft.personality}
            onChange={(personality) => setDraft((p) => ({ ...p, personality }))}
            options={(["warm", "neutral", "short"] as const).map((v) => ({ value: v, label: d.settings.personalities[v] }))}
          />
          <Button type="submit" variant="primary">
            {saved ? d.settings.saved : d.settings.save}
          </Button>
          <span className="sp-visually-hidden" role="status">
            {saved ? d.settings.saved : ""}
          </span>
        </form>
      </Section>

      <div className="sp-actions" data-variant="settings">
        <LinkButton href={href({ name: "privacy" })}>{d.settings.privacy}</LinkButton>
        <Button
          variant="ghost"
          onClick={() => {
            dispatch({ type: "onboarded", value: false });
            navigate({ name: "onboarding", step: 1 });
          }}
        >
          {d.settings.reset}
        </Button>
      </div>
    </Screen>
  );
}
