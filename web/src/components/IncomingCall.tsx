"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSpoken } from "@/lib/use-spoken";

/* The shop rang our number back. The server answers (server/src/call/inbound.ts) and tells this
   device through GET /api/incoming?device=<id> (204 = nothing). We poll every 3 s while the app is
   open, show a banner, and on tap relay the call live as text with the YES/NO cards. */

const API = process.env.NEXT_PUBLIC_SPOKEN_API ?? "";
const POLL_MS = 3000;

interface Incoming { callId: string; callerName: string; topic: string }
interface Line { id: string; who: "callee" | "agent"; text: string }
interface Approval { id: string; question: string; options: string[] }

const COPY = {
  no: { title: "Ringer deg tilbake", open: "Se samtalen", dismiss: "Lukk", live: "Direkte", hang: "Legg på", ended: "Samtalen er over.", them: "De", me: "Spoken", asks: "Spoken spør deg", wait: "Venter på dem …" },
  en: { title: "Calling you back", open: "View call", dismiss: "Close", live: "Live", hang: "Hang up", ended: "The call has ended.", them: "Them", me: "Spoken", asks: "Spoken asks you", wait: "Waiting for them …" },
} as const;

const origin = () => (API === "/" ? window.location.origin : API.replace(/\/$/, ""));
const device = () => { try { return localStorage.getItem("spoken-device") ?? ""; } catch { return ""; } };

export function IncomingCall() {
  const lang = useSpoken((s) => s.lang);
  const t = COPY[lang === "en" ? "en" : "no"];
  const [inc, setInc] = useState<Incoming | null>(null);
  const [open, setOpen] = useState(false);

  // Poll only when a server is configured and nothing is on screen.
  useEffect(() => {
    if (!API || typeof window === "undefined" || new URLSearchParams(window.location.search).has("scripted")) return;
    let stop = false;
    const tick = async () => {
      const d = device();
      if (!d || inc) return;
      try {
        const r = await fetch(`${origin()}/api/incoming?device=${encodeURIComponent(d)}`);
        if (!stop && r.status === 200) setInc((await r.json()) as Incoming);
      } catch { /* offline: try again next tick */ }
    };
    const id = setInterval(tick, POLL_MS);
    void tick();
    return () => { stop = true; clearInterval(id); };
  }, [inc]);

  const close = useCallback(() => { setOpen(false); setInc(null); }, []);

  if (!inc) return null;
  if (open) return <Relay inc={inc} onClose={close} />;
  return (
    <div role="alert" style={S.banner}>
      <div style={{ minWidth: 0 }}>
        <div style={S.kicker}>{t.title}</div>
        <div style={S.name}>{inc.callerName}</div>
        <div style={S.topic}>{inc.topic}</div>
      </div>
      <div style={{ display: "flex", gap: 8, flex: "none" }}>
        <button type="button" style={S.ghost} onClick={close}>{t.dismiss}</button>
        <button type="button" style={S.solid} onClick={() => setOpen(true)}>{t.open}</button>
      </div>
    </div>
  );
}

