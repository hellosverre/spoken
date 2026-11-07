import { useEffect, useState } from "react";
import type { CallResult } from "../../../shared/contract.ts";
import { motion } from "motion/react";
import { api } from "../api/index.ts";
import { CountUp } from "../motion/CountUp.tsx";
import { spring } from "../motion/presets.ts";
import { RevealWords } from "../motion/RevealWords.tsx";
import { Stagger, StaggerItem } from "../motion/Stagger.tsx";
import { Button, ErrorNote, Screen, Section } from "../components/ui.tsx";
import { useT } from "../i18n/useT.ts";
import { errorText } from "../lib/errors.ts";
import { href, navigate } from "../lib/router.tsx";
import { STACK } from "../lib/stack.ts";
import { useStore } from "../state/store.tsx";

function duration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} min ${s} s` : `${s} s`;
}

export function Result({ callId }: { callId: string }) {
  const { d, fmt } = useT();
  const { state, dispatch } = useStore();
  const cached = state.flow.result?.callId === callId ? state.flow.result : undefined;
  const [result, setResult] = useState<CallResult | undefined>(cached);
  const [error, setError] = useState<string>();

  const load = () => {
    setError(undefined);
    api
      .getCall(callId)
      .then((r) => {
        setResult(r);
        dispatch({ type: "flow/result", result: r });
      })
      .catch((e: unknown) => setError(errorText(e, d, fmt)));
  };
  useEffect(() => {
    if (!cached) load();
    // Only refetch when the call changes; the cached result covers the rest.
  }, [callId]);

  const newTask = () => {
    dispatch({ type: "flow/reset" });
    navigate({ name: "home" });
  };

  const calleeName = state.flow.plan?.callee.name ?? "";

  return (
    <Screen kind="result" title={d.result.title} back={href({ name: "home" })}>
      {error ? <ErrorNote message={error} onRetry={load} /> : null}
      {!result && !error ? <p className="sp-loading">{d.app.loading}</p> : null}
      {result ? (
        <>
          <article className="sp-result" data-outcome={result.outcome}>
            <motion.p
              className="sp-result__outcome"
              initial={{ opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ ...spring.pop, delay: 0.1 }}
            >
              {d.result.outcome[result.outcome]}
            </motion.p>
            <RevealWords className="sp-result__summary" text={result.summary} delay={0.18} />
            <Stagger as="dl" className="sp-result__details" gap={0.07}>
              {[...Object.entries(result.details), [d.result.duration, duration(result.durationSec)] as const].map(([k, v], i) => (
                <StaggerItem as="div" key={k}>
                  <dt>{k}</dt>
                  <dd>
                    <CountUp value={v} delay={0.35 + i * 0.07} />
                  </dd>
                </StaggerItem>
              ))}
            </Stagger>
          </article>

          <details className="sp-disclosure">
            <summary>{d.result.transcript}</summary>
            <ol className="sp-transcript-list">
              {result.transcript.map((l, i) => (
                <li key={i} className="sp-line" data-who={l.who} data-final>
                  <p className="sp-line__who">{l.who === "agent" ? d.call.you : calleeName}</p>
                  <p className="sp-line__text" lang="nb">
                    {l.text}
                  </p>
                </li>
              ))}
            </ol>
            <p className="sp-hint">{d.result.notStored}</p>
          </details>

          <Section title={d.result.builtWith} kind="built-with">
            <p className="sp-section__body">{d.result.builtWithBody}</p>
            <table className="sp-models">
              <thead>
                <tr>
                  <th scope="col">{d.result.step}</th>
                  <th scope="col">{d.result.model}</th>
                  <th scope="col">{d.result.latency}</th>
                </tr>
              </thead>
              <tbody>
                {STACK.map((s) => (
                  <tr key={s.key} data-vendor={s.vendor}>
                    <th scope="row">{d.result.stack[s.key]}</th>
                    <td>{`${s.vendor} ${s.model}`.trim()}</td>
                    <td>{s.latencyMs === undefined ? "—" : <CountUp value={`${s.latencyMs} ms`} delay={0.6} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Button variant="primary" size="lg" onClick={newTask}>
            {d.result.newTask}
          </Button>
        </>
      ) : null}
    </Screen>
  );
}
