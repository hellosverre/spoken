"use client";

import { useEffect, useState } from "react";
import { accountPhone, logoutAccount, startLogin, verifyLogin } from "@/lib/account";
import { useSpoken } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { Field } from "./ui";

const COPY = {
  en: {
    title: "Account",
    login: "Log in with phone number",
    loginS: "Optional. Keeps your contacts and calls on all your devices.",
    phoneL: "Phone number",
    phoneH: "We text you a 6-digit code.",
    send: "Send code",
    codeL: "Code from the text message",
    verify: "Log in",
    back: "Other number",
    loggedIn: "Logged in",
    logout: "Log out",
    busy: "One moment…",
  },
  no: {
    title: "Konto",
    login: "Logg inn med telefonnummer",
    loginS: "Valgfritt. Gir deg kontaktene og samtalene dine på alle enhetene dine.",
    phoneL: "Telefonnummer",
    phoneH: "Vi sender deg en kode på 6 siffer.",
    send: "Send kode",
    codeL: "Kode fra tekstmeldingen",
    verify: "Logg inn",
    back: "Annet nummer",
    loggedIn: "Innlogget",
    logout: "Logg ut",
    busy: "Et øyeblikk …",
  },
} as const;

export function useAccountCopy() {
  return COPY[useSpoken((s) => s.lang)];
}

/** Profile → Account: log in with an SMS code, or see the number and log out. Logged out changes nothing else. */
export function AccountSection() {
  const c = useAccountCopy();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [me, setMe] = useState("");
  const [step, setStep] = useState<"idle" | "phone" | "code">("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // localStorage is not there while prerendering: read it after mount.
  useEffect(() => setMe(accountPhone()), []);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (me) {
    return (
      <ul className="list">
        <li className="row static">
          <span className="ic">
            <Icon name="person" />
          </span>
          <span className="tx">
            <b>{me}</b>
            <span>{c.loggedIn}</span>
          </span>
        </li>
        <li>
          <button
            className="row danger"
            onClick={() =>
              run(async () => {
                await logoutAccount();
                window.location.reload(); // back to the anonymous device's data
              })
            }
          >
            <span className="ic">
              <Icon name="logout" />
            </span>
            <span className="tx">
              <b>{c.logout}</b>
            </span>
          </button>
        </li>
      </ul>
    );
  }

  if (step === "idle") {
    return (
      <ul className="list">
        <li>
          <button className="row" onClick={() => setStep("phone")}>
            <span className="ic">
              <Icon name="phone" />
            </span>
            <span className="tx">
              <b>{c.login}</b>
              <span>{c.loginS}</span>
            </span>
            <span className="go">
              <Icon name="chevron" />
            </span>
          </button>
        </li>
      </ul>
    );
  }

  return (
    <form
      className="group"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === "phone") {
          run(async () => {
            await startLogin(phone.trim());
            setCode("");
            setStep("code");
          });
        } else {
          run(async () => {
            await verifyLogin(phone.trim(), code.trim());
            window.location.reload(); // pick up the account's profile, contacts and calls
          });
        }
      }}
    >
      {step === "phone" ? (
        <Field
          label={c.phoneL}
          help={c.phoneH}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+47"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
        />
      ) : (
        <Field
          label={c.codeL}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          autoFocus
        />
      )}
      <p className="help" role="alert" hidden={!error}>
        {error}
      </p>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button className="btn primary" type="submit" disabled={busy || (step === "phone" ? phone.trim().length < 8 : code.length !== 6)}>
          {busy ? c.busy : step === "phone" ? c.send : c.verify}
        </button>
        <button className="btn ghost" type="button" onClick={() => setStep(step === "code" ? "phone" : "idle")}>
          {step === "code" ? c.back : "×"}
        </button>
      </div>
    </form>
  );
}
