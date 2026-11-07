import { useEffect, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { useT } from "../../i18n/useT.ts";
import { spring } from "../../motion/presets.ts";
import { Button, Icon } from "../ui.tsx";

export type Tone = "friendly" | "firm" | "hurry";

/** Mid-call steering: a message to the AI, "say it simpler", tone, and hang up. */
export function CallControls({
  disabled,
  tone,
  onInstruction,
  onSimpler,
  onTone,
  onHangup,
}: {
  disabled: boolean;
  tone: Tone;
  onInstruction(text: string): void;
  onSimpler(): void;
  onTone(t: Tone): void;
  onHangup(): void;
}) {
  const { d } = useT();
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  // Hang-up takes two taps so a stray touch can't end a call.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onInstruction(t);
    setText("");
    setSent(true);
    setTimeout(() => setSent(false), 2000);
  };

  return (
    <div className="sp-controls">
      <form className="sp-instruction" onSubmit={submit}>
        <label className="sp-visually-hidden" htmlFor="sp-instruction">
          {d.call.instructionLabel}
        </label>
        <input
          id="sp-instruction"
          className="sp-input"
          value={text}
          placeholder={d.call.instructionPlaceholder}
          onChange={(e) => setText(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button type="submit" variant="primary" disabled={disabled || !text.trim()} aria-label={d.call.send}>
          <Icon name="send" />
        </Button>
        <span className="sp-instruction__sent" role="status">
          {sent ? d.call.sent : ""}
        </span>
      </form>
      <div className="sp-controls__row">
        <Button variant="secondary" onClick={onSimpler} disabled={disabled}>
          {d.call.simpler}
        </Button>
        <div className="sp-tone" role="radiogroup" aria-label={d.call.tone}>
          {(["friendly", "firm", "hurry"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tone === t}
              className="sp-tone__opt"
              data-checked={tone === t || undefined}
              disabled={disabled}
              onClick={() => onTone(t)}
            >
              {tone === t ? <motion.span layoutId="tone-pill" className="sp-tone__pill" transition={spring.pop} /> : null}
              {d.call.tones[t]}
            </button>
          ))}
        </div>
        <Button
          variant="danger"
          data-confirming={confirming || undefined}
          disabled={disabled}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            onHangup();
          }}
        >
          <Icon name="hangup" />
          <span>{confirming ? d.call.hangupConfirm : d.call.hangup}</span>
        </Button>
      </div>
    </div>
  );
}
