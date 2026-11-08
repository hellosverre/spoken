"use client";

import { useState } from "react";
import { fill } from "@/lib/i18n";
import { formatWhen, type CallRecord } from "@/lib/history";
import type { AppCopy } from "@/lib/copy-app";
import { useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Icon } from "./Icon";
import { Confirm, HeadButton, PageSheet } from "./ui";

/**
 * Profile → Call history: every finished call (who, when, outcome) with a button to read its
 * transcript, which opens in the same sheet. Saved in this browser only. As the app's History.tsx.
 */
export function HistorySheet({ onClose }: { onClose(): void }) {
  const store = useStore();
  const m = useAppCopy();
  const history = useSpoken((s) => s.history);
  const [selected, setSelected] = useState<CallRecord | null>(null);
  const [confirm, setConfirm] = useState<"all" | "one" | null>(null);

  const dialog =
    confirm === "all" ? (
      <Confirm
        title={m.deleteAllQ}
        body={m.historyLocal}
        cancel={m.cancel}
        confirm={m.deleteAll}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          store.clearHistory();
          setConfirm(null);
        }}
      />
    ) : confirm === "one" && selected ? (
      <Confirm
        title={m.deleteCallQ}
        body={selected.contact}
        cancel={m.cancel}
        confirm={m.deleteCall}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          store.deleteCall(selected.id);
          setSelected(null);
          setConfirm(null);
        }}
      />
    ) : null;

  if (selected) {
    return (
      <PageSheet
        key="transcript"
        title={m.transcriptH}
        onClose={onClose}
        left={<HeadButton label={`‹ ${m.back}`} onClick={() => setSelected(null)} />}
        right={<HeadButton label={m.close} onClick={onClose} strong />}
      >
        <TranscriptView call={selected} onDelete={() => setConfirm("one")} />
        {dialog}
      </PageSheet>
    );
  }

  return (
    <PageSheet
      key="list"
      title={m.historyH}
      onClose={onClose}
      left={<HeadButton label={m.close} onClick={onClose} />}
      right={history.length ? <HeadButton label={m.deleteAll} onClick={() => setConfirm("all")} /> : undefined}
    >
      <div className="hist">
        {history.length ? (
          <ul className="hist-list">
            {history.map((c) => (
              <li key={c.id}>
                <CallCard call={c} onOpen={() => setSelected(c)} />
              </li>
            ))}
          </ul>
        ) : (
          <Empty />
        )}
        <p className="hist-local">{m.historyLocal}</p>
      </div>
      {dialog}
    </PageSheet>
  );
}

function CallCard({ call, onOpen }: { call: CallRecord; onOpen(): void }) {
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  return (
    <article className="hcard">
      <div className="hcard-top">
        <span className={call.ok ? "hbadge ok" : "hbadge fail"} aria-hidden>
          <Icon name={call.ok ? "check" : "x"} />
        </span>
        <div className="hcard-tx">
          <b>{call.contact}</b>
          <span>
            {formatWhen(call.at, lang)}
            {call.number ? ` · ${call.number}` : ""}
          </span>
        </div>
        {call.scripted && <span className="htag">{m.demoTag}</span>}
      </div>
      {/* Done / not done in words as well as the colour and the icon. */}
      <p className="hcard-out">
        <span className={call.ok ? "ok" : "fail"}>{call.ok ? m.done2 : m.notDone}</span>
        <span>{call.title}</span>
      </p>
      <button type="button" className="btn ghost block" onClick={onOpen}>
        <Icon name="bubble" />
        {m.viewTranscript}
      </button>
    </article>
  );
}

/** One call: who and when, the result rows, then every line of the conversation. */
function TranscriptView({ call, onDelete }: { call: CallRecord; onDelete(): void }) {
  const t = useCopy();
  const m = useAppCopy();
  const lang = useSpoken((s) => s.lang);
  return (
    <div className="hist">
      <div>
        <h3 className="hist-h">{call.contact}</h3>
        <p className="help">
          {formatWhen(call.at, lang)}
          {call.number ? ` · ${call.number}` : ""}
          {call.scripted ? ` · ${m.demoTag}` : ""}
        </p>
      </div>

      <div className="hresult">
        <b>{call.title}</b>
        {call.rows.length > 0 && (
          <dl className="dl">
            {call.rows.map(([k, v]) => (
              <div key={k} style={{ display: "contents" }}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="transcript" lang={lang === "no" ? "nb" : "en"}>
        {call.lines.map((l, i) => {
          if (l.who === "sys")
            return (
              <p key={i} className="sys">
                {l.text}
              </p>
            );
          const who = l.who === "ai" ? m.aiLabel : l.who === "you" ? m.youLabel : call.contact;
          return (
            <div key={i} className={`msg ${l.who}`}>
              <span className="who">{who}</span>
              <div className="txt">{l.text}</div>
            </div>
          );
        })}
        {call.lines.length === 0 && <p className="sys">{t.ended}</p>}
      </div>

      <button type="button" className="deleterow" onClick={onDelete}>
        <Icon name="trash" />
        {m.deleteCall}
      </button>
    </div>
  );
}

function Empty() {
  const m = useAppCopy();
  return (
    <div className="hist-empty">
      <span className="tile" aria-hidden>
        <Icon name="history" />
      </span>
      <b>{m.historyNone}</b>
      <p>{m.historyEmpty}</p>
    </div>
  );
}

/** "3 calls, saved in this browser" for the Profile row. */
export function historyCount(n: number, m: AppCopy): string {
  if (!n) return m.historyNone;
  return n === 1 ? m.historyOne : fill(m.historyCount, { n: String(n) });
}
