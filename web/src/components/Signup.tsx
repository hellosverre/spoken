"use client";

import { useState, type CSSProperties } from "react";
import { cx, useAppCopy, useStore } from "@/lib/use-spoken";
import { Wordmark } from "./Icon";
import { TermsAgree, TermsSheet } from "./Terms";
import { Field } from "./ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Create an account: name, email, password and the terms, then on to the plans. A showcase, as
 * the app's Signup.tsx: nothing is saved or sent, and the plan that follows ends at the phone login.
 * Mistakes show under their field when Continue is pressed, never while typing.
 */
export function Signup({ on }: { on: boolean }) {
  const store = useStore();
  const m = useAppCopy();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [tried, setTried] = useState(false);
  const [reading, setReading] = useState(false);

  const errors = {
    name: name.trim() ? undefined : m.needSignupName,
    email: EMAIL.test(email.trim()) ? undefined : m.needEmail,
    pass: pass.length >= 8 ? undefined : m.needPass,
    terms: agreed ? undefined : m.termsNeeded,
  };
  const show = (e?: string) => (tried ? e : undefined);

  return (
    <section className={cx("screen", on && "on")} id="signup" aria-label={m.signupH} inert={!on}>
      <header className="topbar pad">
        <Wordmark />
      </header>
      <div className="scroll pad">
        <form
          className="login"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTried(true);
            if (Object.values(errors).some(Boolean)) return;
            store.signup();
          }}
        >
          <div className="rise" style={{ "--i": 0 } as CSSProperties}>
            <h1 className="greet">{m.signupH}</h1>
            <p className="lede">{m.signupSub}</p>
          </div>
          <div className="login-fields rise" style={{ "--i": 1 } as CSSProperties}>
            <Field label={m.signupNameL} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" enterKeyHint="next" error={show(errors.name)} />
            <Field label={m.emailL} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" enterKeyHint="next" error={show(errors.email)} />
            <Field
              label={m.newPassL}
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              autoComplete="new-password"
              enterKeyHint="go"
              help={m.newPassHelp}
              error={show(errors.pass)}
            />
            <TermsAgree checked={agreed} onChange={setAgreed} onRead={() => setReading(true)} error={show(errors.terms)} />
            <button className="btn primary block tall" type="submit">
              {m.signupBtn}
            </button>
            <p className="switch">
              {m.haveAccount}
              <button type="button" className="link" onClick={() => store.openLogin()}>
                {m.loginBtn}
              </button>
            </p>
          </div>
        </form>
      </div>
      {reading && <TermsSheet onClose={() => setReading(false)} />}
    </section>
  );
}
