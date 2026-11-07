"use client";

import { useEffect, useRef, useState } from "react";
import { useSpoken, useStore } from "@/lib/use-spoken";

/* Compare: ask 2–3 places the same question at once (server: POST /api/compare), then book one.
   Self-contained: own fetch, polling GET /api/compare/:id every 1.2 s. Wire types: shared/contract.ts. */

const API = process.env.NEXT_PUBLIC_SPOKEN_API ?? "";
const base = () => (API === "/" ? window.location.origin : API.replace(/\/$/, ""));

interface Leg { name: string; phone: string; callId: string; status: string; answer?: string; outcome?: string; lastLine?: string }
interface State { compareId: string; mode: "real" | "mock"; done: boolean; legs: Leg[] }

const L = {
  no: {
    entry: "Sammenlign 3 steder", entrySub: "Spoken ringer alle samtidig og spør om pris og tid",
    title: "Sammenlign", req: "Hva vil du ha?", reqDef: "Billigste store pepperoni, hentes i kveld",
    name: "Navn", phone: "Telefon", go: "Ring alle", close: "Lukk", again: "Ny sammenligning",
    book: "Bestill hos", result: "Resultat", place: "Sted", answer: "Svar", wait: "Venter …", mock: "Demo: ingen telefon ringer",
    noAnswer: "Ingen svar", err: "Kunne ikke starte.",
    st: { queued: "Venter", dialing: "Ringer opp", ringing: "Ringer", connected: "I samtale", on_hold: "På vent", ended: "Ferdig", failed: "Feilet" } as Record<string, string>,
  },
  en: {
    entry: "Compare 3 places", entrySub: "Spoken calls them all at once and asks price and time",
    title: "Compare", req: "What do you want?", reqDef: "Cheapest large pepperoni, pickup tonight",
    name: "Name", phone: "Phone", go: "Call all", close: "Close", again: "New comparison",
    book: "Book with", result: "Result", place: "Place", answer: "Answer", wait: "Waiting …", mock: "Demo: no phone rings",
    noAnswer: "No answer", err: "Could not start.",
    st: { queued: "Waiting", dialing: "Dialing", ringing: "Ringing", connected: "On the call", on_hold: "On hold", ended: "Done", failed: "Failed" } as Record<string, string>,
  },
};

const DEFAULTS = [
  { name: "Pizzabakeren", phone: "+4722000001" },
  { name: "Dolce Vita", phone: "+4722000002" },
  { name: "Peppes Pizza", phone: "+4722000003" },
];

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  try {
    const d = localStorage.getItem("spoken-device");
    if (d) h["X-Spoken-Device"] = d;
    const p = localStorage.getItem("spoken-passcode");
    if (p) h["X-Spoken-Passcode"] = p;
  } catch { /* private mode: the server falls back to mock */ }
  return h;
}

/** The Home entry card; opens the Compare screen over the app. */
export function CompareEntry() {
  const lang = useSpoken((s) => s.lang);
  const t = L[lang];
  const [open, setOpen] = useState(false);
  if (!API) return null; // scripted-only build: no server to call
  return (
    <>
      <button className="pcard" style={{ width: "100%", textAlign: "left", marginTop: "0.75rem", padding: "0.875rem 1rem" }} onClick={() => setOpen(true)}>
        <b style={{ display: "block" }}>{t.entry}</b>
        <span style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>{t.entrySub}</span>
      </button>
      {open && <Compare onClose={() => setOpen(false)} />}
    </>
  );
}

