"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ThemePref } from "@/lib/store";
import { useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { HeroDuet } from "./Art";
import { Icon, type IconName } from "./Icon";
import { FeedbackSheet } from "./Feedback";
import { AccountSection, useAccountCopy } from "./Account";
import { ContactsSection, useContactCopy } from "./ContactPicker";
import { VoicePicker } from "./VoicePicker";
import { Confirm, Field } from "./ui";
import { api } from "@/lib/account";
import { VoiceSheet } from "./VoiceSheet";

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

type Reason = "deaf" | "hard_of_hearing" | "speech" | "anxiety" | "other";
type Mode = "always" | "when_helpful" | "never";
interface ReasonState { reason?: Reason; reasonText?: string; reasonMode?: Mode }
const REASONS: Reason[] = ["deaf", "hard_of_hearing", "speech", "anxiety", "other"];
const MODES: Mode[] = ["always", "when_helpful", "never"];

const REASON_COPY = {
  no: {
    title: "Fortell hvorfor jeg bruker Spoken", none: "Ikke satt", done: "Ferdig", clear: "Fjern",
    hint: "Valgfritt. Sies bare i samtaler, og lagres først når du velger noe. Du kan fjerne det når som helst.",
    why: "Grunn", when: "Når skal Spoken nevne det?", otherL: "Egen tekst", otherPh: "f.eks. har dysleksi", saveFail: "Fikk ikke lagret.",
    reasons: { deaf: "Døv", hard_of_hearing: "Hørselshemmet", speech: "Talevansker", anxiety: "Telefonangst", other: "Annet" },
    modes: { always: "Alltid", when_helpful: "Bare når det hjelper", never: "Aldri" },
  },
  en: {
    title: "Tell why I use Spoken", none: "Not set", done: "Done", clear: "Remove",
    hint: "Optional. Only said on calls, and stored only once you choose something. You can remove it any time.",
    why: "Reason", when: "When should Spoken mention it?", otherL: "Your own words", otherPh: "e.g. has dyslexia", saveFail: "Couldn't save.",
    reasons: { deaf: "Deaf", hard_of_hearing: "Hard of hearing", speech: "Speech", anxiety: "Phone anxiety", other: "Other" },
    modes: { always: "Always", when_helpful: "Only when it helps", never: "Never" },
  },
} as const;

/** Optional «why I use Spoken»: a collapsed row, details in a sheet. Health data, so it only exists once the user sets it. */
function ReasonSection() {
  const lang = useSpoken((s) => s.lang);
  const c = REASON_COPY[lang];
  const [st, setSt] = useState<ReasonState>({});
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<ReasonState>("GET", "/api/profile").then((p) => { setSt({ reason: p.reason, reasonText: p.reasonText, reasonMode: p.reasonMode }); setDraft(p.reasonText ?? ""); }).catch(() => {});
  }, []);

  /** next = null clears all three. The server keeps the old value when the keys are absent. */
  async function save(next: ReasonState | null) {
    const prev = st;
    const value = next ?? {};
    setSt(value);
    setError("");
    try {
      const cur = await api<Record<string, unknown>>("GET", "/api/profile");
      await api("PUT", "/api/profile", {
        hearCall: true, personality: "warm", ...cur, lang,
        reason: value.reason ?? null, reasonText: value.reasonText ?? null, reasonMode: value.reasonMode ?? null,
      });
    } catch {
      setSt(prev);
      setError(c.saveFail);
    }
  }

  const label = st.reason ? (st.reason === "other" && st.reasonText ? st.reasonText : c.reasons[st.reason]) + " · " + c.modes[st.reasonMode ?? "when_helpful"] : c.none;
  const mode = st.reasonMode ?? "when_helpful";

  return (
    <div className="rs">
      <style>{REASON_CSS}</style>
      <button type="button" className="rs-row" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <span className="rs-t"><b>{c.title}</b><span>{label}</span></span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9.5 6l6 6-6 6" /></svg>
      </button>
      {error && <p className="help" role="status">{error}</p>}
      {open && (
        <VoiceSheet title={c.title} closeLabel={c.done} onClose={() => setOpen(false)}>
          <p className="help" style={{ margin: "0 0 0.75rem" }}>{c.hint}</p>
          <div role="group" aria-label={c.why} className="rs-chips">
            {REASONS.map((r) => (
              <button key={r} type="button" aria-pressed={st.reason === r}
                onClick={() => void save({ reason: r, reasonMode: mode, reasonText: r === "other" ? draft.trim().slice(0, 60) || undefined : undefined })}>
                {c.reasons[r]}
              </button>
            ))}
          </div>
          {st.reason === "other" && (
            <Field label={c.otherL} placeholder={c.otherPh} maxLength={60} value={draft} autoComplete="off"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => draft.trim() !== (st.reasonText ?? "") && void save({ ...st, reasonText: draft.trim() || undefined })} />
          )}
          {st.reason && (
            <>
              <h4 className="rs-h">{c.when}</h4>
              <div className="seg wide" role="group" aria-label={c.when}>
                {MODES.map((m) => (
                  <button key={m} type="button" aria-pressed={mode === m} onClick={() => void save({ ...st, reasonMode: m })}>{c.modes[m]}</button>
                ))}
              </div>
              <button type="button" className="rs-clear" onClick={() => { setDraft(""); void save(null); }}>{c.clear}</button>
            </>
          )}
        </VoiceSheet>
      )}
    </div>
  );
}

