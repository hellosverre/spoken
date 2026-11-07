import { useState } from "react";
import { api } from "../api/index.ts";
import { Button, ErrorNote, Icon, LinkButton, Screen } from "../components/ui.tsx";
import { useT } from "../i18n/useT.ts";
import { errorText } from "../lib/errors.ts";
import { href, navigate, Redirect, type Route } from "../lib/router.tsx";
import { formatPhone } from "../lib/phone.ts";
import { useStore } from "../state/store.tsx";

const HOME: Route = { name: "home" };

// The plan is the contract with the user: who, what is said first, what may be
// shared and what needs a yes. Nothing dials until OK is pressed.

export function Plan() {
  const { d, fmt } = useT();
  const { state, dispatch } = useStore();
  const plan = state.flow.plan;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!plan) {
    return <Redirect to={HOME} />;
  }

  const start = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const { callId } = await api.startCall(plan.taskId);
      dispatch({ type: "flow/call", callId });
      navigate({ name: "call", callId });
    } catch (err) {
      setError(errorText(err, d, fmt));
      setBusy(false);
    }
  };

  if (plan.blocked) {
    return (
      <Screen kind="plan-blocked" title={d.plan.blockedTitle} back={href({ name: "home" })}>
        <div className="sp-blocked" role="alert">
          <Icon name="warn" />
          <p className="sp-blocked__reason">{plan.blocked.reason}</p>
          {plan.blocked.alternative ? (
            <div className="sp-blocked__alt">
              <h2>{d.plan.blockedAlt}</h2>
              <p>{plan.blocked.alternative}</p>
            </div>
          ) : null}
        </div>
        <LinkButton href={href({ name: "home" })}>{d.plan.edit}</LinkButton>
      </Screen>
    );
  }

  return (
    <Screen kind="plan" title={d.plan.title} back={href({ name: "clarify" })}>
      <dl className="sp-plan">
        <div className="sp-plan__row" data-row="callee">
          <dt>{d.plan.calling}</dt>
          <dd>
            <span className="sp-plan__callee">{plan.callee.name}</span>
            <span className="sp-plan__phone">{formatPhone(plan.callee.phone)}</span>
            <span className="sp-plan__source">{d.plan.source[plan.callee.source]}</span>
          </dd>
        </div>
        <div className="sp-plan__row" data-row="goal">
          <dt>{d.plan.goal}</dt>
          <dd>{plan.goal}</dd>
        </div>
        <div className="sp-plan__row" data-row="opening">
          <dt>{d.plan.opening}</dt>
          <dd>
            <blockquote lang="nb">{plan.opening}</blockquote>
          </dd>
        </div>
        <div className="sp-plan__row" data-row="shares">
          <dt>{d.plan.shares}</dt>
          <dd>
            {plan.willShare.length ? (
              <ul className="sp-tags">
                {plan.willShare.map((s) => (
                  <li key={s}>{d.share[s]}</li>
                ))}
              </ul>
            ) : (
              d.plan.sharesNone
            )}
          </dd>
        </div>
        <div className="sp-plan__row" data-row="approval">
          <dt>{d.plan.approval}</dt>
          <dd>
            <ul className="sp-plan__list">
              {plan.needsApprovalFor.map((a) => (
                <li key={a}>
                  <Icon name="shield" />
                  {a}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
      {error ? <ErrorNote message={error} onRetry={start} /> : null}
      <div className="sp-actions">
        <Button variant="primary" size="xl" busy={busy} onClick={start}>
          <Icon name="phone" />
          <span>{busy ? d.plan.starting : d.plan.ok}</span>
        </Button>
        <LinkButton href={href({ name: "home" })} variant="ghost">
          {d.plan.edit}
        </LinkButton>
      </div>
    </Screen>
  );
}
