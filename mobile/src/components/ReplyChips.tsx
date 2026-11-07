import { useSpoken, useStore } from "../lib/use-spoken";
import { Chip } from "./Home";

/** Suggested next instructions (tap = send). Falls back to Repeat/Thanks when there are none. */
export function ReplyChips({ repeat, thanks }: { repeat: string; thanks: string }) {
  const store = useStore();
  const items = useSpoken((s) => s.chips);
  if (items.length > 0) {
    return <>{items.map((c) => <Chip key={c} label={c} onPress={() => store.sendInstruction(c)} />)}</>;
  }
  return (
    <>
      <Chip icon="replay" label={repeat} onPress={() => store.chip("repeat")} />
      <Chip icon="heart" label={thanks} onPress={() => store.chip("thanks")} />
    </>
  );
}
