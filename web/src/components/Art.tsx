import type { ReactNode } from "react";
import type { PresetIcon } from "@/lib/presets";

/* The phone app's drawings (mobile/src/components/drawings) as plain SVG. One hand: rounded
   2 px strokes, flat low-opacity fills, coloured by the CSS variables in globals.css so they
   follow the theme. All decorative, so hidden from screen readers. */

const STROKE = { strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const INK = "var(--ink)";
const ACCENT = "var(--accent)";
const MUTED = "var(--muted)";
const FG = "var(--t-fg)";

function Drawing({ viewBox, className, children }: { viewBox: string; className?: string; children: ReactNode }) {
  return (
    <svg className={className} viewBox={viewBox} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

/** One half of the Duet mark at (x, y), scaled, with the stroke kept at 2 px. */
function DuetHalf({ half, x, y, scale, fill, fillOpacity, stroke }: { half: "top" | "bottom"; x: number; y: number; scale: number; fill: string; fillOpacity: number; stroke: string }) {
  const [ox, oy] = half === "top" ? [9, 18] : [20, 27];
  const d = half === "top" ? "M9 18H44C44 25 38 29 31 29H24C18 29 13 33 9 37Z" : "M55 46H20C20 39 26 35 33 35H40C46 35 51 31 55 27Z";
  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) translate(${-ox} ${-oy})`}>
      <path d={d} fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={2 / scale} strokeLinejoin="round" />
    </g>
  );
}

/* ---------- preset colours and spot drawings ---------- */

const ICON_TINT: Record<PresetIcon, string> = {
  pizza: "amber",
  doctor: "teal",
  heart: "rose",
  scissors: "violet",
  calendar: "sky",
  bag: "lime",
  phone: "accent",
  person: "accent",
};

/** Each preset icon has its own colour (data-tint in globals.css), so the grid reads at a glance. */
export const tintOf = (icon: PresetIcon) => ICON_TINT[icon];

/* The preset pictures are generated 3D illustrations in public/presets (one per PresetIcon). */
export const hasPresetArt = (icon: PresetIcon) => icon.length > 0;

export function PresetArt({ icon }: { icon: PresetIcon }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="preset-art" src={`/presets/${icon}.png`} alt="" aria-hidden="true" width={58} height={58} draggable={false} />;
}

/* ---------- big drawings ---------- */

/** The Duet mark pulled apart into the two sides of a call: your side types, Spoken's side speaks. */
export function HeroDuet({ className }: { className?: string }) {
  const amber = "var(--amber)";
  return (
    <Drawing className={className} viewBox="0 0 280 160">
      <DuetHalf half="top" x={8} y={14} scale={3} fill={INK} fillOpacity={0.06} stroke={INK} />
      {[34, 50, 66].map((cx) => (
        <circle key={cx} cx={cx} cy={30} r={4} fill={INK} />
      ))}
      <DuetHalf half="bottom" x={167} y={88} scale={3} fill={ACCENT} fillOpacity={0.18} stroke={ACCENT} />
      {[8, 16, 22, 14, 9].map((h, i) => {
        const x = 214 + i * 10;
        return <path key={x} d={`M${x} ${126 - h / 2}V${126 + h / 2}`} stroke={ACCENT} {...STROKE} strokeWidth={3} />;
      })}
      <path d="M100 44C126 44 128 74 140 80" stroke={INK} strokeOpacity={0.45} {...STROKE} strokeDasharray="1 7" fill="none" />
      <path d="M152 92C160 104 170 110 178 110" stroke={ACCENT} strokeOpacity={0.7} {...STROKE} strokeDasharray="1 7" fill="none" />
      <g transform="translate(128 70) rotate(-18) scale(1.25)">
        <rect x="-2" y="-2" width="28" height="28" rx="9" fill={ACCENT} fillOpacity={0.16} />
        <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" fill="none" stroke={ACCENT} {...STROKE} strokeWidth={1.7} />
      </g>
      <path d="M150 30v10M145 35h10" stroke={amber} {...STROKE} />
      <circle cx={250} cy={66} r={3.5} fill="none" stroke={amber} {...STROKE} />
      <circle cx={30} cy={98} r={2.5} fill={ACCENT} fillOpacity={0.6} />
    </Drawing>
  );
}

/** The call went through: the Duet halves meet around a check, with a little confetti. */
export function DoneArt() {
  return (
    <Drawing className="result-art" viewBox="0 0 120 84">
      <DuetHalf half="top" x={14} y={12} scale={1.9} fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} />
      <DuetHalf half="bottom" x={39} y={36} scale={1.9} fill={ACCENT} fillOpacity={0.14} stroke={ACCENT} />
      <circle cx={60} cy={42} r={16} fill={ACCENT} />
      <path d="M52 42.5l5.5 5.5L69 36.5" fill="none" stroke="var(--inv)" {...STROKE} strokeWidth={3} />
      <path d="M12 60l4 4M104 14l-4 4" stroke="var(--amber)" {...STROKE} />
      <circle cx={100} cy={64} r={3} fill="var(--rose)" />
      <circle cx={22} cy={14} r={2.5} fill="var(--teal)" />
      <path d="M92 34h6M95 31v6" stroke="var(--teal)" {...STROKE} />
    </Drawing>
  );
}

/** Nothing was agreed: the two halves resting apart, a quiet pause between them. */
export function NothingAgreedArt() {
  return (
    <Drawing className="result-art" viewBox="0 0 120 84">
      <DuetHalf half="top" x={6} y={14} scale={1.6} fill={INK} fillOpacity={0.06} stroke={MUTED} />
      <DuetHalf half="bottom" x={58} y={40} scale={1.6} fill={INK} fillOpacity={0.06} stroke={MUTED} />
      <circle cx={60} cy={42} r={14} fill="var(--surface-2)" stroke={MUTED} {...STROKE} />
      <path d="M56 37v10M64 37v10" stroke={MUTED} {...STROKE} strokeWidth={2.6} />
      <circle cx={98} cy={18} r={2.5} fill={MUTED} fillOpacity={0.5} />
      <circle cx={22} cy={66} r={2} fill={MUTED} fillOpacity={0.5} />
    </Drawing>
  );
}

/**
 * The empty chat's header: a typed message becomes a voice waveform and reaches a person
 * answering a call. Its lower part fades into the page and is left free for the heading.
 * The --hero-* colours are in globals.css: dark is its own set, not an inversion.
 */
export function ChatHero() {
  const line = "var(--hero-line)";
  const solid = "var(--hero-solid)";
  const skin = "var(--hero-skin)";
  return (
    <svg className="hero-art" viewBox="0 0 460 314" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="hero-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--hero-base-1)" />
          <stop offset="0.52" stopColor="var(--hero-base-2)" />
          <stop offset="0.83" stopColor="var(--app)" />
        </linearGradient>
        <linearGradient id="hero-ribbon" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--hero-ribbon-1)" />
          <stop offset="0.7" stopColor="var(--hero-ribbon-2)" />
          <stop offset="1" stopColor="var(--hero-ribbon-3)" />
        </linearGradient>
      </defs>
      <path fill="url(#hero-base)" d="M0 0h460v314H0z" />
      <path fill="url(#hero-ribbon)" d="M0 62C45 25 93 27 145 49s90 33 140 27C358 67 417 44 460 0v109c-44 7-69 33-131 33-62 0-100-14-145-13-45 1-69 15-105 14-30-1-55-14-79-24z" />
      {/* Typed request and the line carrying it into speech. */}
      <path fill="var(--hero-bubble)" d="M47 48h87a19 19 0 0 1 19 19v26a19 19 0 0 1-19 19H47a19 19 0 0 1-19-19V67a19 19 0 0 1 19-19z" />
      <g fill="none" stroke={line} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M47 48h87a19 19 0 0 1 19 19v23c10-8 22-12 34-12" />
        <path d="M153 90v3a19 19 0 0 1-19 19H47a19 19 0 0 1-19-19V67a19 19 0 0 1 19-19" />
        <path d="M252 78c14 0 21-10 33-10" />
      </g>
      <g fill="none" stroke={ACCENT} strokeLinecap="round">
        <path strokeWidth={7} d="M46 69h59M46 88h66" />
        <path strokeWidth={4} d="M126 81v15" />
        <path strokeWidth={7.5} d="M201 70v16m15-29v42m15-31v20m13-14v8" />
      </g>
      {/* A person receiving the call. */}
      <path fill={solid} d="M308 112c-17 7-27 18-34 32h120c-7-17-17-27-32-32l-13-4-28-1z" />
      <path fill={solid} d="M365 43c4-12 14-17 24-14 11 3 17 14 14 24-3 11-12 17-23 16l-16-7z" />
      <path fill={skin} stroke={line} strokeWidth={4.5} strokeLinejoin="round" d="M344 24c21 0 35 16 33 37-1 13-9 25-23 32l2 20c-6 10-21 14-32 9-7-3-10-7-11-12l5-14c-11 0-19-5-22-14l-2-9-6-4c-2-1-2-4 0-6l8-8c3-18 21-31 48-31z" />
      <path fill={solid} d="M297 55c0-22 17-39 40-39 24 0 41 12 44 31 2 15-3 27-17 34l-13-14c-19-5-33-16-37-31-6 4-12 11-17 19z" />
      <path fill="none" stroke={line} strokeWidth={3.3} strokeLinecap="round" d="M302 62c2-3 6-3 8 0m-12 17c4 2 8 2 11-1" />
      <path fill={ACCENT} stroke={line} strokeWidth={4.5} d="m354 59 15 5c4 1 5 4 4 8l-10 30c-1 4-4 5-8 4l-15-5c-4-1-5-4-4-8l10-30c1-4 4-5 8-4z" />
      <path fill={skin} stroke={line} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" d="m359 144-12-29c-2-4-3-8-2-12l3-12c1-4 4-6 7-5 3 1 4 4 3 7l-1 4c3-4 7-4 9-1l4 5c2 3 2 7 1 10l-2 5 13 28" />
    </svg>
  );
}
