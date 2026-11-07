import { useEffect, useRef, type RefObject } from "react";
import { useCalm } from "../../motion/useCalm.ts";
import type { VoiceLevel } from "../../state/useLiveCall.ts";

// A level older than this means the server stopped sending; fall back to word pulses.
const LEVEL_STALE_MS = 400;

// A dot grid that shows the call's voice, for people who can't hear it.
// Energy comes from the side that is talking (callee left, Spoken right) and
// swells with every word that arrives, rippling outward and decaying between
// words. When the speaker changes, the energy's origin springs across the grid
// like a wave. Loudness comes from the server's `level` events (~15 Hz RMS);
// when none have arrived recently (mock mode, older server) arriving words stand
// in for amplitude. Drawn on a canvas so 210 dots cost one paint per frame.

const COLS = 30;
const ROWS = 7;
const GAP_RATIO = 0.42; // gap as a share of a dot's size

interface Dot {
  col: number;
  row: number;
  centre: number;
  phase: number;
}

const DOTS: Dot[] = Array.from({ length: COLS * ROWS }, (_, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return {
    col,
    row,
    centre: 1 - Math.abs(row - (ROWS - 1) / 2) / ((ROWS - 1) / 2),
    phase: ((col * 37 + row * 91) % 100) / 100,
  };
});

export function VoiceField({
  speaking,
  pulse,
  level,
}: {
  speaking: "callee" | "agent" | "none";
  pulse: number;
  level?: RefObject<VoiceLevel | null>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const calm = useCalm();
  // Mutable animation state lives in a ref: the loop must not re-render React.
  // In calm mode there is no loop, so redraw a still frame when the speaker changes.
  const redrawKey = calm ? speaking : "live";
  const sim = useRef({ level: 0, origin: 0, velocity: 0, target: 0, lastPulse: pulse, kick: 0 });

  // A new word: kick the envelope, unless real loudness is driving it.
  useEffect(() => {
    const s = sim.current;
    const live = level?.current && performance.now() - level.current.receivedAt < LEVEL_STALE_MS;
    if (pulse > s.lastPulse && !live) {
      s.level = Math.min(1, s.level + 0.42 + Math.random() * 0.2);
      s.kick = performance.now();
    }
    s.lastPulse = pulse;
  }, [pulse]);

  useEffect(() => {
    if (speaking !== "none") sim.current.target = speaking === "callee" ? 0 : 1;
  }, [speaking]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    let ink = "#fff";
    let idle = 0.13;
    let w = 0;
    let h = 0;
    let size = 0;
    let gap = 0;

    const readTheme = () => {
      const cs = getComputedStyle(el);
      ink = cs.getPropertyValue("--color-text").trim() || "#fff";
      idle = Number(cs.getPropertyValue("--dot-idle")) || 0.13;
    };
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = el.clientWidth;
      size = w / (COLS + (COLS - 1) * GAP_RATIO);
      gap = size * GAP_RATIO;
      h = ROWS * size + (ROWS - 1) * gap;
      el.style.height = `${h}px`;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      readTheme();
    };

    let last = performance.now();
    const draw = (now: number) => {
      const s = sim.current;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const real = level?.current && now - level.current.receivedAt < LEVEL_STALE_MS ? level.current : null;
      if (real) {
        // Real loudness: follow the side that is talking, rise fast, fall slower.
        s.target = real.who === "callee" ? 0 : 1;
        const goal = Math.min(1, real.rms * 2.2);
        const rate = goal > s.level ? 18 : 5;
        s.level += (goal - s.level) * (1 - Math.exp(-dt * rate));
        // Rings leave the origin on loud onsets, like word kicks do in fallback.
        if (goal - s.level > 0.25 && now - s.kick > 180) s.kick = now;
      }
      if (calm) {
        s.origin = s.target;
        s.level = real ? Math.min(1, real.rms * 2.2) : speaking === "none" ? 0 : 0.55;
      } else {
        // Envelope decays between words; a critically-damped-ish spring moves the origin.
        if (!real) s.level *= Math.exp(-dt * 2.6);
        const force = (s.target - s.origin) * 90 - s.velocity * 14;
        s.velocity += force * dt;
        s.origin += s.velocity * dt;
      }
      const t = now / 1000;
      const sinceKick = (now - s.kick) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = ink;
      for (const d of DOTS) {
        const reach = d.col / (COLS - 1);
        const dist = Math.abs(reach - s.origin);
        const near = Math.max(0, 1 - dist * 1.35);
        const shape = near * near * (0.3 + 0.7 * d.centre);
        // A ring leaves the origin on each word; dots light as it passes.
        const ring = calm ? 0 : Math.exp(-((dist - sinceKick * 1.6) ** 2) / 0.006) * Math.exp(-sinceKick * 2);
        const shimmer = calm ? 0.8 : 0.6 + 0.4 * Math.sin(t * 9 - dist * 16 + d.phase * 6.28);
        const breathe = calm ? 0 : 0.035 * Math.sin(t * 1.4 + d.phase * 6.28);
        const a = Math.min(1, idle + breathe + s.level * shape * shimmer * 0.95 + ring * 0.5 * (0.4 + 0.6 * d.centre));
        ctx.globalAlpha = a;
        const x = d.col * (size + gap);
        const y = d.row * (size + gap);
        ctx.beginPath();
        ctx.roundRect(x, y, size, size, size * 0.28);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!calm) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (calm) draw(performance.now());
    });
    ro.observe(el);
    // Theme switches change --color-text on <html>.
    const mo = new MutationObserver(readTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-contrast"] });
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
    };
  }, [calm, redrawKey, speaking]);

  return <canvas ref={canvas} className="sp-voice" data-speaking={speaking} aria-hidden="true" />;
}
