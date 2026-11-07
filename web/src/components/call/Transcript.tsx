import { Fragment, useEffect, useRef, useState } from "react";
import { useT } from "../../i18n/useT.ts";
import type { LiveLine } from "../../state/useLiveCall.ts";

// Under this confidence a word renders as unsure (grey). Matches the contract note.
export const UNSURE_BELOW = 0.6;

export function Transcript({
  lines,
  calleeName,
  agentTyping,
}: {
  lines: LiveLine[];
  calleeName: string;
  agentTyping: boolean;
}) {
  const { d } = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  // Follow new words, unless the user has scrolled up to reread.
  useEffect(() => {
    const el = scroller.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [lines, agentTyping, pinned]);

  // The approval card and notes shrink this box; stay on the newest line when that happens.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pinned) return;
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pinned]);

  const lastFinal = [...lines].reverse().find((l) => l.final);

  return (
    <div className="sp-transcript">
      <div
        ref={scroller}
        className="sp-transcript__scroll"
        role="log"
        aria-label={d.call.transcriptLabel}
        aria-live="off"
        tabIndex={0}
        onScroll={(e) => {
          const el = e.currentTarget;
          setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
        }}
      >
        {lines.length === 0 ? <p className="sp-transcript__empty">{d.call.waiting}</p> : null}
        {lines.map((line, i) => (
          <article
            key={line.id}
            className="sp-line"
            data-who={line.who}
            data-final={line.final || undefined}
            data-recent={i >= lines.length - 2 || undefined}
          >
            <p className="sp-line__who">{line.who === "agent" ? d.call.you : calleeName}</p>
            <p className="sp-line__text">
              {line.words.map((w, j) => (
                <Fragment key={j}>
                  <span className="sp-word" data-unsure={w.confidence < UNSURE_BELOW || undefined}>
                    {w.text}
                  </span>{" "}
                </Fragment>
              ))}
              {!line.final ? <span className="sp-caret" aria-hidden="true" /> : null}
            </p>
          </article>
        ))}
        {agentTyping ? (
          <p className="sp-typing" data-who="agent">
            <span className="sp-typing__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span>{d.call.agentTyping}</span>
          </p>
        ) : null}
      </div>
      {/* Only finished sentences are announced, so screen readers aren't flooded by partial words. */}
      <p className="sp-visually-hidden" aria-live="polite">
        {lastFinal ? `${lastFinal.who === "agent" ? d.call.you : calleeName}: ${lastFinal.text}` : ""}
      </p>
    </div>
  );
}
