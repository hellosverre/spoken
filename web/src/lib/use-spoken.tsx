"use client";

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { APP_COPY, type AppCopy } from "./copy-app";
import { COPY, type Copy } from "./i18n";
import { SpokenStore, type State } from "./store";

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
  return useSyncExternalStore(
    store.subscribe,
    () => select(store.getSnapshot()),
    () => select(store.getServerSnapshot()),
  );
}

export function useCopy(): Copy {
  return COPY[useSpoken((s) => s.lang)];
}

/** Strings that came with the phone UI (login, profile, presets). */
export function useAppCopy(): AppCopy {
  return APP_COPY[useSpoken((s) => s.lang)];
}

export const cx = (...parts: (string | false | null | undefined | 0)[]) => parts.filter(Boolean).join(" ");
