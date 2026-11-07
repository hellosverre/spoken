import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store.tsx";

// Deaf users can't hear a ring, so important call moments are felt and seen:
// a vibration pattern, a screen flash, and a screen-reader announcement.

export type AlertKind = "connected" | "approval" | "ended";

const VIBRATION: Record<AlertKind, number[]> = {
  connected: [120, 80, 120],
  approval: [300, 120, 300, 120, 300],
  ended: [200],
};

interface AlertApi {
  notify(kind: AlertKind, message: string): void;
}

const Ctx = createContext<AlertApi | null>(null);

export function AlertProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const { vibrate, flash } = state.settings;
  const [flashKind, setFlashKind] = useState<AlertKind | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const notify = useCallback(
    (kind: AlertKind, message: string) => {
      if (vibrate && "vibrate" in navigator) navigator.vibrate(VIBRATION[kind]);
      if (flash) {
        clearTimeout(timer.current);
        setFlashKind(kind);
        timer.current = setTimeout(() => setFlashKind(null), 1400);
      }
      // Clear first so the same message is announced again.
      setAnnouncement("");
      requestAnimationFrame(() => setAnnouncement(message));
    },
    [vibrate, flash],
  );

  const api = useMemo(() => ({ notify }), [notify]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="sp-flash" data-active={flashKind ?? undefined} aria-hidden="true" />
      <div className="sp-visually-hidden" role="alert" aria-live="assertive">
        {announcement}
      </div>
    </Ctx.Provider>
  );
}

export function useAlerts(): AlertApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAlerts must be used inside <AlertProvider>");
  return v;
}
