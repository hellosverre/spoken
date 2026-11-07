import { useEffect, useId, useRef } from "react";
import { useT } from "../../i18n/useT.ts";
import type { Approval } from "../../state/useLiveCall.ts";
import { Button } from "../ui.tsx";

/** The JA / NEI moment. The AI waits on the line until one is pressed. */
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
  const titleId = useId();
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    first.current?.focus();
  }, [approval.id]);

  const twoWay = approval.options.length === 2;
  return (
    <section className="sp-approval" role="alertdialog" aria-labelledby={titleId} aria-describedby={`${titleId}-hold`}>
      <p className="sp-approval__label">{d.call.approvalLabel}</p>
      <h2 id={titleId} className="sp-approval__question">
        {approval.question}
      </h2>
      {context ? (
        <blockquote className="sp-approval__context" lang="nb">
          «{context}»
        </blockquote>
      ) : null}
      <p id={`${titleId}-hold`} className="sp-approval__hold">
        {d.call.approvalHold}
      </p>
      <div className="sp-approval__options" data-count={approval.options.length}>
        {approval.options.map((opt, i) => (
          <Button
            key={opt}
            ref={i === 0 ? first : undefined}
            size="xl"
            variant={twoWay ? (i === 0 ? "yes" : "no") : "secondary"}
            onClick={() => onChoose(opt)}
          >
            {opt}
          </Button>
        ))}
      </div>
    </section>
  );
}
