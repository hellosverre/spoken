"use client";

import { useCopy, useStore } from "@/lib/use-spoken";
import { Wordmark } from "./Icon";

/** Left-hand panel shown next to the phone on wide screens. */
export function Pitch() {
  const store = useStore();
  const t = useCopy();
  const facts = [
    [t.f1t, t.f1s],
    [t.f2t, t.f2s],
    [t.f3t, t.f3s],
  ];

  return (
    <aside className="pitch" aria-label="About Spoken">
      <div className="pitch-top">
        <Wordmark />
        <span className="meta">EN / NO · Beta</span>
      </div>
      <h1>
        Du skriver,
        <br />
        <span>vi snakker</span>
        <i>.</i>
      </h1>
      <p className="en">{t.pitchLede}</p>
      <ul className="facts">
        {facts.map(([title, sub]) => (
          <li key={title}>
            <div>
              <b>{title}</b>
              <span>{sub}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="pitch-actions">
        <button className="btn primary" onClick={() => store.playDemo()}>
          {t.demo}
        </button>
        <button className="btn ghost" onClick={() => store.replay()}>
          {t.replay}
        </button>
      </div>
      <p className="foot">
        <span>{t.foot}</span>
        <span className="meta">Oslo · 59.91° N</span>
      </p>
    </aside>
  );
}
