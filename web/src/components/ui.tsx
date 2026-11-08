"use client";

import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { cx } from "@/lib/use-spoken";
import { Icon } from "./Icon";

// Shared pieces for the phone-UI screens: labelled inputs, a page sheet, a confirm dialog.

type FieldProps = { label: string; help?: string; error?: boolean | string } & (
  | ({ multiline?: false } & InputHTMLAttributes<HTMLInputElement>)
  | ({ multiline: true } & TextareaHTMLAttributes<HTMLTextAreaElement>)
);

/**
 * A labelled input in the composer's look: surface, hairline, accent on focus.
 * `error` as text is written under the field with an icon and read out with it, so a mistake
 * is never shown by the red border alone.
 */
export function Field({ label, help, error, className, ...rest }: FieldProps) {
  const id = useId();
  const message = typeof error === "string" && error ? error : null;
  const helpId = help && !message ? `${id}-help` : undefined;
  const errId = message ? `${id}-err` : undefined;
  const common = { id, "aria-invalid": !!error || undefined, "aria-describedby": errId ?? helpId };
  return (
    <div className={cx("fld", className)}>
      <label htmlFor={id}>{label}</label>
      {rest.multiline ? (
        <textarea {...common} {...omitMultiline(rest)} className={cx("input multi", error && "bad")} />
      ) : (
        <input {...common} {...omitMultiline(rest)} className={cx("input", error && "bad")} />
      )}
      {message ? (
        <p className="fld-err" id={errId}>
          <Icon name="alert" />
          {message}
        </p>
      ) : (
        help && (
          <p className="help" id={helpId}>
            {help}
          </p>
        )
      )}
    </div>
  );
}

function omitMultiline<T extends { multiline?: boolean }>(p: T): Omit<T, "multiline"> {
  const { multiline: _multiline, ...rest } = p;
  void _multiline;
  return rest;
}

/**
 * Sheets and dialogs render into the phone frame (#device), so they cover the whole
 * screen instead of being clipped by the tab pane they were opened from.
 */
function InDevice({ children }: { children: ReactNode }) {
  return createPortal(children, document.getElementById("device") ?? document.body);
}

/** A sheet that slides up over the whole screen, with a header: left action, title, right action. Esc closes it. */
export function PageSheet({
  title,
  left,
  right,
  onClose,
  children,
}: {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // Callers pass a new onClose each render; focus moves only when the sheet opens.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>(".page-body input, .page-body textarea, .page-body button");
    first?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, []);

  return (
    <InDevice>
      <div className="scrim on" onClick={onClose} />
      <div className="page" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref}>
        <header className="page-head pad">
          <div className="side">{left}</div>
          <h2 id={titleId}>{title}</h2>
          <div className="side right">{right}</div>
        </header>
        <div className="page-body pad">{children}</div>
      </div>
    </InDevice>
  );
}

export function HeadButton({ label, onClick, strong }: { label: string; onClick(): void; strong?: boolean }) {
  return (
    <button type="button" className={cx("headbtn", strong && "strong")} onClick={onClick}>
      {label}
    </button>
  );
}

/** A small "are you sure?" dialog for destructive actions. */
export function Confirm({
  title,
  body,
  cancel,
  confirm,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  cancel: string;
  confirm: string;
  onCancel(): void;
  onConfirm(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  return (
    <InDevice>
      <div className="scrim on top" onClick={onCancel} />
      <div
        className="confirm"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={ref}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
      >
        <h3 id={titleId}>{title}</h3>
        <p>{body}</p>
        <div className="confirm-acts">
          <button type="button" className="btn ghost" onClick={onCancel}>
            {cancel}
          </button>
          <button type="button" className="btn danger" onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </InDevice>
  );
}
