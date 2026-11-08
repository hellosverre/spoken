"use client";

import { useId } from "react";
import { fill } from "@/lib/i18n";
import { formatDay } from "@/lib/history";
import { TERMS } from "@/lib/terms";
import { useAppCopy, useSpoken } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { HeadButton, PageSheet } from "./ui";

/** The terms of use in a page sheet: from the login and sign-up screens and from Profile. As the app's Terms.tsx. */
export function TermsSheet({ onClose }: { onClose(): void }) {
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const terms = useSpoken((s) => s.terms);
  const doc = TERMS[lang];

  return (
    <PageSheet title={doc.title} onClose={onClose} right={<HeadButton label={m.close} onClick={onClose} strong />}>
      <div className="terms">
        <p className="note">
          <Icon name="alert" />
          {doc.note}
        </p>
        {doc.sections.map((sec) => (
          <section key={sec.h}>
            <h3>{sec.h}</h3>
            {sec.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </section>
        ))}
        {terms && <p className="help">{fill(m.termsAccepted, { date: formatDay(terms.at, lang) })}</p>}
      </div>
    </PageSheet>
  );
}

/**
 * The agreement on the login and sign-up screens: a checkbox, and a separate button that opens
 * the terms, so a screen reader finds two plain controls instead of a link inside a checkbox label.
 */
export function TermsAgree({ checked, onChange, onRead, error }: { checked: boolean; onChange(v: boolean): void; onRead(): void; error?: string }) {
  const m = useAppCopy();
  const id = useId();
  const bad = !!error && !checked;
  return (
    <div className="agree">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-invalid={bad || undefined} aria-describedby={bad ? id : undefined} />
        <span className="box" aria-hidden>
          <Icon name="check" />
        </span>
        {m.termsAgree}
      </label>
      <button type="button" className="read" onClick={onRead}>
        {m.termsRead}
        <Icon name="chevron" />
      </button>
      {bad && (
        <p className="fld-err" id={id} role="alert">
          <Icon name="alert" />
          {error}
        </p>
      )}
    </div>
  );
}
