"use client";

import { useState, type ReactNode } from "react";
import type { ThemePref } from "@/lib/store";
import { useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { HeroDuet } from "./Art";
import { Icon, type IconName } from "./Icon";
import { FeedbackSheet } from "./Feedback";
import { AccountSection, useAccountCopy } from "./Account";
import { ContactsSection, useContactCopy } from "./ContactPicker";
import { Field } from "./ui";

const THEMES: { v: ThemePref; icon: IconName }[] = [
  { v: "system", icon: "auto" },
  { v: "light", icon: "sun" },
  { v: "dark", icon: "moon" },
];

function SectionTitle({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <h3 className="section">
      <Icon name={icon} />
      {children}
    </h3>
  );
}

/** The Profile tab: who you are, the theme, language and the rest of the old settings. */
export function Profile() {
  const store = useStore();
  const t = useCopy();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const themePref = useSpoken((s) => s.themePref);
  const profile = useSpoken((s) => s.profile);

  const cc = useContactCopy();
  const ac = useAccountCopy();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Local drafts, saved on blur. Re-sync when the stored profile changes.
  const [prev, setPrev] = useState(profile);
  const [name, setName] = useState(profile.name);
  const [phone, setPhone] = useState(profile.phone);
  if (prev !== profile) {
    setPrev(profile);
    setName(profile.name);
    setPhone(profile.phone);
  }

  const initials =
    profile.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("") || "?";
  const first = profile.name.trim().split(/\s+/)[0] ?? "";
  const hour = new Date().getHours();
  const greet = m.greet[hour < 5 ? "night" : hour < 11 ? "morning" : hour < 18 ? "day" : "evening"];

  return (
    <div className="scroll pad">
      <div className="pane-body">
        <h2 className="pane-h">{m.profileH}</h2>

        {/* Who you are: the one coloured, drawn card on the page. */}
        <div className="profile-card">
          <HeroDuet className="profile-art" />
          <span className="avatar" aria-hidden>
            {initials}
          </span>
          {/* The hour differs between the prerender and the visitor's clock. */}
          <span className="hello" suppressHydrationWarning>
            {first ? `${greet}, ${first}` : greet}
          </span>
          <b>{profile.name || m.you}</b>
          <span className="handle">@demo</span>
        </div>

        <SectionTitle icon="person">{m.you}</SectionTitle>
        <div className="group">
          <div>
            <div className="field-row">
              <span className="tile" aria-hidden>
                <Icon name="person" />
              </span>
              <Field
                label={m.nameL}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name.trim() !== profile.name && store.setProfile({ name: name.trim() })}
                autoComplete="off"
              />
            </div>
            <p className="help">{m.nameS}</p>
          </div>
          <div>
            <div className="field-row">
              <span className="tile" aria-hidden>
                <Icon name="phone" />
              </span>
              <Field
                label={m.phoneL}
                type="tel"
                inputMode="tel"
                placeholder="+47"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => phone.trim() !== profile.phone && store.setProfile({ phone: phone.trim() })}
                autoComplete="off"
              />
            </div>
            <p className="help">{m.phoneS}</p>
          </div>
        </div>

        <SectionTitle icon="lock">{ac.title}</SectionTitle>
        <AccountSection />

        <SectionTitle icon="person">{cc.saved}</SectionTitle>
        <ContactsSection />

        <SectionTitle icon="sliders">{m.appearance}</SectionTitle>
        <div className="group">
          <div className="group-head">
            <span className="tile small" aria-hidden>
              <Icon name={THEMES.find((x) => x.v === themePref)?.icon ?? "auto"} />
            </span>
            <span className="tx">
              <b>{m.themeL}</b>
              <span>{m.themeS}</span>
            </span>
          </div>
          <div className="seg wide" role="group" aria-label={m.themeL}>
            {THEMES.map((x) => (
              <button key={x.v} aria-pressed={themePref === x.v} onClick={() => store.setThemePref(x.v)}>
                <Icon name={x.icon} />
                {m.themes[x.v]}
              </button>
            ))}
          </div>
        </div>

        <SectionTitle icon="bubble">{m.general}</SectionTitle>
        <ul className="list">
          <li className="row static">
            <span className="ic">
              <Icon name="globe" />
            </span>
            <span className="tx">
              <b>{t.langL}</b>
              <span>{t.langS}</span>
            </span>
            <div className="seg" role="group" aria-label={t.langL}>
              {(["en", "no"] as const).map((l) => (
                <button key={l} aria-pressed={lang === l} onClick={() => store.setLang(l)}>
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
          </li>
          <li>
            <button className="row" onClick={() => store.replay()}>
              <span className="ic">
                <Icon name="replay" />
              </span>
              <span className="tx">
                <b>{t.replay}</b>
                <span>{t.replayS}</span>
              </span>
              <span className="go">
                <Icon name="chevron" />
              </span>
            </button>
          </li>
          <li className="row static">
            <span className="ic">
              <Icon name="sliders" />
            </span>
            <span className="tx">
              <b>{t.keysL}</b>
              <span>{t.keysS}</span>
            </span>
          </li>
          <li>
            <button className="row" onClick={() => setFeedbackOpen(true)}>
              <span className="ic">
                <Icon name="bubble" />
              </span>
              <span className="tx">
                <b>{m.fbRowT}</b>
                <span>{m.fbRowS}</span>
              </span>
              <span className="go">
                <Icon name="chevron" />
              </span>
            </button>
          </li>
          <li>
            <button className="row danger" onClick={() => store.logout()}>
              <span className="ic">
                <Icon name="logout" />
              </span>
              <span className="tx">
                <b>{m.logout}</b>
              </span>
            </button>
          </li>
        </ul>

        <SectionTitle icon="lock">{m.privacyH}</SectionTitle>
        <ul className="list privacy">
          {m.privacy.map(([title, sub]) => (
            <li key={title} className="row static">
              <span className="tx">
                <b>{title}</b>
                <span>{sub}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="about">{t.foot}</p>
      </div>
      {feedbackOpen && <FeedbackSheet onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
