"use client";

import { useState } from "react";
import { fill } from "@/lib/i18n";
import { parseCode } from "@/lib/plans";
import { useAppCopy, useStore } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { HeadButton, PageSheet, Field } from "./ui";

/*
 * Enterprise: organisations buy many accounts at an agreed price and hand out one code per
 * person. A showcase, as the app's Enterprise.tsx: the contact form sends nothing, and any
 * well-formed code is accepted.
 */

/** The Enterprise card at the bottom of the plans: no price, a way to get in touch. */
export function EnterpriseCard({ onContact }: { onContact(): void }) {
  const m = useAppCopy();
  return (
    <div className="ent">
      <div className="ent-top">
        <span className="tile small" aria-hidden>
          <Icon name="person" />
        </span>
        <div className="ent-tx">
          <h3>{m.entH}</h3>
          <span>{m.entPrice}</span>
        </div>
      </div>
      <p>{m.entSub}</p>
      <button type="button" className="btn ghost block" onClick={onContact}>
        {m.entBtn}
      </button>
    </div>
  );
}

/** "Contact us for a price": who you are and how many accounts. Sends nothing; says so. */
export function EnterpriseSheet({ onClose }: { onClose(): void }) {
  const m = useAppCopy();
  const [org, setOrg] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [count, setCount] = useState("");
  const [msg, setMsg] = useState("");
  const [tried, setTried] = useState(false);
  const [sent, setSent] = useState(false);

  const n = Number.parseInt(count.replace(/\s/g, ""), 10);
  const errors = {
    org: org.trim() ? undefined : m.needOrg,
    name: name.trim() ? undefined : m.needSignupName,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? undefined : m.needEmail,
    count: n > 0 ? undefined : m.needCount,
  };
  const show = (e?: string) => (tried ? e : undefined);
  const send = () => {
    setTried(true);
    if (!Object.values(errors).some(Boolean)) setSent(true);
  };

  return (
    <PageSheet
      title={m.entFormH}
      onClose={onClose}
      left={<HeadButton label={m.cancel} onClick={onClose} />}
      right={sent ? <HeadButton label={m.done} onClick={onClose} strong /> : <HeadButton label={m.entSend} onClick={send} strong />}
    >
      {sent ? (
        <Done text={fill(m.entThanks, { name: name.trim(), email: email.trim(), n: String(n) })} />
      ) : (
        <form
          className="sheet-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <p className="help top">{m.entFormSub}</p>
          <Field label={m.entOrgL} value={org} onChange={(e) => setOrg(e.target.value)} autoComplete="organization" error={show(errors.org)} />
          <Field label={m.entNameL} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" error={show(errors.name)} />
          <Field label={m.entEmailL} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" error={show(errors.email)} />
          <Field label={m.entCountL} inputMode="numeric" value={count} placeholder={m.entCountPh} onChange={(e) => setCount(e.target.value)} error={show(errors.count)} />
          <Field label={m.entMsgL} multiline rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} />
          <button type="submit" className="btn primary block tall">
            {m.entSend}
          </button>
          <DemoNote text={m.demoNothingSent} />
        </form>
      )}
    </PageSheet>
  );
}

/**
 * Redeem an organisation's code. On the plans page it logs in (`login`); in Profile it just
 * changes the plan and says who pays.
 */
export function RedeemForm({ login }: { login?: boolean }) {
  const store = useStore();
  const m = useAppCopy();
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const redeem = () => {
    const r = parseCode(code);
    setBad(!r.ok);
    if (!r.ok) return;
    if (!login) setDone(fill(m.redeemed, { org: r.org ?? m.yourOrg }));
    store.redeemCode(code, login);
  };

  if (done) return <Done text={done} />;

  return (
    <form
      className="redeem"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        redeem();
      }}
    >
      <Field
        label={m.codeL}
        value={code}
        placeholder={m.codePh}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(e) => {
          setCode(e.target.value);
          setBad(false);
        }}
        error={bad ? m.badCode : undefined}
      />
      <button type="submit" className="btn primary block" disabled={!code.trim()}>
        {m.redeem}
      </button>
      <DemoNote text={m.codeDemo} />
    </form>
  );
}

export function DemoNote({ text }: { text: string }) {
  return (
    <p className="demo-note">
      <Icon name="alert" />
      {text}
    </p>
  );
}

/** A plain confirmation, read out when it appears. */
export function Done({ text }: { text: string }) {
  return (
    <p className="done-box" role="status">
      <Icon name="check" />
      {text}
    </p>
  );
}