export function Compare({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const lang = useSpoken((s) => s.lang);
  const t = L[lang];
  const [text, setText] = useState(t.reqDef);
  const [targets, setTargets] = useState(DEFAULTS);
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function start() {
    setBusy(true); setError("");
    try {
      const res = await fetch(base() + "/api/compare", { method: "POST", headers: headers(), body: JSON.stringify({ text, lang, targets }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const id: string = data.compareId;
      const poll = async () => {
        const r = await fetch(`${base()}/api/compare/${id}`);
        if (!r.ok) return;
        const s = (await r.json()) as State;
        setState(s);
        if (s.done && timer.current) { clearInterval(timer.current); timer.current = null; }
      };
      await poll();
      timer.current = setInterval(() => void poll(), 1200);
    } catch (e) {
      setError((e as Error).message || t.err);
    } finally { setBusy(false); }
  }

  function book(l: Leg) {
    // A normal task for that business: the existing chat flow with the request prefilled.
    store.setDraft(`${text} — ${l.name}, ${l.phone}`);
    store.setTab("chat");
    store.submitDraft();
    onClose();
  }

  const ended = (l: Leg) => l.status === "ended" || l.status === "failed";
  const cheapest = state?.done ? cheapestOf(state.legs) : -1;

  return (
    <div role="dialog" aria-modal="true" aria-label={t.title}
      style={{ position: "absolute", inset: 0, zIndex: 40, background: "var(--app)", display: "flex", flexDirection: "column" }}>
      <header className="topbar pad" style={{ justifyContent: "space-between" }}>
        <b>{t.title}</b>
        <button className="btn ghost" onClick={onClose}>{t.close}</button>
      </header>
      <div className="scroll pad" style={{ display: "flex", flexDirection: "column", gap: "0.75rem", paddingBottom: "1.5rem" }}>
        {!state && (
          <>
            <label className="field-l" htmlFor="cmp-text">{t.req}</label>
            <textarea id="cmp-text" value={text} onChange={(e) => setText(e.target.value)} rows={2}
              style={{ background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: "0.625rem", padding: "0.625rem", color: "var(--ink)", font: "inherit" }} />
            {targets.map((x, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem" }}>
                <input aria-label={`${t.name} ${i + 1}`} value={x.name} onChange={(e) => setTargets(targets.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))}
                  style={inputStyle} />
                <input aria-label={`${t.phone} ${i + 1}`} value={x.phone} inputMode="tel" onChange={(e) => setTargets(targets.map((y, j) => (j === i ? { ...y, phone: e.target.value } : y)))}
                  style={inputStyle} />
              </div>
            ))}
            {error && <p role="alert" style={{ color: "var(--danger, #e5484d)" }}>{error}</p>}
            <button className="btn primary block tall" disabled={busy || !text.trim()} onClick={() => void start()}>{t.go}</button>
          </>
        )}
        {state && (
          <>
            {state.mode === "mock" && <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>{t.mock}</p>}
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }} aria-live="polite">
              {state.legs.map((l) => (
                <li key={l.callId} style={{ border: "1px solid var(--line-2)", background: "var(--surface)", borderRadius: "0.75rem", padding: "0.75rem 0.875rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <b>{l.name}</b>
                    <span style={{ color: ended(l) ? "var(--accent)" : "var(--muted)", fontSize: "0.8125rem" }}>{t.st[l.status] ?? l.status}</span>
                  </div>
                  <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem", minHeight: "1.2em" }}>{l.lastLine ? `“${l.lastLine}”` : ""}</p>
                  {l.answer && <p style={{ margin: "0.25rem 0 0" }}><b>{l.answer}</b></p>}
                </li>
              ))}
            </ul>
            {state.done && (
              <>
                <h3 className="field-l" style={{ marginTop: "0.5rem" }}>{t.result}</h3>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "var(--muted)", fontSize: "0.8125rem" }}><th scope="col">{t.place}</th><th scope="col">{t.answer}</th><th scope="col"><span className="sr-only" style={srOnly}>{t.book}</span></th></tr>
                  </thead>
                  <tbody>
                    {state.legs.map((l, i) => (
                      <tr key={l.callId} style={{ borderTop: "1px solid var(--line)" }}>
                        <td style={{ padding: "0.5rem 0.25rem 0.5rem 0" }}><b>{l.name}</b></td>
                        <td style={{ padding: "0.5rem 0.25rem", color: i === cheapest ? "var(--accent)" : undefined }}>{l.answer ?? t.noAnswer}</td>
                        <td style={{ padding: "0.5rem 0", textAlign: "right" }}>
                          {l.outcome === "done" && <button className="btn primary" onClick={() => book(l)}>{t.book} {l.name}</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="btn ghost" onClick={() => setState(null)}>{t.again}</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

const inputStyle = { flex: 1, minWidth: 0, background: "var(--surface)", border: "1px solid var(--line-2)", borderRadius: "0.625rem", padding: "0.5rem 0.625rem", color: "var(--ink)", font: "inherit" } as const;
const srOnly = { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" } as const;

/** Index of the leg with the lowest price in its answer (first number), or -1. */
function cheapestOf(legs: Leg[]): number {
  let best = -1, bestP = Infinity;
  legs.forEach((l, i) => {
    const p = Number(l.answer?.match(/\d+/)?.[0]);
    if (l.outcome === "done" && p < bestP) { bestP = p; best = i; }
  });
  return best;
}
