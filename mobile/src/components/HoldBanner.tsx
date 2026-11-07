import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Text, Vibration, View } from "react-native";
import * as Haptics from "expo-haptics";
import { F, useTheme } from "../lib/theme";
import { useSpoken } from "../lib/use-spoken";

const T = {
  no: { hold: "På vent", back: "Noen er tilbake på linjen" },
  en: { hold: "On hold", back: "A person is back on the line" },
} as const;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** "On hold · 0:42" while the shop has us waiting; buzzes and announces when a person is back. */
/** since/ended override the store (the multi-call view tracks them per call). */
export function HoldBanner(o: { since?: number | null; ended?: boolean } = {}) {
  const { C } = useTheme();
  const sSince = useSpoken((s) => s.holdSince);
  const sEnded = useSpoken((s) => s.callEnded);
  const since = o.since !== undefined ? o.since : sSince;
  const ended = o.ended ?? sEnded;
  const lang = useSpoken((s) => s.lang);
  const t = T[lang === "no" ? "no" : "en"];
  const [now, setNow] = useState(() => Date.now());
  const was = useRef(false);

  useEffect(() => {
    if (since === null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  useEffect(() => {
    if (since !== null) {
      was.current = true;
      AccessibilityInfo.announceForAccessibility(t.hold);
    } else if (was.current) {
      was.current = false;
      if (ended) return;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => Vibration.vibrate([0, 200, 100, 200]));
      AccessibilityInfo.announceForAccessibility(t.back);
    }
  }, [since, ended, t.hold, t.back]);

  if (since === null) return null;
  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${t.hold} ${fmt(now - since)}`}
      style={{ marginVertical: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.accent }}
    >
      <Text style={{ fontFamily: F.medium, fontSize: 15, color: C.accent, fontVariant: ["tabular-nums"] }}>
        {t.hold} · {fmt(now - since)}
      </Text>
    </View>
  );
}
