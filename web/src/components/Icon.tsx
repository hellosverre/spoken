import type { ReactNode } from "react";

const PATHS = {
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  // A whole pizza with one slice pulled out, and pepperoni (a tip-down slice read as Wi-Fi when small).
  pizza: (
    <>
      <path d="M11.2 12.8V4.3a8.5 8.5 0 1 0 7.36 4.25z" />
      <path d="M13.2 10.8V2.8a8 8 0 0 1 6.93 4z" />
      <path d="M7.5 11.5h.01M10.5 16.5h.01M15 15.5h.01" strokeWidth={3} />
    </>
  ),
  // A stethoscope (a plus in a square read as "add").
  doctor: (
    <>
      <path d="M5 3.5v5a4.5 4.5 0 0 0 9 0v-5M4 3.5h2M13 3.5h2" />
      <path d="M9.5 13v1.5a5 5 0 0 0 10 0v-2" />
      <circle cx="19.5" cy="10.5" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5 7 7M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5" />
    </>
  ),
  moon: <path d="M19.6 14.6A8.2 8.2 0 0 1 9.4 4.4 8.2 8.2 0 1 0 19.6 14.6z" />,
  // Auto: a circle, half filled (follows the device).
  auto: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c-2.4 2.4-3.6 5.2-3.6 8.5s1.2 6.1 3.6 8.5M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6.5" r="2.8" />
      <circle cx="6" cy="17.5" r="2.8" />
      <path d="M8.4 8 20 18M8.4 16 20 6" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1.2 12H6.2z" />
      <path d="M9 8V7a3 3 0 0 1 6 0v1" />
    </>
  ),
  send: <path d="M5 12h13M13 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M7 7l10 10M17 7 7 17" />,
  replay: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4v4.5h4.5" />
    </>
  ),
  hang: <path d="M3 14.5c5.3-5 12.7-5 18 0l-2.2 2.6-3.6-1.4.2-2.6c-2.3-.8-4.5-.8-6.8 0l.2 2.6-3.6 1.4z" />,
  play: <path d="M7 4.5l13 7.5-13 7.5z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  bubble: <path d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-5 4z" />,
  home: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5H9v5.5H5.5A1.5 1.5 0 0 1 4 19z" />,
  heart: <path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0 1 12 6.8a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10-7.5 10z" />,
  trash: <path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7M10.5 10.5v6M13.5 10.5v6" />,
  pencil: <path d="M15.5 5.5l3 3L9 18l-4 1 1-4zM13.5 7.5l3 3" />,
  // Thumbs: a cuff and a raised hand (down is the same drawing turned over).
  thumbUp: <path d="M7 11v9H4.5a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1zM7 11l4-7.5c1.7 0 2.7 1.2 2.4 2.8L13 9h5.5a2 2 0 0 1 2 2.4l-1.3 6.5a2.5 2.5 0 0 1-2.4 2.1H7" />,
  thumbDown: <path d="M7 13V4H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1zM7 13l4 7.5c1.7 0 2.7-1.2 2.4-2.8L13 15h5.5a2 2 0 0 0 2-2.4l-1.3-6.5A2.5 2.5 0 0 0 16.8 4H7" />,
  chevron: <path d="M9.5 6l6 6-6 6" />,
  person: (
    <>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20c1-3.7 3.8-5.6 7.2-5.6s6.2 1.9 7.2 5.6" />
    </>
  ),
  logout: (
    <>
      <path d="M14 4h3a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3h-3" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  // A circle with a bang: notes, warnings and field errors (with words, never colour alone).
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.8v5.2M12 16.2v.1" />
    </>
  ),
  doc: (
    <>
      <path d="M6.5 3.5h7.5l4 4v13h-11.5z" />
      <path d="M14 3.5v4h4M9.5 12h5.5M9.5 15.5h5.5" />
    </>
  ),
  history: (
    <>
      <path d="M4.6 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.2 4.4v3.3h3.3" />
      <path d="M12 8.2v4l2.8 1.8" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  speakerOff: (
    <>
      <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

export function Wordmark() {
  return (
    <div className="wordmark">
      <span className="mark" />
      Spoken
    </div>
  );
}
