import { useState, type FormEvent } from "react";
import type { Question } from "../../../shared/contract.ts";
import { api } from "../api/index.ts";
import { Button, ErrorNote, Screen, TextField } from "../components/ui.tsx";
import { useT } from "../i18n/useT.ts";
import { errorText } from "../lib/errors.ts";
import { href, navigate, Redirect, type Route } from "../lib/router.tsx";
import { useStore } from "../state/store.tsx";

const HOME: Route = { name: "home" };

// Spoken always asks first. Each question offers quick taps; free text is always allowed.

const OTHER = "__other";

export function Clarify() {
  const { d, fmt } = useT();
  const { state, dispatch } = useStore();
  const clarify = state.flow.clarify;
  const [picked, setPicked] = useState<Record<string, string>>(() => state.flow.answers ?? {});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (!clarify) {
    return <Redirect to={HOME} />;
  }

  const answerOf = (q: Question) => (picked[q.id] === OTHER || !q.options?.length ? other[q.id] ?? "" : picked[q.id] ?? "");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const answers = Object.fromEntries(clarify.questions.map((q) => [q.id, answerOf(q).trim()]));
    setBusy(true);
    setError(undefined);
    try {
      const plan = await api.answer(clarify.taskId, answers);
      dispatch({ type: "flow/plan", answers, plan });
      navigate({ name: "plan" });
    } catch (err) {
      setError(errorText(err, d, fmt));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen kind="clarify" title={d.clarify.title} back={href({ name: "home" })}>
      <div className="sp-understood">
        <p className="sp-understood__label">{d.clarify.understood}</p>
        <p className="sp-understood__text">{clarify.summary}</p>
      </div>
      <form className="sp-form" onSubmit={submit}>
        {clarify.questions.map((q) => (
          <fieldset key={q.id} className="sp-question">
            <legend className="sp-question__text">{q.text}</legend>
            {q.options?.length ? (
              <div className="sp-question__options">
                {[...q.options, OTHER].map((opt) => (
                  <label key={opt} className="sp-choice" data-checked={picked[q.id] === opt || undefined}>
                    <input
                      type="radio"
                      name={q.id}
                      value={opt}
                      checked={picked[q.id] === opt}
                      onChange={() => setPicked((p) => ({ ...p, [q.id]: opt }))}
                    />
                    <span className="sp-choice__label">{opt === OTHER ? d.clarify.other : opt}</span>
                  </label>
                ))}
              </div>
            ) : null}
            {!q.options?.length || picked[q.id] === OTHER ? (
              <TextField
                label={q.options?.length ? d.clarify.other : q.text}
                placeholder={d.clarify.otherPlaceholder}
                value={other[q.id] ?? ""}
                onChange={(e) => setOther((o) => ({ ...o, [q.id]: e.target.value }))}
              />
            ) : null}
          </fieldset>
        ))}
        {error ? <ErrorNote message={error} /> : null}
        <Button type="submit" variant="primary" size="lg" busy={busy}>
          {busy ? d.clarify.submitting : d.clarify.submit}
        </Button>
      </form>
    </Screen>
  );
}
