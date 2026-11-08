"use client";

import { useState, type ReactNode } from "react";
import { fill } from "@/lib/i18n";
import { kr, LOW_MINUTES, perMinute, PLANS, TOP_UPS, totalMinutes, type PaidPlanId } from "@/lib/plans";
import { useAppCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { DemoNote, Done, EnterpriseSheet, RedeemForm } from "./Enterprise";
import { Icon } from "./Icon";
import { HeadButton, PageSheet } from "./ui";

/** "449 kr/month", "Free", or "Paid by NAV": what the current plan costs you. */
function usePlanDetail() {
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const { plan, org } = useSpoken((s) => s.minutes);
  if (plan === "org") return fill(m.paidBy, { org: org ?? m.yourOrg });
  const price = PLANS.find((p) => p.id === plan)?.price ?? 0;
  return price ? fill(m.perMonth, { price: kr(price, lang) }) : m.free;
}

/**
 * Profile: this month's call minutes used and left, with a bar, and the ways to change them.
 * The numbers are dummies for the showcase (calls don't count down yet), and nothing is charged.
 * As the app's Minutes.tsx.
 */
export function MinutesCard() {
  const m = useAppCopy();
  const minutes = useSpoken((s) => s.minutes);
  const detail = usePlanDetail();
  const [topUp, setTopUp] = useState(false);
  const [change, setChange] = useState(false);
  const total = totalMinutes(minutes);
  const used = minutes.used;
  const left = Math.max(0, total - used);
  const low = left <= LOW_MINUTES;
  const n = (v: number) => String(v);
  const planName = m.planNames[minutes.plan];

  return (
    <div className="mins">
      <div className="mins-top">
        <span className="mins-plan">
          <b>{planName}</b>
          <span>{detail}</span>
        </span>
        <b className="mins-left">{fill(m.minutesLeft, { n: n(left) })}</b>
      </div>
      <progress className="mins-bar" max={total || 1} value={Math.min(used, total)} aria-label={fill(m.minutesUsed, { used: n(used), total: n(total) })} />
      <p className="help">{fill(m.minutesUsed, { used: n(used), total: n(total) })}</p>
      {low && (
        <p className="fld-err">
          <Icon name="alert" />
          {m.minutesLow}
        </p>
      )}
      <div className="acts-row">
        <button type="button" className={low ? "btn primary" : "btn ghost"} onClick={() => setTopUp(true)}>
          <Icon name="plus" />
          {m.addMinutes}
        </button>
        <button type="button" className="btn ghost" onClick={() => setChange(true)}>
          <Icon name="sliders" />
          {m.changePlan}
        </button>
      </div>
      {topUp && <TopUpSheet onClose={() => setTopUp(false)} />}
      {change && <ChangePlanSheet onClose={() => setChange(false)} />}
    </div>
  );
}

/** Pick a top-up, see its price, "buy" it. Then a plain confirmation of what you have now. */
function TopUpSheet({ onClose }: { onClose(): void }) {
  const store = useStore();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const minutes = useSpoken((s) => s.minutes);
  const [pick, setPick] = useState(TOP_UPS[1]!.minutes);
  const [added, setAdded] = useState<number | null>(null);

  const chosen = TOP_UPS.find((t) => t.minutes === pick) ?? TOP_UPS[0]!;
  const left = Math.max(0, totalMinutes(minutes) - minutes.used);

  return (
    <PageSheet title={m.topUpH} onClose={onClose} left={<HeadButton label={m.cancel} onClick={onClose} />}>
      {added !== null ? (
        <div className="sheet-form">
          <Done text={fill(m.topUpDone, { n: String(added), left: String(left) })} />
          <button type="button" className="btn primary block tall" onClick={onClose}>
            {m.done}
          </button>
        </div>
      ) : (
        <div className="sheet-form">
          <p className="help top">{m.topUpSub}</p>
          <div className="choices" role="radiogroup" aria-label={m.topUpH}>
            {TOP_UPS.map((t) => (
              <Choice key={t.minutes} name="topup" on={t.minutes === pick} onPick={() => setPick(t.minutes)}>
                <b className="choice-main">+{fill(m.minutesN, { n: String(t.minutes) })}</b>
                <span className="choice-price">
                  <b>{kr(t.price, lang)}</b>
                  <span>{perMinute(t.price, t.minutes, lang)}</span>
                </span>
              </Choice>
            ))}
          </div>
          <button
            type="button"
            className="btn primary block tall"
            onClick={() => {
              store.addMinutes(chosen.minutes);
              setAdded(chosen.minutes);
            }}
          >
            {fill(m.buyN, { n: String(chosen.minutes), price: kr(chosen.price, lang) })}
          </button>
          <DemoNote text={m.demoPayShort} />
        </div>
      )}
    </PageSheet>
  );
}

/**
 * Profile → Change plan: the monthly plans with the current one marked, a code from an
 * organisation, and Enterprise. Picking a plan asks once more, then switches (nothing charged).
 */
function ChangePlanSheet({ onClose }: { onClose(): void }) {
  const store = useStore();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  const current = useSpoken((s) => s.minutes.plan);
  const [pick, setPick] = useState<PaidPlanId | null>(null);
  const [switched, setSwitched] = useState<PaidPlanId | null>(null);
  const [contact, setContact] = useState(false);

  const chosen = PLANS.find((p) => p.id === pick);

  return (
    <PageSheet title={m.changePlan} onClose={onClose} left={<HeadButton label={m.close} onClick={onClose} />}>
      {switched ? (
        <div className="sheet-form">
          <Done text={fill(m.switched, { plan: m.planNames[switched], n: String(PLANS.find((p) => p.id === switched)?.minutes ?? 0) })} />
          <button type="button" className="btn primary block tall" onClick={onClose}>
            {m.done}
          </button>
        </div>
      ) : (
        <div className="sheet-form">
          {current === "org" && <p className="help top">{m.orgNote}</p>}
          <div className="choices" role="radiogroup" aria-label={m.changePlan}>
            {PLANS.map((p) => {
              const isCurrent = p.id === current;
              const minutesL = fill(m.minutesMonth, { n: String(p.minutes) });
              return (
                <Choice key={p.id} name="plan" on={(pick ?? current) === p.id} onPick={() => setPick(isCurrent ? null : p.id)}>
                  <span className="choice-main">
                    <b>{m.planNames[p.id]}</b>
                    <span>{isCurrent ? `${minutesL} · ${m.currentPlan}` : minutesL}</span>
                  </span>
                  <b>{p.price ? fill(m.perMonth, { price: kr(p.price, lang) }) : m.free}</b>
                </Choice>
              );
            })}
          </div>
          {chosen && (
            <>
              <p className="help">{m.changeNote}</p>
              <button
                type="button"
                className="btn primary block tall"
                onClick={() => {
                  store.changePlan(chosen.id);
                  setSwitched(chosen.id);
                }}
              >
                {fill(m.switchTo, { plan: m.planNames[chosen.id] })}
              </button>
              <DemoNote text={m.demoPayShort} />
            </>
          )}

          <section className="sheet-sec">
            <h3>{m.codeH}</h3>
            <p className="help">{m.codeSub}</p>
            <RedeemForm />
          </section>

          <section className="sheet-sec">
            <h3>{m.entH}</h3>
            <p className="help">{m.entSub}</p>
            <button type="button" className="btn ghost block" onClick={() => setContact(true)}>
              {m.entBtn}
            </button>
          </section>
          {contact && <EnterpriseSheet onClose={() => setContact(false)} />}
        </div>
      )}
    </PageSheet>
  );
}

/** One option in a list of choices: a real radio, a ring that fills with a check, a thicker outline when chosen. */
function Choice({ name, on, onPick, children }: { name: string; on: boolean; onPick(): void; children: ReactNode }) {
  return (
    <label className="choice">
      <input type="radio" name={name} checked={on} onChange={onPick} />
      <span className="radio" aria-hidden>
        <Icon name="check" />
      </span>
      {children}
    </label>
  );
}
