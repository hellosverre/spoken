"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { passcode } from "@/lib/real-call";
import { useAppCopy, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Composer } from "./Composer";
import { FactStrip, type FactItem } from "./FactStrip";
import { HoldBanner } from "./HoldBanner";
import { Icon } from "./Icon";
import { ReplyChips } from "./ReplyChips";

/* Multi-call view: the chat plan named 2–3 places, so POST /api/compare starts one info-only call per place
   and this screen shows them as tabs. The selected tab is a normal call view (transcript, fact strip, hold
   banner, chips) fed by that call's own live socket. Wire types: shared/contract.ts. */

const API = process.env.NEXT_PUBLIC_SPOKEN_API ?? "";
const base = () => (API === "/" ? window.location.origin : API.replace(/\/$/, ""));

type Row = { id: string; kind: "ai" | "them" | "sys" | "you"; text: string };
interface Ask { id: string; question: string; options: string[] }
interface Leg {
  name: string; phone: string; callId: string; status: string; answer?: string; outcome?: string;
  rows: Row[]; facts: FactItem[]; holdSince: number | null; chips: string[]; ask?: Ask;
}
interface PollLeg { callId: string; status: string; answer?: string; outcome?: string }

const L = {
  no: {
    title: "Ringer samtidig", answerWait: "Venter på svar", mock: "Demo: ingen telefon ringer", err: "Kunne ikke starte samtalene.",
    results: "Resultat", book: "Bestill hos", cheapest: "Billigst", noAnswer: "Ingen svar", tabs: "Samtaler", home: "Til forsiden",
    bookText: "Bestill", ended: "Samtalen er ferdig",
    st: { queued: "Venter", dialing: "Ringer opp", ringing: "Ringer", connected: "I samtale", on_hold: "På vent", ended: "Ferdig", failed: "Feilet" } as Record<string, string>,
  },
  en: {
    title: "Calling at once", answerWait: "Waiting for an answer", mock: "Demo: no phone rings", err: "Could not start the calls.",
    results: "Result", book: "Book with", cheapest: "Cheapest", noAnswer: "No answer", tabs: "Calls", home: "Back home",
    bookText: "Book", ended: "The call has ended",
    st: { queued: "Waiting", dialing: "Dialing", ringing: "Ringing", connected: "On the call", on_hold: "On hold", ended: "Done", failed: "Failed" } as Record<string, string>,
  },
};

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const d = localStorage.getItem("spoken-device");
    if (d) h["X-Spoken-Device"] = d;
    const p = passcode();
    if (p) h["X-Spoken-Passcode"] = p;
  } catch { /* private mode: the server falls back to mock */ }
  return h;
}

const isEnded = (l: Leg) => l.status === "ended" || l.status === "failed";

