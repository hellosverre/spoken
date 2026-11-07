import { motion, stagger, type Variants } from "motion/react";
import { Fragment } from "react";
import { spring } from "./presets.ts";

// A headline that rises word by word out of a mask: the result's "confident reveal".

const line: Variants = {
  hidden: {},
  show: (delay: number) => ({ transition: { delayChildren: stagger(0.045, { startDelay: delay }) } }),
};
const word: Variants = {
  hidden: { y: "105%" },
  show: { y: "0%", transition: spring.pop },
};

export function RevealWords({ text, className, delay = 0 }: { text: string; className?: string; delay?: number }) {
  return (
    <motion.p className={className} variants={line} custom={delay} initial="hidden" animate="show">
      <span className="sp-visually-hidden">{text}</span>
      {text.split(" ").map((w, i) => (
        <Fragment key={i}>
          <span className="sp-reveal" aria-hidden="true">
            <motion.span className="sp-reveal__word" variants={word}>
              {w}
            </motion.span>
          </span>{" "}
        </Fragment>
      ))}
    </motion.p>
  );
}
