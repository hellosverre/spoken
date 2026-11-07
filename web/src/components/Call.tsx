"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { fill, type Row } from "@/lib/i18n";
import { SCENARIOS } from "@/lib/scenarios";
import type { Sheet as SheetContent } from "@/lib/store";
import { cx, useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Composer } from "./Composer";
import { Icon } from "./Icon";

export function Call({ on }: { on: boolean }) {
  return (
    <section className={cx("screen", on && "on")} id="call" aria-label="Live call">
      <CallHead />
      <div className="pad">
        <Speaker />
      </div>
      <Transcript />
      <CallComposer />
      <Sheet />
    </section>
  );
}

function useContact() {
  const scenario = useSpoken((s) => s.scenario);
  const lang = useSpoken((s) => s.lang);
  const sc = SCENARIOS[scenario];
  return { ...sc, contact: sc[lang].contact };
}

function CallHead() {
  const store = useStore();
  const t = useCopy();
  const { contact, number } = useContact();
  const pill = useSpoken((s) => s.pill);
  const elapsed = useSpoken((s) => s.elapsed);
  const callEnded = useSpoken((s) => s.callEnded);
  // No status pill in the phone UI: the state goes after the timer, in plain text.
  const status = { ringing: t.sRinging, live: "", hold: t.sHold, ended: t.sEnded }[pill];

  return (
    <header className="callhead pad">
      <div className="tx">
        <b>{contact}</b>
        <span className="num">
          {number} · <span className="timer">{elapsed}</span>
          {status && <span className="status"> · {status}</span>}
        </span>
      </div>
      <button className="endbtn" aria-label={t.endCall} disabled={callEnded} onClick={() => store.endCall()}>
        <Icon name="hang" />
      </button>
    </header>
  );
}

/** Shows who is talking right now, with a moving level meter. */
function Speaker() {
  const t = useCopy();
  const { contact, init } = useContact();
  const who = useSpoken((s) => s.speaker);
  const note = useSpoken((s) => s.speakerNote);

  const label =
    who === "them" ? fill(t.speakingThem, { name: contact })
    : who === "ai" ? t.speakingAi
    : note === "ringing" ? fill(t.ringingLbl, { name: contact })
    : note === "ended" ? t.ended
    : t.listening;

  return (
    <div className="speaker" data-who={who ?? ""}>
      <div className="pods">
        <div className={cx("pod them", who === "them" && "active")}>{init}</div>
        <div className="wave" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} />
          ))}
        </div>
        <div className={cx("pod ai", who === "ai" && "active")}>
          <span className="mark" />
        </div>
      </div>
      <div className="speaker-label" aria-live="polite">
        {label}
      </div>
    </div>
  );
}

function Transcript() {
  const t = useAppCopy();
  const { contact } = useContact();
  const lines = useSpoken((s) => s.transcript);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="scroll pad" ref={scrollRef}>
      <div className="transcript" aria-live="polite">
        {lines.map((line) => {
          if (line.kind === "sys") return <div key={line.id} className="sys">{line.text}</div>;
          if (line.kind === "you")
            return (
              <div key={line.id} className="msg you">
                <span className="who">{t.youLabel}</span>
                <span className="txt">{line.text}</span>
              </div>
            );
          return (
            <div key={line.id} className={`msg ${line.kind}`}>
              <span className="who">{line.kind === "ai" ? t.aiLabel : contact}</span>
              <span className="txt">
                {line.words.map((w, i) => (
                  <span key={i} className="w">
                    {i ? ` ${w}` : w}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CallComposer() {
  const store = useStore();
  const t = useCopy();
  const m = useAppCopy();
  const callEnded = useSpoken((s) => s.callEnded);
  const [value, setValue] = useState("");

  if (callEnded)
    return (
      <div className="composer pad">
        <button className="btn primary block tall" data-back onClick={() => store.goHome()}>
          <Icon name="home" />
          {m.backHome}
        </button>
      </div>
    );

  return (
    <div className="composer pad">
      <div className="chips">
        <button className="chip" onClick={() => store.chip("repeat")}>
          {t.chipRepeat}
        </button>
        <button className="chip" onClick={() => store.chip("thanks")}>
          {t.chipThanks}
        </button>
      </div>
      <Composer
        value={value}
        onChange={setValue}
        onSubmit={() => {
          store.sendInstruction(value);
          setValue("");
        }}
        placeholder={t.instrPh}
        label={t.instrAria}
        sendLabel={t.sendInstr}
      />
    </div>
  );
}

/* ---------- bottom sheet: approvals and results ---------- */

function Sheet() {
  const sheet = useSpoken((s) => s.sheet);
  const open = useSpoken((s) => s.sheetOpen);
  const ref = useRef<HTMLDivElement>(null);

  // Move focus to the first choice once the sheet has slid up.
  useEffect(() => {
    if (!open || sheet?.kind !== "ask") return;
    const id = setTimeout(() => ref.current?.querySelector<HTMLButtonElement>("[data-v]")?.focus({ preventScroll: true }), 450);
    return () => clearTimeout(id);
  }, [open, sheet?.kind, sheet]);

  return (
    <>
      <div className={cx("scrim", open && "on")} />
      <div
        ref={ref}
        className={cx("sheet pad", open && "open")}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheetTitle"
        aria-hidden={!open}
        inert={!open}
      >
        {sheet?.kind === "ask" && <AskSheet sheet={sheet} />}
        {sheet?.kind === "result" && <ResultSheet sheet={sheet} />}
      </div>
    </>
  );
}

function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="dl">
      {rows.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function AskSheet({ sheet }: { sheet: Extract<SheetContent, { kind: "ask" }> }) {
  const store = useStore();
  const t = useCopy();
  const { cfg, pressed } = sheet;
  const many = cfg.options.length > 1;

  return (
    <>
      <span className="flag">{t.waiting}</span>
      <h3 id="sheetTitle">{cfg.title}</h3>
      <Rows rows={cfg.rows} />
      <p className="hold">
        {t.holdSaid} <q>{cfg.hold}</q>
      </p>
      <div className="acts">
        <div className={many ? "optrow" : undefined}>
          {cfg.options.map((o) => (
            <button
              key={o.v}
              className={cx("btn primary block", pressed === o.v && "pressed")}
              data-v={o.v}
              onClick={() => store.choose(o.v)}
            >
              {!many && <Icon name="check" />}
              {o.label}
            </button>
          ))}
        </div>
        <button className="btn ghost block" data-v="no" onClick={() => store.choose("no")}>
          {cfg.decline}
        </button>
      </div>
    </>
  );
}

function ResultSheet({ sheet }: { sheet: Extract<SheetContent, { kind: "result" }> }) {
  const store = useStore();
  const t = useCopy();

  return (
    <>
      <span className={cx("badge", !sheet.ok && "neutral")}>
        <Icon name={sheet.ok ? "check" : "x"} />
      </span>
      <h3 id="sheetTitle">{sheet.title}</h3>
      <Rows rows={sheet.rows} />
      <div className="acts">
        <button className="btn primary block" data-back onClick={() => store.goHome()}>
          {t.back}
        </button>
        <button className="btn ghost block" onClick={() => store.closeSheet()}>
          {t.readT}
        </button>
      </div>
    </>
  );
}
