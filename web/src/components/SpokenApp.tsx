"use client";

import { useEffect } from "react";
import { SpokenProvider, useSpoken, useStore } from "@/lib/use-spoken";
import { Call } from "./Call";
import { Home } from "./Home";
import { Intro } from "./Intro";
import { Login } from "./Login";
import { Pitch } from "./Pitch";

export function SpokenApp() {
  return (
    <SpokenProvider>
      <Stage />
    </SpokenProvider>
  );
}

function Stage() {
  const store = useStore();

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  // D = demo, R = replay intro, L = switch language. Ignored while typing or in a sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/TEXTAREA|INPUT/.test(document.activeElement?.tagName ?? "")) return;
      // Not while a preset sheet or confirm dialog is open over the screen.
      if (document.querySelector("#device .page, #device .confirm")) return;
      const k = e.key.toLowerCase();
      if (k === "d") store.playDemo();
      else if (k === "r") store.replay();
      else if (k === "l") store.toggleLang();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [store]);

  return (
    <div className="stage">
      <Pitch />
      <Device />
    </div>
  );
}

function Device() {
  const screen = useSpoken((s) => s.screen);
  const flashTick = useSpoken((s) => s.flashTick);

  return (
    <main className="device" id="device">
      <Intro on={screen === "intro"} />
      <Login on={screen === "login"} />
      <Home on={screen === "home"} />
      <Call on={screen === "call"} />
      {flashTick > 0 && <span key={flashTick} className="flash-ring" aria-hidden="true" />}
    </main>
  );
}