/** The live call as text: transcript lines, YES/NO cards, hang up. */
function Relay({ inc, onClose }: { inc: Incoming; onClose: () => void }) {
  const lang = useSpoken((s) => s.lang);
  const t = COPY[lang === "en" ? "en" : "no"];
  const [lines, setLines] = useState<Line[]>([]);
  const [ask, setAsk] = useState<Approval | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sock = new WebSocket(`${origin().replace(/^http/, "ws")}/api/calls/${encodeURIComponent(inc.callId)}/live`);
    ws.current = sock;
    sock.onmessage = (m) => {
      let ev: any;
      try { ev = JSON.parse(String(m.data)); } catch { return; }
      if (ev.type === "transcript" && ev.final && ev.text) {
        setLines((ls) => (ls.some((l) => l.id === ev.id) ? ls.map((l) => (l.id === ev.id ? { ...l, text: ev.text } : l)) : [...ls, { id: ev.id, who: ev.who, text: ev.text }]));
      } else if (ev.type === "approval_request") setAsk({ id: ev.id, question: ev.question, options: ev.options ?? [] });
      else if (ev.type === "result") { setAsk(null); setEnded(ev.result?.summary ?? t.ended); }
      else if (ev.type === "status" && (ev.status === "ended" || ev.status === "failed")) setEnded((e) => e ?? t.ended);
    };
    sock.onclose = () => setEnded((e) => e ?? t.ended);
    return () => sock.close();
  }, [inc.callId, t.ended]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [lines, ask, ended]);

  const send = (cmd: object) => { if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(JSON.stringify(cmd)); };

  return (
    <section role="dialog" aria-label={`${t.title}: ${inc.callerName}`} style={S.sheet}>
      <header style={S.head}>
        <div style={{ minWidth: 0 }}>
          <div style={S.kicker}>{ended ? "" : t.live}</div>
          <div style={S.name}>{inc.callerName}</div>
          <div style={S.topic}>{inc.topic}</div>
        </div>
        <button type="button" style={S.ghost} onClick={onClose}>{t.dismiss}</button>
      </header>
      <div style={S.lines} aria-live="polite">
        {lines.length === 0 && !ended && <p style={S.topic}>{t.wait}</p>}
        {lines.map((l) => (
          <p key={l.id} style={{ ...S.line, ...(l.who === "agent" ? S.mine : S.theirs) }}>
            <b style={S.who}>{l.who === "agent" ? t.me : t.them}</b>
            {l.text}
          </p>
        ))}
        {ended && <p style={S.topic}>{ended}</p>}
        <div ref={bottom} />
      </div>
      {ask && !ended && (
        <div style={S.card}>
          <div style={S.kicker}>{t.asks}</div>
          <p style={{ margin: "4px 0 12px" }}>{ask.question}</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ask.options.map((o, i) => (
              <button key={o} type="button" style={i === 0 ? S.solid : S.ghost} onClick={() => { send({ type: "approval_response", id: ask.id, choice: o }); setAsk(null); }}>{o}</button>
            ))}
          </div>
        </div>
      )}
      {!ended && <button type="button" style={{ ...S.ghost, margin: "0 16px 16px", color: "var(--danger, #f06)" }} onClick={() => send({ type: "hangup" })}>{t.hang}</button>}
    </section>
  );
}

const S: Record<string, React.CSSProperties> = {
  banner: { position: "absolute", top: 12, left: 12, right: 12, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 16, border: "1px solid var(--accent)", background: "var(--surface)", color: "var(--ink)", boxShadow: "var(--lift)" },
  sheet: { position: "absolute", inset: 0, zIndex: 60, display: "flex", flexDirection: "column", background: "var(--app)", color: "var(--ink)" },
  head: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, padding: 16, borderBottom: "1px solid var(--line)" },
  kicker: { fontSize: 12, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--accent)" },
  name: { fontSize: 17, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  topic: { fontSize: 14, color: "var(--muted, var(--ink))", margin: 0 },
  lines: { flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 },
  line: { margin: 0, padding: "8px 12px", borderRadius: 12, maxWidth: "85%", fontSize: 15 },
  mine: { alignSelf: "flex-end", background: "var(--accent-soft)" },
  theirs: { alignSelf: "flex-start", background: "var(--surface-2)" },
  who: { display: "block", fontSize: 11, opacity: 0.7, fontWeight: 600 },
  card: { margin: 16, padding: 14, borderRadius: 16, border: "1px solid var(--accent)", background: "var(--surface)" },
  solid: { minHeight: 44, padding: "0 16px", borderRadius: 12, border: 0, background: "var(--accent)", color: "var(--inv, #000)", font: "inherit", fontWeight: 600, cursor: "pointer" },
  ghost: { minHeight: 44, padding: "0 16px", borderRadius: 12, border: "1px solid var(--line-2)", background: "transparent", color: "var(--ink)", font: "inherit", cursor: "pointer" },
};
