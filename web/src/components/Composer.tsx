"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { Icon } from "./Icon";

interface Props {
  value: string;
  onChange(value: string): void;
  onSubmit(): void;
  placeholder: string;
  label: string;
  sendLabel: string;
  /** When this number changes, the input takes focus. */
  focusTick?: number;
}

/** Text field that grows with its content. Enter sends, Shift+Enter adds a line. */
export function Composer({ value, onChange, onSubmit, placeholder, label, sendLabel, focusTick = 0 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    // A hidden tab measures 0: keep the natural one-line height instead of collapsing it.
    // The cap is 7.5rem so it grows with the phone's text size.
    const cap = 7.5 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    el.style.height = el.scrollHeight ? `${Math.min(el.scrollHeight, cap)}px` : "";
  }, [value]);

  useEffect(() => {
    if (focusTick) ref.current?.focus();
  }, [focusTick]);

  return (
    <form
      className="field"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        ref={ref}
        rows={1}
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button className="send" type="submit" aria-label={sendLabel}>
        <Icon name="send" />
      </button>
    </form>
  );
}
