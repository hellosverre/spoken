"use client";

import { useEffect, useRef, type MutableRefObject } from "react";

/** One colour pair per voice: [body, glow]. Fixed, not themed: the orb is the voice's identity. */
export const ORB_COLORS: Record<string, [string, string]> = {
  "4kCDY3HJwvO7Zp3con83": ["#FF9A5C", "#FFD36B"], // Sebastian: amber
  xF681s0UeE04gsf0mVsJ: ["#4C8DFF", "#7FE7FF"], // Olaf: clear blue
  BRY5wALXFkJsxVM6sEOH: ["#B26CFF", "#FF8AD8"], // Nadia: violet
  uNsWM1StCcpydKYOjKyu: ["#FF6B9A", "#FFB38A"], // Mia: coral pink
  ii0s2u4R3UFnxKL6DOrz: ["#35D6B0", "#C6F36B"], // Maya: mint
  OZxMHsGaBmV5pjMIDIn0: ["#5F7CFF", "#C09BFF"], // Amy: periwinkle
  OEHTkiHZj6OczWZHu0Aj: ["#2FBF9B", "#6BD0FF"], // John: teal
  Cz0K1kOv9tD8l0b5Qu53: ["#6A5BFF", "#2E1F9E"], // Jon: deep indigo
};
const FALLBACK: [string, string] = ["#7B8CFF", "#B6C2FF"];

/** A soft blurred gradient cloud. Idle: slow breathing. Playing: swells with `level` (0..1, read per frame). */
export function VoiceOrb({ voiceId, playing, level, size = 4.75, still }: {
  voiceId: string;
  playing: boolean;
  level: MutableRefObject<number>;
  size?: number;
  /** No breathing at all: for the small orb in the Profile row. */
  still?: boolean;
}) {
  const core = useRef<HTMLSpanElement>(null);
  const [a, b] = ORB_COLORS[voiceId] ?? FALLBACK;

  useEffect(() => {
    const el = core.current;
    if (!el) return;
    if (!playing || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.style.setProperty("--lvl", "0");
      return;
    }
    let raf = 0;
    let smooth = 0;
    const tick = () => {
      // Fast attack, slow release: a voice, not a flicker.
      const target = level.current;
      smooth += (target - smooth) * (target > smooth ? 0.5 : 0.12);
      el.style.setProperty("--lvl", smooth.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); el.style.setProperty("--lvl", "0"); };
  }, [playing, level]);

  return (
    <span
      ref={core}
      className="vorb"
      data-playing={playing || undefined}
      data-still={still || undefined}
      aria-hidden
      style={{ ["--a" as string]: a, ["--b" as string]: b, width: `${size}rem`, height: `${size}rem` }}
    >
      <i className="vorb-c1" />
      <i className="vorb-c2" />
      <i className="vorb-c3" />
    </span>
  );
}

/** Orb styles. Kept here so the picker is self-contained; rem units; static under reduced motion. */
export const ORB_CSS = `
.vorb{position:relative;display:block;flex:none;--lvl:0}
.vorb i{position:absolute;inset:0;display:block;border-radius:50%;filter:blur(.45rem);will-change:transform}
.vorb-c1{background:radial-gradient(circle at 35% 35%,var(--b),var(--a) 62%,transparent 78%);transform:scale(calc(.92 + var(--lvl)*.32));animation:vorb-breathe 5s ease-in-out infinite}
.vorb-c2{background:radial-gradient(circle at 70% 70%,var(--a),transparent 62%);opacity:.75;border-radius:46% 54% 52% 48%/55% 45% 55% 45%;transform:scale(calc(.78 + var(--lvl)*.5)) rotate(0deg);animation:vorb-drift 9s ease-in-out infinite}
.vorb-c3{background:radial-gradient(circle at 30% 25%,#fff,transparent 45%);opacity:calc(.28 + var(--lvl)*.4);inset:12%;filter:blur(.35rem)}
.vorb[data-still] i{animation:none!important;filter:blur(.1rem)}
.vorb[data-playing] i{animation-duration:2.4s,4s}
@keyframes vorb-breathe{0%,100%{scale:1}50%{scale:1.07}}
@keyframes vorb-drift{0%,100%{rotate:0deg;translate:0 0}50%{rotate:70deg;translate:.12rem -.1rem}}
@media (prefers-reduced-motion:reduce){.vorb i{animation:none!important}}
`;
