import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import { useT } from "../i18n/useT.ts";

// Plain building blocks. No visual decisions in here: each element exposes a
// stable `sp-*` class plus data-attributes for variants and states, and the
// design layer (src/theme/components.css) styles those.

export function Screen({
  title,
  back,
  actions,
  children,
  footer,
  kind,
}: {
  title: string;
  back?: string;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Lets the design target a screen: data-screen="call" etc. */
  kind: string;
}) {
  const { d } = useT();
  const h1 = useRef<HTMLHeadingElement>(null);
  // Move focus to the heading on every screen change, so screen readers
  // announce the new page instead of staying on the button that was pressed.
  useEffect(() => {
    h1.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [title]);
  return (
    <div className="sp-screen" data-screen={kind}>
      <header className="sp-screen__bar">
        {back ? (
          <a className="sp-screen__back" href={back}>
            <Icon name="back" />
            <span>{d.app.back}</span>
          </a>
        ) : null}
        <div className="sp-screen__actions">{actions}</div>
      </header>
      <main id="main" className="sp-screen__main" tabIndex={-1}>
        <h1 ref={h1} tabIndex={-1} className="sp-screen__title">
          {title}
        </h1>
        {children}
      </main>
      {footer ? <footer className="sp-screen__footer">{footer}</footer> : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "yes" | "no";

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg" | "xl";
  busy?: boolean;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      type="button"
      {...rest}
      className={`sp-btn ${rest.className ?? ""}`.trim()}
      data-variant={variant}
      data-size={size}
      data-busy={busy || undefined}
      aria-busy={busy || undefined}
      disabled={rest.disabled || busy}
    >
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "secondary",
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  children: ReactNode;
}) {
  return (
    <a className="sp-btn" data-variant={variant} data-size="md" href={href}>
      {children}
    </a>
  );
}

function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="sp-field" data-invalid={error ? true : undefined}>
      <label className="sp-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint ? (
        <p className="sp-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="sp-field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function describedBy(id: string, hint?: string, error?: string) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

export function TextField({
  label,
  hint,
  error,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        className="sp-input"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
}

export function TextArea({
  label,
  hint,
  error,
  hero,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  error?: string;
  hero?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
}) {
  const id = useId();
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <textarea
        id={id}
        className="sp-input sp-textarea"
        data-hero={hero || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
    </FieldShell>
  );
}

/** Radio group drawn as tappable options. */
export function ChoiceGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
  layout = "stack",
  hideLegend,
}: {
  legend: string;
  /** Keep the legend for screen readers only, when a heading right above already says it. */
  hideLegend?: boolean;
  value: T | undefined;
  options: { value: T; label: string; hint?: string }[];
  onChange(v: T): void;
  layout?: "stack" | "row";
}) {
  const name = useId();
  return (
    <fieldset className="sp-choices" data-layout={layout}>
      <legend className={hideLegend ? "sp-visually-hidden" : "sp-choices__legend"}>{legend}</legend>
      {options.map((o) => (
        <label key={o.value} className="sp-choice" data-checked={value === o.value || undefined}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          <span className="sp-choice__label">{o.label}</span>
          {o.hint ? <span className="sp-choice__hint">{o.hint}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

export function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange(v: boolean): void; hint?: string }) {
  const id = useId();
  return (
    <div className="sp-toggle">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <label htmlFor={id} className="sp-toggle__label">
        {label}
      </label>
      {hint ? (
        <p className="sp-toggle__hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Section({ title, children, kind }: { title: string; children: ReactNode; kind?: string }) {
  const id = useId();
  return (
    <section className="sp-section" data-section={kind} aria-labelledby={id}>
      <h2 id={id} className="sp-section__title">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { d } = useT();
  return (
    <div className="sp-error" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <Button variant="ghost" size="sm" onClick={onRetry}>
          {d.app.retry}
        </Button>
      ) : null}
    </div>
  );
}

/** Steps through an ordered sequence. Only for real sequences (onboarding). */
export function Progress({ step, total, label }: { step: number; total: number; label: string }) {
  return (
    <div className="sp-progress" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step} aria-label={label}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="sp-progress__dot" data-done={i < step || undefined} />
      ))}
    </div>
  );
}

// Custom glyphs for this app, drawn on a 20px grid with one stroke weight.
// The design pass can redraw these in place; the names are the contract.
const ICONS = {
  back: "M12 4 6 10l6 6",
  settings: "M10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 10h1.5M15.5 10H17M10 3v1.5M10 15.5V17M5 5l1 1M14 14l1 1M5 15l1-1M14 6l1-1",
  food: "M3 6 10 17l7-11a12 12 0 0 0-14 0Z",
  calendar: "M3 5.5h14v11H3zM3 9h14M7 3v4M13 3v4",
  clock: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM10 6v4l2.5 2",
  cancel: "M5 5l10 10M15 5 5 15",
  phone: "M4.5 2.5h3l1.3 3.7-1.8 1.2a9 9 0 0 0 5.6 5.6l1.2-1.8 3.7 1.3v3a1.5 1.5 0 0 1-1.6 1.5A14 14 0 0 1 3 4.1 1.5 1.5 0 0 1 4.5 2.5Z",
  hangup: "M2.5 11.5c4.2-3.8 10.8-3.8 15 0l-1.9 2.2-3-1.3V10a9 9 0 0 0-5.2 0v2.4l-3 1.3Z",
  send: "M4 10h12M11 5l5 5-5 5",
  person: "M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM4 17c.9-2.9 3.3-4.5 6-4.5s5.1 1.6 6 4.5",
  place: "M10 17s5.5-4.8 5.5-9a5.5 5.5 0 0 0-11 0c0 4.2 5.5 9 5.5 9ZM10 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z",
  shield: "M10 2.5 16 5v4.5c0 3.8-2.6 6.6-6 8-3.4-1.4-6-4.2-6-8V5Z",
  warn: "M10 3 18 17H2ZM10 8v4M10 14.5v.2",
  check: "M4 10.5 8 14.5 16 6",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg
      className="sp-icon"
      data-icon={name}
      viewBox="0 0 20 20"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
