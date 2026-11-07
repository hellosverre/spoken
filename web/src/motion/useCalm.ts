import { useReducedMotion } from "motion/react";
import { useStore } from "../state/store.tsx";

/** True when motion should stay calm: the app setting or the OS preference. */
export function useCalm(): boolean {
  const os = useReducedMotion();
  const { state } = useStore();
  return state.settings.reduceMotion || !!os;
}
