"use client";

import { useEffect, useRef, useState } from "react";
import { useSpoken } from "@/lib/use-spoken";

const T = {
  no: { hold: "På vent", back: "Noen er tilbake på linjen" },
  en: { hold: "On hold", back: "A person is back on the line" },
} as const;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "On hold · 0:42" while the shop has us waiting; buzzes and announces when a person is back. */
/** since/ended override the store (the multi-call view tracks them per call). */
export function HoldBanner(o: { since?: number | null; ended?: boolean } = {}) {
  const sSince = useSpoken((s) => s.holdSince);
  const sEnded = useSpoken((s) => s.callEnded);
  const since = o.since !== undefined ? o.since : sSince;
  const ended = o.ended ?? sEnded;
  const lang = useSpoken((s) => s.lang);
  const t = T[lang === "no" ? "no" : "en"];
  const [now, setNow] = useState(() => Date.now());
  const [announce, setAnnounce] = useState("");
  const was = useRef(false);

  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  useEffect(() => {
    if (since !== null) {
      was.current = true;
      setAnnounce("");
    } else if (was.current) {
      was.current = false;
      if (ended) return; // call is over: no "back" buzz
      navigator.vibrate?.([200, 100, 200]);
      setAnnounce(t.back);
    }
  }, [since, ended, t.back]);

  return (
    <>
      {since !== null && (
        <div
          role="status"
          className="hold-banner"
          style={{ margin: "0.5rem 1rem", padding: "0.5rem 0.75rem", borderRadius: "0.75rem", border: "1px solid var(--accent, #888)", fontSize: "0.9375rem", fontVariantNumeric: "tabular-nums" }}
        >
          {t.hold} · {fmt(now - since)}
        </div>
      )}
      <div role="status" aria-live="assertive" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
        {announce}
      </div>
    </>
  );
}
