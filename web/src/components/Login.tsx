"use client";

import { useState, type CSSProperties } from "react";
import { cx, useAppCopy, useStore } from "@/lib/use-spoken";
import { Wordmark } from "./Icon";
import { Field } from "./ui";

/**
 * Sign-in after the intro. A placeholder until real accounts exist: only
 * demo / demo gets in (checked in store.login), and nothing leaves the browser.
 */
export function Login({ on }: { on: boolean }) {
  const store = useStore();
  const m = useAppCopy();
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [bad, setBad] = useState(false);

  return (
    <section className={cx("screen", on && "on")} id="login" aria-label={m.loginH} inert={!on}>
      <header className="topbar pad">
        <Wordmark />
      </header>
      <div className="scroll pad">
        <form
          className="login"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const ok = store.login(user, pass);
            setBad(!ok);
            if (ok) setPass("");
          }}
        >
          <span className="mark big rise" style={{ "--i": 0 } as CSSProperties} />
          <div className="rise" style={{ "--i": 1 } as CSSProperties}>
            <h1 className="greet">{m.loginH}</h1>
            <p className="lede">{m.loginSub}</p>
          </div>
          <div className="login-fields rise" style={{ "--i": 2 } as CSSProperties}>
            <Field
              label={m.userL}
              value={user}
              onChange={(e) => {
                setUser(e.target.value);
                setBad(false);
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="next"
              error={bad}
            />
            <Field
              label={m.passL}
              type="password"
              value={pass}
              onChange={(e) => {
                setPass(e.target.value);
                setBad(false);
              }}
              autoComplete="off"
              enterKeyHint="go"
              error={bad}
            />
            {bad && (
              <p className="bad-msg" role="alert">
                {m.loginBad}
              </p>
            )}
            <button className="btn primary block tall" type="submit" disabled={!user || !pass}>
              {m.loginBtn}
            </button>
            <p className="hint">{m.loginHint}</p>
          </div>
        </form>
      </div>
    </section>
  );
}
