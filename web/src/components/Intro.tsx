"use client";

import type { CSSProperties } from "react";
import { cx, useCopy, useSpoken, useStore } from "@/lib/use-spoken";
import { Icon, Wordmark, type IconName } from "./Icon";

const POPS: [IconName, number, number][] = [
  ["pizza", -150, -112],
  ["doctor", 0, -138],
  ["scissors", 150, -112],
  ["calendar", -150, 112],
  ["phone", 0, 138],
  ["bag", 150, 112],
];

/** Opening animation: a bubble drops in, types the tagline, icons pop around it. */
export function Intro({ on }: { on: boolean }) {
  const store = useStore();
  const t = useCopy();
  const s = useSpoken((st) => st.intro);

  const blobStyle = {
    "--bw": s.width ? `${s.width}px` : undefined,
    opacity: s.still ? 1 : undefined,
  } as CSSProperties;

  return (
    <section className={cx("screen", on && "on")} id="intro" aria-label="Intro" onClick={() => store.skipIntro()}>
      <div className="ring-pos">
        {POPS.map(([name, x, y], i) => (
          <span
            key={name}
            className={cx("pop", i % 2 && "solid", s.pops && "in")}
            style={{ "--x": `${x}px`, "--y": `${y}px`, "--d": `${i * 50}ms` } as CSSProperties}
          >
            <Icon name={name} />
          </span>
        ))}
      </div>
      <div className="blob-pos">
        <div className={cx("blob", s.drop && "drop", s.morph && "morph")} style={blobStyle}>
          <span>{s.typed}</span>
          {s.caret && <span className="caret" />}
        </div>
      </div>
      <div className={cx("intro-word", s.word && "in")}>
        <Wordmark />
        <p>{t.introSub}</p>
      </div>
      <div className="skip">{t.skip}</div>
    </section>
  );
}
