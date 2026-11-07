import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { spring } from "../../motion/presets.ts";
import { useCalm } from "../../motion/useCalm.ts";

/**
 * The plan's "OK, call now" button shares this layoutId, so pressing it grows the
 * button into a full-screen curtain. Once the grow settles, the curtain lifts to
 * reveal the live call. Without a button to grow from (a reload), it just lifts.
 */
export function CallSurface() {
  const calm = useCalm();
  const [lifting, setLifting] = useState(false);
  const [done, setDone] = useState(false);

  // Fallback in case no layout animation runs (direct load): lift after a beat.
  useEffect(() => {
    const t = setTimeout(() => setLifting(true), 700);
    return () => clearTimeout(t);
  }, []);

  if (calm || done) return null;
  // Portaled to <body>: the call page fades and slides in, and the curtain must not.
  return createPortal(
    <motion.div
      layoutId="call-surface"
      layoutCrossfade={false}
      className="sp-call-surface"
      aria-hidden="true"
      style={{ borderRadius: 0 }}
      transition={spring.page}
      initial={{ opacity: 1 }}
      animate={lifting ? { opacity: 0, transition: { duration: 0.45, ease: [0.4, 0, 0.2, 1] } } : { opacity: 1 }}
      onLayoutAnimationComplete={() => setLifting(true)}
      onAnimationComplete={() => lifting && setDone(true)}
    />,
    document.body,
  );
}
