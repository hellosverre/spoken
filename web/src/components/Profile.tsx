"use client";

import { useState } from "react";
import type { ThemePref } from "@/lib/store";
import { useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { Field } from "./ui";

const THEMES: ThemePref[] = ["system", "light", "dark"];

/** The Profile tab: who you are, the theme, language and the rest of the old settings. */
export function Profile() {
  const store = useStore();
  const t = useCopy();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const themePref = useSpoken((s) => s.themePref);
  const profile = useSpoken((s) => s.profile);

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

  return (
    <div className="scroll pad">
      <div className="pane-body">
        <h2 className="pane-h">{m.profileH}</h2>

        <div className="profile-card">
          <span className="avatar" aria-hidden>
            {initials}
          </span>
          <div>
            <b>{profile.name || m.you}</b>
            <span>@demo</span>
          </div>
        </div>

        <h3 className="section">{m.you}</h3>
        <div className="fields">
          <Field
            label={m.nameL}
            help={m.nameS}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() !== profile.name && store.setProfile({ name: name.trim() })}
            autoComplete="off"
          />
          <Field
            label={m.phoneL}
            help={m.phoneS}
            type="tel"
            inputMode="tel"
            placeholder="+47"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={() => phone.trim() !== profile.phone && store.setProfile({ phone: phone.trim() })}
            autoComplete="off"
          />
        </div>

        <h3 className="section">{m.appearance}</h3>
        <ul className="list">
          <li className="row static">
            <span className="tx">
              <b>{m.themeL}</b>
              <span>{m.themeS}</span>
            </span>
            <div className="seg" role="group" aria-label={m.themeL}>
              {THEMES.map((x) => (
                <button key={x} aria-pressed={themePref === x} onClick={() => store.setThemePref(x)}>
                  {m.themes[x]}
                </button>
              ))}
            </div>
          </li>
        </ul>

        <h3 className="section">{m.general}</h3>
        <ul className="list">
          <li className="row static">
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
              <span className="tx">
                <b>{t.replay}</b>
                <span>{t.replayS}</span>
              </span>
              <span className="go">
                <Icon name="replay" />
              </span>
            </button>
          </li>
          <li className="row static">
            <span className="tx">
              <b>{t.keysL}</b>
              <span>{t.keysS}</span>
            </span>
          </li>
          <li>
            <button className="row danger" onClick={() => store.logout()}>
              <span className="tx">
                <b>{m.logout}</b>
              </span>
              <span className="go">
                <Icon name="logout" />
              </span>
            </button>
          </li>
        </ul>
        <p className="about">{t.foot}</p>
      </div>
    </div>
  );
}
