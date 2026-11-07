import { motion, stagger, type Variants } from "motion/react";
import type { ReactNode } from "react";
import { spring } from "./presets.ts";

// A list whose children spring in one after another. `as` keeps the semantic element.

const parent: Variants = {
  hidden: {},
  show: (gap: number = 0.05) => ({ transition: { delayChildren: stagger(gap, { startDelay: 0.08 }) } }),
};

const child: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.94 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring.pop },
};

type Tag = "ul" | "ol" | "div" | "dl";

export function Stagger({ as = "ul", gap, className, children }: { as?: Tag; gap?: number; className?: string; children: ReactNode }) {
  const M = motion[as];
  return (
    <M className={className} variants={parent} custom={gap} initial="hidden" animate="show">
      {children}
    </M>
  );
}

export function StaggerItem({ as = "li", className, children, ...rest }: { as?: "li" | "div"; className?: string; children: ReactNode; [k: `data-${string}`]: unknown }) {
  const M = motion[as];
  return (
    <M className={className} variants={child} {...rest}>
      {children}
    </M>
  );
}
