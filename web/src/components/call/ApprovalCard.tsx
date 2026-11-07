import { motion, stagger, type Variants } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { useT } from "../../i18n/useT.ts";
import { spring } from "../../motion/presets.ts";
import { useCalm } from "../../motion/useCalm.ts";
import type { Approval } from "../../state/useLiveCall.ts";
import { Button } from "../ui.tsx";

// The JA / NEI moment. The AI holds the line («Et øyeblikk…») until one is pressed.
// Entrance: the takeover springs open as a circle from the bottom edge, the
// question lands with an overshoot, then JA and NEI rise one after the other.

const sheet: Variants = {
  hidden: { clipPath: "circle(0% at 50% 100%)" },
  show: {
    clipPath: "circle(150% at 50% 100%)",
    transition: { ...spring.drama, delayChildren: stagger(0.07, { startDelay: 0.12 }) },
  },
  exit: { clipPath: "circle(0% at 50% 100%)", transition: { duration: 0.32, ease: [0.4, 0, 1, 1] } },
};

const calmSheet: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.2, delayChildren: stagger(0.04) } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 40, scale: 0.9 },
  show: { opacity: 1, y: 0, scale: 1, transition: spring.pop },
};

export function ApprovalCard({
  approval,
  context,
  onChoose,
}: {
  approval: Approval;
  /** What the other side just said, so the question has its source next to it. */
  context?: string;
  onChoose(choice: string): void;
}) {
  const { d } = useT();
  const calm = useCalm();
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus({ preventScroll: true });
  }, [approval.id]);

  const twoWay = approval.options.length === 2;
  return (
    <motion.section
      className="sp-approval"
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={`${titleId}-hold`}
      variants={calm ? calmSheet : sheet}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      <motion.p className="sp-approval__label" variants={rise}>
        {d.call.approvalLabel}
      </motion.p>
      <motion.h2 id={titleId} className="sp-approval__question" variants={rise}>
        {approval.question}
      </motion.h2>
      {context ? (
        <motion.blockquote className="sp-approval__context" lang="nb" variants={rise}>
          «{context}»
        </motion.blockquote>
      ) : null}
      <motion.p id={`${titleId}-hold`} className="sp-approval__hold" variants={rise}>
        <span className="sp-hold-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        {d.call.approvalHold}
      </motion.p>
      <div className="sp-approval__options" data-count={approval.options.length}>
        {approval.options.map((opt, i) => (
          <motion.div key={opt} variants={rise}>
            <Button
              ref={i === 0 ? first : undefined}
              size="xl"
              variant={twoWay ? (i === 0 ? "yes" : "no") : "secondary"}
              onClick={() => onChoose(opt)}
            >
              {opt}
            </Button>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
}
