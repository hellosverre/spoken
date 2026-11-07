import { useMemo } from "react";

// A dot grid that shows who is talking, for people who can't hear it:
// energy rises from the left edge for the callee and from the right for Spoken.
// Rendering only; every visual choice lives in the theme (.sp-voice*).

const COLS = 30;
const ROWS = 7;

export function VoiceField({ speaking }: { speaking: "callee" | "agent" | "none" }) {
  const dots = useMemo(
    () =>
      Array.from({ length: COLS * ROWS }, (_, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        // 0 at the edge, 1 at the far side; the middle rows carry more energy.
        const reach = col / (COLS - 1);
        const centre = 1 - Math.abs(row - (ROWS - 1) / 2) / ((ROWS - 1) / 2);
        // Fixed pseudo-random phase so the grid shimmers instead of pulsing in sync.
        const phase = ((col * 37 + row * 91) % 100) / 100;
        return { reach, centre, phase };
      }),
    [],
  );
  return (
    <div className="sp-voice" data-speaking={speaking} aria-hidden="true" style={{ ["--cols" as string]: COLS }}>
      {dots.map((d, i) => (
        <i
          key={i}
          style={{
            ["--reach" as string]: d.reach.toFixed(3),
            ["--centre" as string]: d.centre.toFixed(3),
            ["--phase" as string]: d.phase.toFixed(2),
          }}
        />
      ))}
    </div>
  );
}
