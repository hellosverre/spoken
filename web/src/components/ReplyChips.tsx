"use client";

import { useSpoken, useStore } from "@/lib/use-spoken";

/** Suggested next instructions (tap = send). Falls back to Repeat/Thanks when there are none. */
/** `own` + `onSend` drive it for one leg of the multi-call view instead of the store. */
export function ReplyChips({ aria, repeat, thanks, own, onSend }: { aria: string; repeat: string; thanks: string; own?: string[]; onSend?: (text: string) => void }) {
  const store = useStore();
  const shared = useSpoken((s) => s.chips);
  const items = own ?? shared;
  const send = onSend ?? ((t: string) => store.sendInstruction(t));
  return (
    <div className="chips" role="group" aria-label={aria}>
      {items.length > 0 ? (
        items.map((c) => (
          <button key={c} className="chip" onClick={() => send(c)}>
            {c}
          </button>
        ))
      ) : (
        <>
          <button className="chip" onClick={() => (onSend ? send(repeat) : store.chip("repeat"))}>{repeat}</button>
          <button className="chip" onClick={() => (onSend ? send(thanks) : store.chip("thanks"))}>{thanks}</button>
        </>
      )}
    </div>
  );
}
