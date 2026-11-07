import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { MOBILE_COPY, type MobileCopy } from "./copy-mobile";
import { COPY, type Copy } from "./i18n";
import { SpokenStore, type State } from "./store";

// Same hooks as web/src/lib/use-spoken.tsx.

const StoreContext = createContext<SpokenStore | null>(null);

export function SpokenProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SpokenStore());
  return <StoreContext value={store}>{children}</StoreContext>;
}

export function useStore(): SpokenStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <SpokenProvider>");
  return store;
}

/** Read one slice of state. The selector must return a value already in state. */
export function useSpoken<T>(select: (s: State) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => select(store.getSnapshot()));
}

export function useCopy(): Copy {
  return COPY[useSpoken((s) => s.lang)];
}

/** Strings only the mobile app has (login, profile, appearance). */
export function useMobileCopy(): MobileCopy {
  return MOBILE_COPY[useSpoken((s) => s.lang)];
}
