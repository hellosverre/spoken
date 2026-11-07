// Ready voices (ElevenLabs premade, all multilingual so they speak Norwegian) and
// voice design from a text description.

import type { Voice } from "../../../shared/contract.ts";
import { config } from "../config.ts";
import { designedVoices } from "../store.ts";
import { elKey, elKeyFailed } from "./el-key.ts";

export const PRESET_VOICES: Voice[] = [
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "Rolig, dyp og varm. Standard.", preset: true },
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: "Varm og vennlig.", preset: true },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", description: "Lys, trygg og tydelig.", preset: true },
];

export function listVoices(): Voice[] {
  return [...PRESET_VOICES, ...designedVoices];
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
  const voice: Voice = { id: PRESET_VOICES[designedVoices.length % 3]!.id, name, description: `${desc} (demo)`, preset: false };
  designedVoices.push(voice);
  return voice;
}
