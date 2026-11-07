import { useCallback, useEffect, useState } from "react";
import type { LiveEvent } from "../../../shared/contract.ts";
import { api } from "../api/index.ts";
import { ApprovalCard } from "../components/call/ApprovalCard.tsx";
import { CallControls, type Tone } from "../components/call/CallControls.tsx";
import { CallHeader } from "../components/call/CallHeader.tsx";
import { Transcript, UNSURE_BELOW } from "../components/call/Transcript.tsx";
import { Button, Icon } from "../components/ui.tsx";
import { useT } from "../i18n/useT.ts";
import { useAlerts } from "../lib/alerts.tsx";
import { navigate } from "../lib/router.tsx";
import { useStore } from "../state/store.tsx";
import { useLiveCall } from "../state/useLiveCall.ts";

// The demo's main screen. A big live transcript, the JA/NEI moment on top of
// it when needed, and controls to steer the AI without taking over the call.

export function Call({ callId }: { callId: string }) {
  const { d } = useT();
  const { state: app, dispatch } = useStore();
  const { notify } = useAlerts();
  const [tone, setTone] = useState<Tone>("friendly");
  const plan = app.flow.plan;

  const onEvent = useCallback(
    (e: LiveEvent) => {
      if (e.type === "status" && e.status === "connected") notify("connected", d.alerts.connected);
      if (e.type === "approval_request") notify("approval", `${d.alerts.approval}: ${e.question}`);
      if (e.type === "result") {
        notify("ended", d.alerts.ended);
        dispatch({ type: "flow/result", result: e.result });
      }
    },
    [notify, d, dispatch],
  );

  const { state, send } = useLiveCall(callId, onEvent);
  const ended = state.status === "ended" || state.status === "failed" || !!state.result;

  // Give the last line a moment on screen, then move to the result card.
  useEffect(() => {
    if (!state.result) return;
    const t = setTimeout(() => navigate({ name: "result", callId }, { replace: true }), 2500);
    return () => clearTimeout(t);
  }, [state.result, callId]);

  const hangup = () => {
    send({ type: "hangup" });
    api.hangup(callId).catch((err: unknown) => console.warn("Hangup over REST failed; the live command was still sent", err));
  };

  return (
    <div
      className="sp-screen"
      data-screen="call"
      data-status={state.status}
      data-approval={state.approval ? true : undefined}
      data-connection={state.connection}
    >
      <header className="sp-screen__bar">
        <CallHeader
          name={plan?.callee.name ?? ""}
          phone={plan?.callee.phone ?? ""}
          status={state.status}
          connectedAt={state.connectedAt}
        />
      </header>
      <main id="main" className="sp-screen__main" tabIndex={-1}>
        <h1 className="sp-visually-hidden" tabIndex={-1}>
          {d.call.title}
        </h1>
        {state.connection === "reconnecting" ? (
          <p className="sp-banner" role="status" data-level="warn">
            {d.call.connectionLost}
          </p>
        ) : null}

        <Transcript lines={state.lines} calleeName={plan?.callee.name ?? ""} agentTyping={state.agentTyping} />

        {state.lines.some((l) => l.words.some((w) => w.confidence < UNSURE_BELOW)) ? (
          <p className="sp-hint" data-hint="unsure">
            {d.call.unsureHint}
          </p>
        ) : null}

        {state.notes.length ? (
          <ul className="sp-notes" aria-label={d.call.notes}>
            {state.notes.map((n, i) => (
              <li key={i} className="sp-note" data-level={n.level}>
                <Icon name={n.level === "warn" ? "shield" : "check"} />
                <span>{n.text}</span>
              </li>
            ))}
          </ul>
        ) : null}

        {state.approval ? (
          <ApprovalCard
            approval={state.approval}
            onChoose={(choice) => send({ type: "approval_response", id: state.approval!.id, choice })}
          />
        ) : null}

        {state.result ? (
          <div className="sp-actions" data-variant="ended">
            <Button variant="primary" size="lg" onClick={() => navigate({ name: "result", callId }, { replace: true })}>
              {d.call.seeResult}
            </Button>
          </div>
        ) : null}
      </main>
      <footer className="sp-screen__footer">
        <CallControls
          disabled={ended}
          tone={tone}
          onInstruction={(text) => send({ type: "instruction", text })}
          onSimpler={() => send({ type: "say_simpler" })}
          onTone={(t) => {
            setTone(t);
            send({ type: "tone", tone: t });
          }}
          onHangup={hangup}
        />
      </footer>
    </div>
  );
}
