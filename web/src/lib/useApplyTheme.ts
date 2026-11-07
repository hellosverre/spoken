import { useEffect, useState } from "react";
import { htmlLang } from "../i18n/index.ts";
import { useStore } from "../state/store.tsx";

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

/**
 * Mirrors settings onto <html> as data attributes. tokens.css keys every
 * theme, contrast, text size and motion choice off these, so the design layer
 * never needs to know about React state.
 */
export function useApplyTheme() {
  const { state } = useStore();
  const { settings, profile } = state;
  const prefersDark = useMedia("(prefers-color-scheme: dark)");
  const prefersReduced = useMedia("(prefers-reduced-motion: reduce)");
  const prefersContrast = useMedia("(prefers-contrast: more)");
  const theme = settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
  const reduced = settings.reduceMotion || prefersReduced;

  useEffect(() => {
    const el = document.documentElement;
    el.dataset.theme = theme;
    el.dataset.contrast = settings.highContrast || prefersContrast ? "high" : "normal";
    el.dataset.text = settings.bigText ? "big" : "normal";
    el.dataset.motion = reduced ? "reduce" : "full";
    el.lang = htmlLang[profile.lang];
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", getComputedStyle(el).getPropertyValue("--color-bg").trim() || "#000");
  }, [theme, settings.highContrast, settings.bigText, reduced, prefersContrast, profile.lang]);

  return { theme, reduced };
}
