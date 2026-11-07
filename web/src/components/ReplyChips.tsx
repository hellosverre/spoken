"use client";

import { useSpoken, useStore } from "@/lib/use-spoken";

/** Suggested next instructions (tap = send). Falls back to Repeat/Thanks when there are none. */
export function ReplyChips({ aria, repeat, thanks }: { aria: string; repeat: string; thanks: string }) {
  const store = useStore();
  const items = useSpoken((s) => s.chips);
  return (
    <div className="chips" role="group" aria-label={aria}>
      {items.length > 0 ? (
        items.map((c) => (
          <button key={c} className="chip" onClick={() => store.sendInstruction(c)}>
            {c}
          </button>
        ))
      ) : (
        <>
          <button className="chip" onClick={() => store.chip("repeat")}>{repeat}</button>
          <button className="chip" onClick={() => store.chip("thanks")}>{thanks}</button>
        </>
      )}
    </div>
  );
}
