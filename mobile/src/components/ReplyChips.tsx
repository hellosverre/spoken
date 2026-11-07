import { useSpoken, useStore } from "../lib/use-spoken";
import { Chip } from "./Home";

/** Suggested next instructions (tap = send). Falls back to Repeat/Thanks when there are none. */
/** `own` + `onSend` drive it for one leg of the multi-call view instead of the store. */
export function ReplyChips({ repeat, thanks, own, onSend }: { repeat: string; thanks: string; own?: string[]; onSend?: (text: string) => void }) {
  const store = useStore();
  const shared = useSpoken((s) => s.chips);
  const items = own ?? shared;
  const send = onSend ?? ((t: string) => store.sendInstruction(t));
  if (items.length > 0) {
    return <>{items.map((c) => <Chip key={c} label={c} onPress={() => send(c)} />)}</>;
  }
  return (
    <>
      <Chip icon="replay" label={repeat} onPress={() => (onSend ? send(repeat) : store.chip("repeat"))} />
      <Chip icon="heart" label={thanks} onPress={() => (onSend ? send(thanks) : store.chip("thanks"))} />
    </>
  );
}
