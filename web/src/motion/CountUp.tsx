import { animate } from "motion/react";
import { useEffect, useRef } from "react";
import { useCalm } from "./useCalm.ts";

// Counts the first number in a string up from zero ("189 kr" → 0…189 kr).
// Times like "18:00" and strings without a number render as they are.

const NUMBER = /^(\D*?)(\d+)(.*)$/s;

export function CountUp({ value, delay = 0, duration = 1.1 }: { value: string; delay?: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const calm = useCalm();
  const parsed = value.includes(":") ? null : NUMBER.exec(value);
  // Counting 0 → 1 reads as a glitch; only numbers worth watching climb.
  const match = parsed && Number(parsed[2]) >= 10 ? parsed : null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !match || calm) return;
    const [, pre, num, post] = match;
    const target = Number(num);
    const controls = animate(0, target, {
      duration,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = `${pre}${Math.round(v)}${post}`;
      },
    });
    return () => controls.stop();
    // match is derived from value, so value + calm cover every change.
  }, [value, calm]);

  // Screen readers get the final value straight away; the animation is visual only.
  return (
    <>
      <span ref={ref} aria-hidden="true">
        {match && !calm ? `${match[1]}0${match[3]}` : value}
      </span>
      <span className="sp-visually-hidden">{value}</span>
    </>
  );
}
