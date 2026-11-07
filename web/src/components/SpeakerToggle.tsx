"use client";

import { setSpeaker, unlockAudio, useLiveAudio } from "@/lib/live-audio";
import { useSpoken } from "@/lib/use-spoken";
import { Icon } from "./Icon";

/** Call screen: hear the call through the speaker. Shown only while the server is streaming audio. */
export function SpeakerToggle() {
  const { available, on } = useLiveAudio();
  const lang = useSpoken((s) => s.lang);
  if (!available) return null;
  const label = lang === "no" ? "Hør samtalen" : "Hear the call";
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={() => {
        unlockAudio();
        setSpeaker(!on);
      }}
      style={{
        width: "2.375rem",
        height: "2.375rem",
        borderRadius: "50%",
        border: "1px solid var(--line-2)",
        color: "var(--ink)",
        display: "grid",
        placeItems: "center",
        flex: "none",
        marginRight: "0.5rem",
        opacity: on ? 1 : 0.6,
      }}
    >
      <Icon name={on ? "speaker" : "speakerOff"} />
    </button>
  );
}
