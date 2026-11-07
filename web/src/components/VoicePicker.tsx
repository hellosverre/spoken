"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/account";
import { useSpoken } from "@/lib/use-spoken";
import { ORB_CSS, VoiceOrb } from "./VoiceOrb";

interface VoiceItem {
  id: string;
  name: string;
  description: string;
  lang?: "no" | "en";
  gender?: "male" | "female";
  previewUrl?: string;
}

// Shown until (or without) the server list: same eight ids as server/src/voice/voices.ts.
const OFFLINE: VoiceItem[] = [
  { id: "4kCDY3HJwvO7Zp3con83", name: "Sebastian", description: "Varm mannsstemme", lang: "no", gender: "male" },
  { id: "xF681s0UeE04gsf0mVsJ", name: "Olaf", description: "Klar mannsstemme", lang: "no", gender: "male" },
  { id: "BRY5wALXFkJsxVM6sEOH", name: "Nadia", description: "Rolig kvinnestemme", lang: "no", gender: "female" },
  { id: "uNsWM1StCcpydKYOjKyu", name: "Mia", description: "Ung kvinnestemme", lang: "no", gender: "female" },
  { id: "ii0s2u4R3UFnxKL6DOrz", name: "Maya", description: "Warm female voice", lang: "en", gender: "female" },
  { id: "OZxMHsGaBmV5pjMIDIn0", name: "Amy", description: "Clear female voice", lang: "en", gender: "female" },
  { id: "OEHTkiHZj6OczWZHu0Aj", name: "John", description: "Friendly male voice", lang: "en", gender: "male" },
  { id: "Cz0K1kOv9tD8l0b5Qu53", name: "Jon", description: "Deep male voice", lang: "en", gender: "male" },
];
const DEFAULTS: Record<string, string> = { no: "4kCDY3HJwvO7Zp3con83", en: "Cz0K1kOv9tD8l0b5Qu53" };
const LOCAL_KEY = "spoken-voice";

const COPY = {
  en: {
    title: "Voice", no: "Norsk", en: "English", choose: "Choose", chosen: "Chosen", standard: "Default",
    play: (n: string) => `Play sample of ${n}`, stop: (n: string) => `Stop sample of ${n}`,
    pick: (n: string) => `Choose ${n} as your voice`, male: "male", female: "female",
    saveFail: "Couldn't save on the server. Saved on this device.",
    hint: "The voice your calls use. A call uses it when it matches the call's language.",
    sample: { no: "Hei, jeg ringer på vegne av deg.", en: "Hi, I'm calling on behalf of you." },
  },
  no: {
    title: "Stemme", no: "Norsk", en: "English", choose: "Velg", chosen: "Valgt", standard: "Standard",
    play: (n: string) => `Spill av prøve av ${n}`, stop: (n: string) => `Stopp prøve av ${n}`,
    pick: (n: string) => `Velg ${n} som stemme`, male: "mann", female: "kvinne",
    saveFail: "Fikk ikke lagret på serveren. Lagret på denne enheten.",
    hint: "Stemmen samtalene dine bruker. Den brukes når den passer til språket i samtalen.",
    sample: { no: "Hei, jeg ringer på vegne av deg.", en: "Hi, I'm calling on behalf of you." },
  },
} as const;

/** One preview at a time. Drives `level` (0..1) from an AnalyserNode, or a soft synthetic pulse when no analyser is possible. */
function usePreview() {
  const level = useRef(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const cleanup = useRef<() => void>(() => {});

  const stop = useCallback(() => {
    cleanup.current();
    cleanup.current = () => {};
    level.current = 0;
    setPlayingId(null);
  }, []);
  useEffect(() => stop, [stop]);

  const play = useCallback((v: VoiceItem, sample: string) => {
    stop();
    setPlayingId(v.id);
    let raf = 0;
    let done = false;
    const end = () => { if (done) return; done = true; cancelAnimationFrame(raf); level.current = 0; setPlayingId((c) => (c === v.id ? null : c)); };
    // Gentle fake amplitude when we can't read the real one (no CORS, speech synthesis).
    const pulse = () => {
      const t = performance.now() / 1000;
      level.current = 0.35 + 0.25 * Math.sin(t * 7) * Math.sin(t * 2.3) + 0.1 * Math.sin(t * 13);
      raf = requestAnimationFrame(pulse);
    };

    const speak = () => {
      if (!("speechSynthesis" in window)) { end(); return; }
      const u = new SpeechSynthesisUtterance(sample);
      u.lang = v.lang === "no" ? "nb-NO" : "en-US";
      u.onend = u.onerror = end;
      cleanup.current = () => { u.onend = u.onerror = null; speechSynthesis.cancel(); end(); };
      pulse();
      speechSynthesis.speak(u);
    };

    if (!v.previewUrl) { speak(); return; }

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.src = v.previewUrl;
    let ctx: AudioContext | undefined;
    let analyser = false;
    cleanup.current = () => { audio.onended = audio.onerror = null; audio.pause(); void ctx?.close().catch(() => {}); end(); };
    audio.onended = end;
    audio.onerror = () => {
      // CORS refused: play it plain, with the synthetic pulse.
      if (audio.crossOrigin) {
        audio.onerror = () => { cleanup.current(); speak(); };
        audio.removeAttribute("crossorigin");
        audio.src = v.previewUrl!;
        pulse();
        void audio.play().catch(() => { cleanup.current(); speak(); });
      }
    };
    try {
      ctx = new AudioContext();
      const src = ctx.createMediaElementSource(audio);
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      src.connect(an);
      an.connect(ctx.destination);
      const buf = new Uint8Array(an.frequencyBinCount);
      analyser = true;
      const read = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const x of buf) { const d = (x - 128) / 128; sum += d * d; }
        level.current = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        raf = requestAnimationFrame(read);
      };
      read();
    } catch { /* no Web Audio: plain playback */ }
    void audio.play().catch(() => { if (analyser) { cleanup.current(); speak(); } });
  }, [stop]);

  return { level, playingId, play, stop };
}

