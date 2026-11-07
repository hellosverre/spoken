// Ready voices (ElevenLabs premade, all multilingual so they speak Norwegian) and
// voice design from a text description.

import type { Voice } from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { designedVoices } from "../store.ts";

export const PRESET_VOICES: Voice[] = [
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", description: "Rolig, trygg og tydelig. Standard.", preset: true },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: "Stødig og saklig, som en nyhetsoppleser.", preset: true },
  { id: "SAz9YHcvj6GT2YYXdXww", name: "River", description: "Avslappet og nøytral.", preset: true },
];

export function listVoices(): Voice[] {
  return [...PRESET_VOICES, ...designedVoices];
}

async function el(path: string, body: object): Promise<any> {
  const res = await fetch(`https://api.elevenlabs.io${path}`, {
    method: "POST",
    headers: { "xi-api-key": config.elevenlabs.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${path} HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Real design only on the live provider (it costs credits); otherwise a demo voice. */
export async function designVoice(description: string): Promise<Voice> {
  const desc = description.trim().slice(0, 1000);
  const name = `Egen stemme ${designedVoices.length + 1}`;
  if (config.callProvider === "telnyx" && config.elevenlabs.apiKey) {
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
  const voice: Voice = { id: PRESET_VOICES[designedVoices.length % 3]!.id, name, description: `${desc} (demo)`, preset: false };
  designedVoices.push(voice);
  return voice;
}