/** Starts the calls, then keeps one live socket per call plus a light poll for status and answers. */
function useLegs(request: string, targets: { name: string; phone: string }[], lang: "no" | "en") {
  const [legs, setLegs] = useState<Leg[]>([]);
  const [mock, setMock] = useState(false);
  const [error, setError] = useState("");
  const sockets = useRef<Map<string, WebSocket>>(new Map());
  const rowId = useRef(0);

  const patch = useCallback((callId: string, f: (l: Leg) => Partial<Leg>) => {
    setLegs((ls) => ls.map((l) => (l.callId === callId ? { ...l, ...f(l) } : l)));
  }, []);

  useEffect(() => {
    let dead = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const upsert = (rows: Row[], row: Row) => {
      const i = rows.findIndex((r) => r.id === row.id);
      return i === -1 ? [...rows, row] : rows.map((r, j) => (j === i ? row : r));
    };

    const watch = (callId: string) => {
      const ws = new WebSocket(`${base().replace(/^http/, "ws")}/api/calls/${encodeURIComponent(callId)}/live`);
      sockets.current.set(callId, ws);
      ws.onmessage = (m) => {
        let e: any;
        try { e = JSON.parse(String(m.data)); } catch { return; }
        switch (e.type) {
          case "transcript":
            // Callee lines count once final (the batch correction reuses the id); agent lines grow clause by clause.
            if (!String(e.text).trim() || (e.who === "callee" && !e.final)) break;
            patch(callId, (l) => ({ rows: upsert(l.rows, { id: e.id, kind: e.who === "agent" ? "ai" : "them", text: String(e.text).trim() }) }));
            break;
          case "note":
            patch(callId, (l) => ({ rows: [...l.rows, { id: `n${rowId.current++}`, kind: "sys", text: e.text }] }));
            break;
          case "facts": patch(callId, () => ({ facts: e.items })); break;
          case "on_hold": patch(callId, () => ({ holdSince: e.since })); break;
          case "hold_over": patch(callId, () => ({ holdSince: null })); break;
          case "chips": patch(callId, () => ({ chips: e.items })); break;
          case "approval_request": patch(callId, () => ({ ask: { id: e.id, question: e.question, options: e.options } })); break;
          case "result": patch(callId, () => ({ ask: undefined, holdSince: null, chips: [] })); break;
        }
      };
    };

    (async () => {
      try {
        const res = await fetch(base() + "/api/compare", { method: "POST", headers: headers(), body: JSON.stringify({ text: request, lang, targets }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (dead) return;
        setMock(data.mode === "mock");
        const started: { name: string; callId: string }[] = data.legs;
        setLegs(started.map((s, i) => ({
          name: s.name, phone: targets[i]?.phone ?? "", callId: s.callId, status: "queued",
          rows: [], facts: [], holdSince: null, chips: [],
        })));
        started.forEach((s) => watch(s.callId));
        const poll = async () => {
          const r = await fetch(`${base()}/api/compare/${encodeURIComponent(data.compareId)}`).catch(() => null);
          if (!r?.ok || dead) return;
          const st = (await r.json()) as { done: boolean; legs: PollLeg[] };
          setLegs((ls) => ls.map((l) => {
            const p = st.legs.find((x) => x.callId === l.callId);
            return p ? { ...l, status: p.status, answer: p.answer, outcome: p.outcome } : l;
          }));
          if (st.done && timer) { clearInterval(timer); timer = undefined; }
        };
        await poll();
        timer = setInterval(() => void poll(), 1200);
      } catch (e) {
        if (!dead) setError((e as Error).message || L[lang].err);
      }
    })();

    const open = sockets.current;
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      open.forEach((ws) => { try { ws.close(); } catch { /* already closed */ } });
      open.clear();
    };
  }, [request, targets, lang, patch]);

  const send = useCallback((callId: string, cmd: object) => {
    const ws = sockets.current.get(callId);
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(cmd));
  }, []);

  return { legs, patch, send, mock, error };
}

/** Index of the leg with the lowest price in its answer (first number), or -1. */
function cheapestOf(legs: Leg[]): number {
  let best = -1, bestP = Infinity;
  legs.forEach((l, i) => {
    const p = Number(l.answer?.match(/\d+/)?.[0]);
    if (l.outcome === "done" && p < bestP) { bestP = p; best = i; }
  });
  return best;
}

export function MultiCall() {
  const store = useStore();
  const multi = useSpoken((s) => s.multi);
  const lang = useSpoken((s) => s.lang);
  if (!multi) return null;
  return <Multi key={multi.request + multi.targets.map((x) => x.phone).join()} request={multi.request} targets={multi.targets} lang={lang} onHome={() => store.goHome()}
    onBook={(text) => { store.goHome("chat"); store.setDraft(text); store.submitDraft(); }} />;
}

function Multi({ request, targets, lang, onHome, onBook }: {
  request: string; targets: { name: string; phone: string }[]; lang: "no" | "en"; onHome: () => void; onBook: (text: string) => void;
}) {
  const t = L[lang];
  const ct = useCopy();
  const am = useAppCopy();
  const { legs, patch, send, mock, error } = useLegs(request, targets, lang);
  const [sel, setSel] = useState(0);
  const [value, setValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const leg = legs[Math.min(sel, legs.length - 1)];
  const done = legs.length > 0 && legs.every(isEnded);
  const cheapest = done ? cheapestOf(legs) : -1;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [leg?.rows, sel]);

  const instruct = (text: string) => {
    if (!leg || !text.trim()) return;
    patch(leg.callId, (l) => ({ chips: [], rows: [...l.rows, { id: `y${Date.now()}`, kind: "you", text: text.trim() }] }));
    send(leg.callId, { type: "instruction", text: text.trim() });
  };

  /** "Book with X": a normal task for that business. Other numbers are removed so it stays a single call. */
  const book = (l: Leg) => {
    const rest = request.replace(/\+?\d[\d \-]{6,16}\d/g, "").replace(/\s*[,;]\s*(og|and)?\s*(?=[,;.]|$)/gi, "").replace(/\s{2,}/g, " ").trim();
    onBook(`${t.bookText} ${l.name}, ${l.phone}: ${rest}${l.answer ? ` (${l.answer})` : ""}`);
  };

  if (error) {
    return (
      <>
        <header className="callhead pad"><div className="tx"><h1 className="callname">{t.title}</h1></div></header>
        <div className="pad" style={{ flex: 1 }}><p role="alert">{error}</p></div>
        <div className="composer pad"><button className="btn primary block tall" onClick={onHome}><Icon name="home" />{am.backHome}</button></div>
      </>
    );
  }

  return (
    <>
      <header className="callhead pad">
        <div className="tx">
          <h1 className="callname">{t.title}</h1>
          <span className="num">{mock ? t.mock : request}</span>
        </div>
        {leg && (
          <button className="endbtn" aria-label={`${ct.endCall}: ${leg.name}`} disabled={isEnded(leg)} onClick={() => send(leg.callId, { type: "hangup" })}>
            <Icon name="hang" />
          </button>
        )}
      </header>

      <div role="tablist" aria-label={t.tabs} className="pad" style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBlock: "0.25rem 0.625rem", scrollbarWidth: "none" }}>
        {legs.map((l, i) => {
          const on = i === sel;
          const sub = l.answer ?? t.st[l.status] ?? l.status;
          return (
            <button
              key={l.callId} role="tab" id={`mc-tab-${i}`} aria-selected={on} aria-controls="mc-panel"
              aria-label={`${l.name}: ${t.st[l.status] ?? l.status}${l.answer ? `, ${l.answer}` : ""}`}
              onClick={() => setSel(i)}
              style={{
                flex: "1 0 7.5rem", minHeight: "3.5rem", minWidth: 0, textAlign: "left", padding: "0.5rem 0.75rem", borderRadius: "0.875rem",
                border: `1px solid ${on ? "var(--accent)" : "var(--line-2)"}`, background: on ? "var(--surface-2)" : "var(--surface)", color: "var(--ink)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "0.375rem", fontWeight: 510, fontSize: "0.875rem" }}>
                <span aria-hidden="true" style={{ width: "0.5rem", height: "0.5rem", borderRadius: "50%", flex: "none", background: dotColor(l) }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
              </span>
              <span style={{ display: "block", fontSize: "0.75rem", color: l.answer ? "var(--ink)" : "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{sub}</span>
            </button>
          );
        })}
      </div>

      {leg && (
        <div role="tabpanel" id="mc-panel" aria-labelledby={`mc-tab-${sel}`} style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div className="pad" style={{ paddingBottom: 0 }}>
            <span className="num" style={{ fontSize: "0.8125rem", color: "var(--dim)" }}>{leg.phone} · {t.st[leg.status] ?? leg.status}</span>
            <HoldBanner since={leg.holdSince} ended={isEnded(leg)} />
          </div>
          <FactStrip items={leg.facts} />
          <div className="scroll pad" ref={scrollRef}>
            <div className="transcript" role="log" aria-label={leg.name} aria-live="polite" aria-relevant="additions">
              {leg.rows.map((r) =>
                r.kind === "sys" ? <div key={r.id} className="sys">{r.text}</div> : (
                  <div key={r.id} className={`msg ${r.kind}`}>
                    <span className="who">{r.kind === "ai" ? am.aiLabel : r.kind === "you" ? am.youLabel : leg.name}</span>
                    <span className="txt">{r.text}</span>
                  </div>
                ),
              )}
              {leg.ask && (
                <div className="plan" role="group" aria-label={leg.ask.question} style={{ marginTop: "0.5rem" }}>
                  <p>{leg.ask.question}</p>
                  <div className="acts">
                    {leg.ask.options.map((o) => (
                      <button key={o} className="btn primary block" onClick={() => { send(leg.callId, { type: "approval_response", id: leg.ask!.id, choice: o }); patch(leg.callId, () => ({ ask: undefined })); }}>{o}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {done ? (
        <div className="composer pad" aria-label={t.results} role="group" style={{ display: "grid", gap: "0.5rem" }}>
          {legs.map((l, i) => (
            <div key={l.callId} style={{ display: "flex", alignItems: "center", gap: "0.5rem", justifyContent: "space-between" }}>
              <span style={{ minWidth: 0, fontSize: "0.875rem" }}>
                <b style={{ fontWeight: 510 }}>{l.name}</b>
                <span style={{ display: "block", color: i === cheapest ? "var(--accent)" : "var(--muted)", fontSize: "0.8125rem" }}>
                  {l.answer ?? t.noAnswer}{i === cheapest ? ` · ${t.cheapest}` : ""}
                </span>
              </span>
              {l.outcome === "done" && (
                <button className={i === cheapest ? "btn primary" : "btn ghost"} style={{ flex: "none", minHeight: "2.75rem" }} onClick={() => book(l)}>
                  {t.book} {l.name}
                </button>
              )}
            </div>
          ))}
          <button className="btn ghost block" onClick={onHome}><Icon name="home" />{t.home}</button>
        </div>
      ) : (
        <div className="composer pad">
          {leg && !isEnded(leg) ? (
            <>
              <ReplyChips aria={ct.instrAria} repeat={ct.chipRepeat} thanks={ct.chipThanks} own={leg.chips} onSend={instruct} />
              <Composer value={value} onChange={setValue} onSubmit={() => { instruct(value); setValue(""); }} placeholder={ct.instrPh} label={ct.instrAria} sendLabel={ct.sendInstr} />
            </>
          ) : (
            <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.875rem" }}>{leg ? t.ended : t.answerWait}</p>
          )}
        </div>
      )}
    </>
  );
}

function dotColor(l: Leg): string {
  if (l.status === "failed" || l.outcome === "no_answer" || l.outcome === "failed" || l.outcome === "refused") return "var(--danger, #e5484d)";
  if (isEnded(l)) return "var(--accent)";
  if (l.status === "connected" || l.status === "on_hold") return "var(--accent)";
  return "var(--dim)";
}