/** Profile → Voice: eight voices as breathing orbs, grouped Norsk / English. Tap the orb to hear it, Velg to keep it. */
export function VoicePicker() {
  const lang = useSpoken((s) => s.lang);
  const c = COPY[lang];
  const [voices, setVoices] = useState<VoiceItem[]>(OFFLINE);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const { level, playingId, play, stop } = usePreview();

  useEffect(() => {
    try { setSelected(localStorage.getItem(LOCAL_KEY) ?? ""); } catch { /* private mode */ }
    api<VoiceItem[]>("GET", "/api/voices").then((l) => {
      const got = l.filter((v) => v.lang);
      if (got.length) setVoices(got);
    }).catch(() => {});
    api<{ voiceId?: string }>("GET", "/api/profile").then((p) => p.voiceId && setSelected(p.voiceId)).catch(() => {});
  }, []);

  async function choose(id: string) {
    setSelected(id);
    setError("");
    try { localStorage.setItem(LOCAL_KEY, id); } catch { /* ignore */ }
    try {
      const cur = await api<Record<string, unknown>>("GET", "/api/profile");
      await api("PUT", "/api/profile", { hearCall: true, personality: "warm", ...cur, lang, voiceId: id });
    } catch {
      setError(c.saveFail);
    }
  }

  const groups = (["no", "en"] as const).map((l) => ({ l, items: voices.filter((v) => v.lang === l) }));

  return (
    <div className="vp">
      <style>{ORB_CSS + PICKER_CSS}</style>
      <p className="help" style={{ margin: "0 0 0.5rem" }}>{c.hint}</p>
      {groups.map(({ l, items }) => items.length > 0 && (
        <section key={l} aria-label={c[l]}>
          <h4 className="vp-group">{c[l]}</h4>
          <ul className="vp-grid">
            {items.map((v) => {
              const on = selected === v.id;
              const playing = playingId === v.id;
              const isDefault = !selected && DEFAULTS[l] === v.id;
              return (
                <li key={v.id} className="vp-card" data-on={on || undefined}>
                  <button
                    type="button"
                    className="vp-orb"
                    aria-label={playing ? c.stop(v.name) : c.play(v.name)}
                    aria-pressed={playing}
                    onClick={() => (playing ? stop() : play(v, c.sample[l]))}
                  >
                    <VoiceOrb voiceId={v.id} playing={playing} level={level} />
                  </button>
                  <b className="vp-name">{v.name}</b>
                  <span className="vp-sub">
                    {v.gender ? c[v.gender] : ""}{isDefault ? ` · ${c.standard}` : ""}
                  </span>
                  <button
                    type="button"
                    className="vp-choose"
                    aria-pressed={on}
                    aria-label={c.pick(v.name)}
                    onClick={() => void choose(v.id)}
                  >
                    {on ? `✓ ${c.chosen}` : c.choose}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {error && <p className="help" role="status" style={{ color: "var(--muted)" }}>{error}</p>}
    </div>
  );
}

const PICKER_CSS = `
.vp-group{margin:0.75rem 0 0.5rem;font-size:0.8125rem;font-weight:510;color:var(--muted);letter-spacing:.02em}
.vp-grid{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0.625rem}
.vp-card{display:flex;flex-direction:column;align-items:center;gap:0.125rem;padding:0.875rem 0.5rem 0.625rem;background:var(--surface);border:1px solid var(--line);border-radius:1.125rem;transition:border-color .2s}
.vp-card[data-on]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.vp-orb{background:none;border:0;padding:0.25rem;margin-bottom:0.25rem;cursor:pointer;border-radius:50%;display:grid;place-items:center}
.vp-name{font-size:0.9375rem;font-weight:590}
.vp-sub{font-size:0.75rem;color:var(--muted);min-height:1.125rem}
.vp-choose{margin-top:0.375rem;min-height:2.25rem;width:100%;border-radius:0.75rem;border:1px solid var(--line-2);background:transparent;color:var(--ink);font:inherit;font-size:0.8125rem;font-weight:510;cursor:pointer}
.vp-choose[aria-pressed="true"]{background:var(--accent-soft);border-color:var(--accent);color:var(--accent)}
`;
