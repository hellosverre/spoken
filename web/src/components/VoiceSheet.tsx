"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'button:not([disabled]),[href],input,select,textarea,[tabindex]:not([tabindex="-1"])';

/**
 * The voice picker's bottom sheet. Same look as the app's other sheets (.scrim/.page), plus what
 * a modal needs: Esc and the close button dismiss, Tab stays inside, focus returns to the row.
 */
export function VoiceSheet({ title, closeLabel, onClose, children }: {
  title: string;
  closeLabel: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const opener = document.activeElement as HTMLElement | null;
    el.querySelector<HTMLElement>(".vs-body button")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el.addEventListener("keydown", onKey);
    return () => { el.removeEventListener("keydown", onKey); opener?.focus?.({ preventScroll: true }); };
  }, [onClose]);

  return createPortal(
    <>
      <div className="scrim on" onClick={onClose} />
      <div className="page" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="page-head pad">
          <div className="side" />
          <h2 id={titleId}>{title}</h2>
          <div className="side right">
            <button type="button" className="headbtn strong" onClick={onClose}>{closeLabel}</button>
          </div>
        </header>
        <div className="page-body pad vs-body">{children}</div>
      </div>
    </>,
    document.getElementById("device") ?? document.body,
  );
}
