import type { Transition, Variants } from "motion/react";

// Every spring in the app comes from here, so the feel can be tuned in one place.
// Higher stiffness = snappier; lower damping = more bounce.

export const spring = {
  /** Buttons and taps: fast, a little squash, settles at once. */
  press: { type: "spring", stiffness: 700, damping: 24, mass: 0.6 },
  /** Cards and list items arriving: visible overshoot, still quick. */
  pop: { type: "spring", stiffness: 420, damping: 22, mass: 0.8 },
  /** Page-level moves and shared-element morphs: weighty and smooth. */
  page: { type: "spring", stiffness: 260, damping: 30, mass: 1 },
  /** The approval takeover: big, decisive, one soft bounce. */
  drama: { type: "spring", stiffness: 140, damping: 20, mass: 1.1 },
} satisfies Record<string, Transition>;

export const fade: Transition = { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] };

/** Whole screens entering and leaving. Exits are quicker than entrances. */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 28, scale: 0.98 },
  enter: { opacity: 1, y: 0, scale: 1, transition: spring.page },
  exit: { opacity: 0, y: -16, scale: 0.985, pointerEvents: "none", transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } },
};

/** Squash-and-stretch on press; a small lift on hover (pointer devices only). */
export const tap = { scaleX: 1.04, scaleY: 0.9 };
export const hover = { y: -2, scale: 1.015 };