const REASON_CSS = `
.rs-row{display:flex;align-items:center;gap:0.75rem;width:100%;min-height:3.25rem;padding:0.5rem 0.875rem;background:var(--surface);border:1px solid var(--line);border-radius:1.125rem;color:var(--ink);font:inherit;text-align:left;cursor:pointer}
.rs-row:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rs-t{flex:1;display:flex;flex-direction:column;min-width:0}
.rs-t b{font-size:0.9375rem;font-weight:560}
.rs-t span{font-size:0.8125rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rs-row svg{color:var(--muted);flex:none}
.rs-chips{display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem}
.rs-chips button{min-height:2.5rem;padding:0 0.875rem;border-radius:999px;border:1px solid var(--line-2);background:transparent;color:var(--ink);font:inherit;font-size:0.875rem;cursor:pointer}
.rs-chips button[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
.rs-h{margin:1rem 0 0.5rem;font-size:0.8125rem;font-weight:510;color:var(--muted)}
.rs-clear{margin-top:1rem;min-height:2.5rem;background:none;border:0;color:var(--muted);font:inherit;font-size:0.875rem;text-decoration:underline;cursor:pointer}
`;

const DELETE_COPY = {
  no: {
    row: "Slett kontoen min", sub: "Fjerner alt om deg fra Spoken", title: "Slette kontoen?",
    body: "Alt om deg slettes: profil, kontakter og samtalehistorikk. Kan ikke angres.", cancel: "Avbryt", confirm: "Slett alt",
    failed: "Kunne ikke slette kontoen. Prøv igjen.",
  },
  en: {
    row: "Delete my account", sub: "Removes everything about you from Spoken", title: "Delete your account?",
    body: "Everything about you is deleted: profile, contacts and call history. This can't be undone.", cancel: "Cancel", confirm: "Delete everything",
    failed: "Couldn't delete the account. Try again.",
  },
} as const;

/** Profile → bottom: erase the account on the server, then forget everything on this device. */
function DeleteAccount() {
  const store = useStore();
  const lang = useSpoken((s) => s.lang);
  const c = DELETE_COPY[lang];
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function erase() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("DELETE", "/api/account");
    } catch {
      setAsk(false);
      setBusy(false);
      setError(c.failed);
      return;
    }
    try {
      // The account is gone on the server; drop every Spoken key on this device (chat, token, device id).
      for (const k of Object.keys(localStorage)) if (k.toLowerCase().startsWith("spoken")) localStorage.removeItem(k);
    } catch { /* private mode: nothing stored */ }
    await store.logout();
  }

  return (
    <>
      <ul className="list">
        <li>
          <button className="row danger" onClick={() => setAsk(true)} disabled={busy}>
            <span className="ic"><Icon name="logout" /></span>
            <span className="tx">
              <b>{c.row}</b>
              <span>{c.sub}</span>
            </span>
          </button>
        </li>
      </ul>
      {error && <p className="help" role="alert">{error}</p>}
      {ask && <Confirm title={c.title} body={c.body} cancel={c.cancel} confirm={c.confirm} onCancel={() => setAsk(false)} onConfirm={() => void erase()} />}
    </>
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

        <SectionTitle icon="phone">{lang === "no" ? "Stemme" : "Voice"}</SectionTitle>
        <VoicePicker />

        <ReasonSection />

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
        <DeleteAccount />
      </div>
      {feedbackOpen && <FeedbackSheet onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}
