"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ApiError, startLogin, verifyLogin } from "@/lib/account";
import { toE164 } from "@/lib/phone";
import type { Lang } from "@/lib/i18n";
import { cx, useSpoken, useStore } from "@/lib/use-spoken";
import { Wordmark } from "./Icon";
import { Field } from "./ui";

/**
 * Sign up = sign in: phone number → 6-digit SMS code → in. The server needs this session
 * for everything else, so the app opens here after the intro. Same screen for new and returning users.
 */
const T = {
  no: {
    h: "Logg inn med telefonnummer",
    sub: "Spoken ringer for deg, og butikken får se nummeret ditt. Vi sender en kode på SMS.",
    phoneL: "Telefonnummer",
    phoneH: "Landkode +47 er satt for Norge. Endre den for et annet land.",
    send: "Send kode",
    sending: "Sender …",
    codeH: "Skriv inn koden",
    codeSub: (p: string) => `Vi sendte en kode på 6 siffer til ${p}.`,
    codeL: "Kode fra SMS",
    verify: "Logg inn",
    verifying: "Sjekker …",
    resend: "Send ny kode",
    resendIn: (s: number) => `Send ny kode om ${s} s`,
    resent: "Ny kode er sendt.",
    change: "Bruk et annet nummer",
    badPhone: "Det ser ikke ut som et telefonnummer. Sjekk at det er riktig.",
    wrongCode: "Feil kode. Sjekk SMS-en og prøv igjen.",
    expired: "Koden er utløpt. Be om en ny.",
    tooMany: "For mange forsøk. Vent litt og prøv igjen, eller be om en ny kode.",
    smsFail: "Fikk ikke sendt SMS. Prøv igjen om litt.",
    offline: "Får ikke kontakt med Spoken. Sjekk nettet og prøv igjen.",
    other: "Noe gikk galt. Prøv igjen.",
    hint: "Meldingspriser fra mobilselskapet kan gjelde.",
  },
  en: {
    h: "Log in with your phone number",
    sub: "Spoken makes calls for you, and the shop sees your number. We'll text you a code.",
    phoneL: "Phone number",
    phoneH: "Country code +47 is set for Norway. Change it for another country.",
    send: "Send code",
    sending: "Sending …",
    codeH: "Enter the code",
    codeSub: (p: string) => `We sent a 6-digit code to ${p}.`,
    codeL: "Code from the text",
    verify: "Log in",
    verifying: "Checking …",
    resend: "Send a new code",
    resendIn: (s: number) => `Send a new code in ${s} s`,
    resent: "A new code is on its way.",
    change: "Use a different number",
    badPhone: "That doesn't look like a phone number. Check it and try again.",
    wrongCode: "Wrong code. Check the text message and try again.",
    expired: "That code has expired. Ask for a new one.",
    tooMany: "Too many attempts. Wait a bit and try again, or ask for a new code.",
    smsFail: "Couldn't send the text. Try again shortly.",
    offline: "Can't reach Spoken. Check your connection and try again.",
    other: "Something went wrong. Try again.",
    hint: "Your carrier's message rates may apply.",
  },
} as const;
type Copy = (typeof T)[Lang];

const RESEND_SECONDS = 30;

/** Back to the (new or emptied) input once React has rendered the step. */
const refocus = () => requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#login input")?.focus());

/** Maps the server's (Norwegian) errors to our own text in the UI language. */
function explain(e: unknown, step: "phone" | "code", c: Copy): string {
  if (!(e instanceof ApiError)) return c.other;
  if (e.status === 0) return c.offline;
  if (e.status === 429) return c.tooMany;
  if (e.status === 502) return c.smsFail;
  if (e.status === 400) return step === "phone" ? c.badPhone : /utløpt/i.test(e.message) ? c.expired : c.wrongCode;
  return c.other;
}

export function Login({ on }: { on: boolean }) {
  const store = useStore();
  const lang = useSpoken((s) => s.lang);
  const c = T[lang];
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("+47 ");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [wait, setWait] = useState(0);

  // Resend countdown.
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  // A fresh Login (after logout or a 401) starts from the phone step.
  useEffect(() => {
    if (on) return;
    setStep("phone");
    setCode("");
    setError("");
    setNote("");
    setWait(0);
  }, [on]);

  const e164 = toE164(phone);

  async function sendCode(again = false) {
    if (busy || !e164) {
      if (!e164) setError(c.badPhone);
      return;
    }
    setBusy(true);
    setError("");
    setNote("");
    try {
      await startLogin(e164);
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
      if (again) setNote(c.resent);
      refocus();
    } catch (e) {
      setError(explain(e, "phone", c));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (busy || code.length !== 6) return;
    setBusy(true);
    setError("");
    try {
      await verifyLogin(e164, code);
      setCode("");
      store.signedIn();
    } catch (e) {
      setError(explain(e, "code", c));
      setCode("");
      refocus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cx("screen", on && "on")} id="login" aria-label={c.h} inert={!on}>
      <header className="topbar pad">
        <Wordmark />
      </header>
      <div className="scroll pad">
        <form
          className="login"
          onSubmit={(e) => {
            e.preventDefault();
            void (step === "phone" ? sendCode() : verify());
          }}
        >
          <span className="mark big rise" style={{ "--i": 0 } as CSSProperties} />
          <div className="rise" style={{ "--i": 1 } as CSSProperties}>
            <h1 className="greet">{step === "phone" ? c.h : c.codeH}</h1>
            <p className="lede">{step === "phone" ? c.sub : c.codeSub(e164 || phone.trim())}</p>
          </div>
          <div className="login-fields rise" style={{ "--i": 2 } as CSSProperties}>
            {step === "phone" ? (
              <Field
                label={c.phoneL}
                help={c.phoneH}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                enterKeyHint="go"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setError("");
                }}
                error={!!error}
              />
            ) : (
              <Field
                autoFocus
                label={c.codeL}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                maxLength={6}
                enterKeyHint="go"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError("");
                }}
                error={!!error}
              />
            )}
            <p className="bad-msg" role="alert" hidden={!error}>
              {error}
            </p>
            <p className="hint" role="status" hidden={!note}>
              {note}
            </p>
            <button
              className="btn primary block tall"
              type="submit"
              disabled={busy || (step === "phone" ? !e164 : code.length !== 6)}
            >
              {step === "phone" ? (busy ? c.sending : c.send) : busy ? c.verifying : c.verify}
            </button>
            {step === "code" && (
              <>
                <button className="btn ghost block" type="button" disabled={busy || wait > 0} onClick={() => void sendCode(true)}>
                  {wait > 0 ? c.resendIn(wait) : c.resend}
                </button>
                <button
                  className="btn ghost block"
                  type="button"
                  onClick={() => {
                    setStep("phone");
                    setError("");
                    setNote("");
                  }}
                >
                  {c.change}
                </button>
              </>
            )}
            <p className="hint">{c.hint}</p>
          </div>
        </form>
      </div>
    </section>
  );
}
