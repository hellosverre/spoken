"use client";

import { useState, type CSSProperties } from "react";
import { fill } from "@/lib/i18n";
import { kr, perMinute, PLANS, SUGGESTED_PLAN, type Plan } from "@/lib/plans";
import { cx, useAppCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { DemoNote, EnterpriseCard, EnterpriseSheet, RedeemForm } from "./Enterprise";
import { Icon, Wordmark } from "./Icon";

/**
 * After sign-up: pick a monthly plan of call minutes, redeem an organisation's code, or contact
 * us about Enterprise. A showcase, as the app's Plans.tsx: no payment, and a plan or a code ends
 * at the phone login. Each plan card is one button, read out whole (name, minutes, price, per minute).
 */
export function Plans({ on }: { on: boolean }) {
  const store = useStore();
  const m = useAppCopy();
  const [contact, setContact] = useState(false);

  return (
    <section className={cx("screen", on && "on")} id="plans" aria-label={m.plansH} inert={!on}>
      <header className="topbar pad">
        <button type="button" className="backbtn" onClick={() => store.openSignup()}>
          <Icon name="chevron" />
          {m.back}
        </button>
        <Wordmark />
      </header>
      <div className="scroll pad">
        <div className="pane-body">
          <div className="rise" style={{ "--i": 0 } as CSSProperties}>
            <h1 className="pane-h">{m.plansH}</h1>
            <p className="lede">{m.plansSub}</p>
          </div>
          <ul className="plans">
            {PLANS.map((p, i) => (
              <li key={p.id} className="rise" style={{ "--i": i + 1 } as CSSProperties}>
                <PlanCard plan={p} onChoose={() => store.choosePlan(p.id)} />
              </li>
            ))}
          </ul>
          <p className="help plans-reset">{m.planReset}</p>
          <div className="plans-more">
            <EnterpriseCard onContact={() => setContact(true)} />
            <div className="codebox">
              <h2>{m.codeH}</h2>
              <p className="help">{m.codeSub}</p>
              <RedeemForm login />
            </div>
            <DemoNote text={m.demoPay} />
          </div>
        </div>
      </div>
      {contact && <EnterpriseSheet onClose={() => setContact(false)} />}
    </section>
  );
}

function PlanCard({ plan, onChoose }: { plan: Plan; onChoose(): void }) {
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const name = m.planNames[plan.id];
  const suggested = plan.id === SUGGESTED_PLAN;
  // Monthly: "239 kr/month" and "30 min/month".
  const price = plan.price ? fill(m.perMonth, { price: kr(plan.price, lang) }) : m.free;
  const rate = plan.price ? perMinute(plan.price, plan.minutes, lang) : null;
  const minutes = fill(m.minutesMonth, { n: String(plan.minutes) });
  const label = [name, minutes, price, rate, suggested ? m.suggested : null, m.planNotes[plan.id]].filter(Boolean).join(", ");

  return (
    <button type="button" className={cx("plancard", suggested && "suggested")} aria-label={label} onClick={onChoose}>
      {/* The suggested plan: a thicker outline and a labelled badge, not colour alone. */}
      {suggested && (
        <span className="plan-badge">
          <Icon name="check" />
          {m.suggested}
        </span>
      )}
      <span className="plan-top">
        <span className="plan-name">
          <b>{name}</b>
          <span className="plan-min">{minutes}</span>
        </span>
        <span className="plan-price">
          <b>{price}</b>
          {rate && <span>{rate}</span>}
        </span>
      </span>
      <span className="plan-note">{m.planNotes[plan.id]}</span>
      <span className="plan-go">
        {fill(m.choosePlan, { plan: name })}
        <Icon name="chevron" />
      </span>
    </button>
  );
}
