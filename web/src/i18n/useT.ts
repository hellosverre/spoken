import { useStore } from "../state/store.tsx";
import { dictionaries, fmt } from "./index.ts";

/** Current dictionary plus the formatter. Usage: const { d, fmt } = useT(); d.home.title */
export function useT() {
  const { state } = useStore();
  const lang = state.profile.lang;
  return { d: dictionaries[lang], fmt, lang };
}
