"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cx, useSpoken } from "@/lib/use-spoken";

// Planning questions as a bottom sheet: one question at a time, tap an option or type an answer.
// real-call.ts calls askQuestions() and awaits the answers; the sheet is mounted once in Home.
export interface PlanQuestion { id: string; text: string; options?: string[] }
interface Pending { questions: PlanQuestion[]; resolve: (answers: string[] | null) => void }

let pending: Pending | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** Resolves with one answer per question, or null if the user skips the questions. */
export function askQuestions(questions: PlanQuestion[]): Promise<string[] | null> {
  pending?.resolve(null);
  return new Promise((resolve) => {
    pending = { questions, resolve };
    emit();
  });
}

function finish(answers: string[] | null) {
  const p = pending;
  pending = null;
  emit();
  p?.resolve(answers);
}

const COPY = {
  no: { step: (i: number, n: number) => `Spørsmål ${i} av ${n}`, own: "Skriv svar", ph: "Skriv ditt eget svar", ok: "Neste", send: "Ferdig", back: "Tilbake", skip: "Hopp over", opts: "Svarvalg" },
  en: { step: (i: number, n: number) => `Question ${i} of ${n}`, own: "Type an answer", ph: "Type your own answer", ok: "Next", send: "Done", back: "Back", skip: "Skip", opts: "Answer options" },
} as const;

export function QuestionSheet() {
  const p = useSyncExternalStore(subscribe, () => pending, () => null);
  const lang = useSpoken((s) => s.lang);
  const t = COPY[lang === "en" ? "en" : "no"];
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const open = !!p;

  useEffect(() => { setStep(0); setAnswers([]); setText(""); }, [p]);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => ref.current?.querySelector<HTMLButtonElement>("[data-opt]")?.focus({ preventScroll: true }), 400);
    return () => clearTimeout(id);
  }, [open, step]);

  const qs = p?.questions ?? [];
  const q = qs[step];
  const last = step >= qs.length - 1;

  function pick(value: string) {
    const v = value.trim();
    if (!v || !p) return;
    const next = [...answers.slice(0, step), v];
    setText("");
    if (last) finish(next);
    else { setAnswers(next); setStep(step + 1); }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className={cx("scrim", open && "on")} aria-hidden="true" onClick={() => finish(null)} />
      <div
        ref={ref}
        className={cx("sheet pad qsheet", open && "open")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qTitle"
        aria-hidden={!open}
        inert={!open}
      >
        {q && (
          <>
            <div className="qtop">
              <button type="button" className="qback" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} aria-label={t.back}>
                ‹ {t.back}
              </button>
              <div className="qdots" role="img" aria-label={t.step(step + 1, qs.length)}>
                {qs.map((_, i) => <i key={i} data-on={i <= step || undefined} />)}
              </div>
              <button type="button" className="qback" onClick={() => finish(null)}>{t.skip}</button>
            </div>
            <h3 id="qTitle" aria-live="polite">{q.text}</h3>
            <div className="qopts" role="group" aria-label={t.opts}>
              {q.options?.map((o) => (
                <button key={o} type="button" data-opt className={cx("btn ghost", answers[step] === o && "qsel")} onClick={() => pick(o)}>
                  {o}
                </button>
              ))}
            </div>
            <form className="qown" onSubmit={(e) => { e.preventDefault(); pick(text); }}>
              <input
                className="input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t.ph}
                aria-label={t.own}
                enterKeyHint={last ? "done" : "next"}
              />
              <button type="submit" className="btn primary" disabled={!text.trim()}>{last ? t.send : t.ok}</button>
            </form>
          </>
        )}
      </div>
    </>
  );
}

const CSS = `
.qsheet{gap:0.875rem}
.qtop{display:flex;align-items:center;justify-content:space-between;gap:0.5rem}
.qback{min-height:2.75rem;padding:0 0.5rem;color:var(--muted);font-size:0.9375rem}
.qback:disabled{opacity:.35}
.qdots{display:flex;gap:0.375rem}
.qdots i{width:0.5rem;height:0.5rem;border-radius:50%;background:var(--line-2)}
.qdots i[data-on]{background:var(--accent)}
.qopts{display:grid;grid-template-columns:1fr 1fr;gap:0.5rem}
.qopts .btn{min-height:3.25rem;font-size:1rem}
.qopts .qsel{border-color:var(--accent)}
.qown{display:flex;gap:0.5rem}
.qown .input{flex:1;min-width:0}
`;
