// Ready voices (eight library voices, multilingual) and
// voice design from a text description.

import type { Voice } from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { designedVoices } from "../store.ts";
import { elKey, elKeyFailed } from "./el-key.ts";

const v = (id: string, name: string, lang: "no" | "en", gender: "male" | "female", description: string): Voice =>
  ({ id, name, description, preset: true, lang, gender });

/** The eight library voices (added to the main ElevenLabs account): four Norwegian, four English. */
export const PRESET_VOICES: Voice[] = [
  v("4kCDY3HJwvO7Zp3con83", "Sebastian", "no", "male", "Varm mannsstemme. Standard."),
  v("xF681s0UeE04gsf0mVsJ", "Olaf", "no", "male", "Klar mannsstemme."),
  v("BRY5wALXFkJsxVM6sEOH", "Nadia", "no", "female", "Rolig kvinnestemme."),
  v("uNsWM1StCcpydKYOjKyu", "Mia", "no", "female", "Ung kvinnestemme."),
  v("ii0s2u4R3UFnxKL6DOrz", "Maya", "en", "female", "Warm female voice."),
  v("OZxMHsGaBmV5pjMIDIn0", "Amy", "en", "female", "Clear female voice."),
  v("OEHTkiHZj6OczWZHu0Aj", "John", "en", "male", "Friendly male voice."),
  v("Cz0K1kOv9tD8l0b5Qu53", "Jon", "en", "male", "Deep male voice. Default."),
];

export const DEFAULT_VOICE: Record<"no" | "en", string> = {
  no: "4kCDY3HJwvO7Zp3con83",
  en: "Cz0K1kOv9tD8l0b5Qu53",
};

/** The voice for a call: the profile's pick if it speaks the call language, else that language's default. */
export function voiceForCall(profileVoiceId: string | undefined, lang: "no" | "en"): string {
  const pick = profileVoiceId && PRESET_VOICES.find((x) => x.id === profileVoiceId);
  if (pick) return pick.lang === lang ? pick.id : DEFAULT_VOICE[lang];
  // Designed or unknown voices are the user's own choice: keep them.
  return profileVoiceId || DEFAULT_VOICE[lang];
}

const previews = new Map<string, string>();
let previewsStarted = false;

/** Fetch each voice's sample url once, in the background. Never throws, never blocks. */
function warmPreviews() {
  if (previewsStarted || !elKey()) return;
  previewsStarted = true;
  void (async () => {
    for (const x of PRESET_VOICES) {
      try {
        const res = await fetch(`https://api.elevenlabs.io/v1/voices/${x.id}`, {
          headers: { "xi-api-key": elKey() }, signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          if (elKeyFailed(res.status, await res.text())) { previewsStarted = false; return warmPreviews(); }
          continue;
        }
        const url = ((await res.json()) as { preview_url?: string }).preview_url;
        if (url) previews.set(x.id, url);
      } catch (e) {
        console.warn("[voices] preview url failed:", (e as Error).message);
      }
    }
  })();
}

export function listVoices(): Voice[] {
  warmPreviews();
  const ready = PRESET_VOICES.map((x) => (previews.has(x.id) ? { ...x, previewUrl: previews.get(x.id) } : x));
  return [...ready, ...designedVoices];
}

async function el(path: string, body: object): Promise<any> {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": elKey(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text();
    if (elKeyFailed(res.status, text)) return el(path, body);
    throw new Error(`ElevenLabs ${path} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/** Real design only on the live provider (it costs credits); otherwise a demo voice. */
export async function designVoice(description: string): Promise<Voice> {
  const desc = description.trim().slice(0, 1000);
  const name = `Egen stemme ${designedVoices.length + 1}`;
  if (config.callProvider === "telnyx" && elKey()) {
    try {
      const d = await el("/v1/text-to-voice/design", {
        voice_description: desc,
        auto_generate_text: true,
        stream_previews: true,
      });
      const gen = d.previews?.[0]?.generated_voice_id;
      if (!gen) throw new Error("no preview returned");
      const v = await el("/v1/text-to-voice", { voice_name: name, voice_description: desc, generated_voice_id: gen });
      const voice: Voice = { id: v.voice_id, name, description: desc, preset: false };
      designedVoices.push(voice);
      return voice;
    } catch (e) {
      console.warn("[voices] design failed, using demo voice:", (e as Error).message);
    }
  }
  const voice: Voice = { id: PRESET_VOICES[designedVoices.length % PRESET_VOICES.length]!.id, name, description: `${desc} (demo)`, preset: false };
  designedVoices.push(voice);
  return voice;
}
