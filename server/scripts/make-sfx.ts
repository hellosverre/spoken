// One-off: render the call's waiting sounds with ElevenLabs sound generation (SFX v3).
//   cd server && bun scripts/make-sfx.ts [--force]
// Output is raw µ-law 8 kHz (ulaw_8000), the format the phone lines play, in server/assets/sfx/.
// ~12 s of audio in total. The synthesised sounds in src/voice/ulaw.ts stay as the fallback when a file is missing.
// Needs ELEVENLABS_API_KEY (read through config, never printed); without it the script does nothing.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { elKey } from "../src/voice/el-key.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "sfx");

interface Clip { file: string; text: string; seconds: number }
const CLIPS: Clip[] = [
  { file: "typing.ulaw", seconds: 6, text: "Very soft laptop keyboard typing, quiet and steady, gentle muted key clicks in an empty room, no voices, no music, no ambience" },
  { file: "waiting.ulaw", seconds: 6, text: "A gentle, warm, very quiet waiting tone: slow soft sine pad with two notes breathing in and out, calm, no melody, no percussion, no voices" },
];

async function render(c: Clip): Promise<Uint8Array> {
  // Params per https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=ulaw_8000", {
    method: "POST",
    headers: { "xi-api-key": elKey(), "content-type": "application/json" },
    body: JSON.stringify({ text: c.text, model_id: "eleven_text_to_sound_v3", loop: true, duration_seconds: c.seconds, prompt_influence: 0.5 }),
  });
  if (!res.ok) throw new Error(`${c.file}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

if (!elKey()) {
  console.log("ELEVENLABS_API_KEY missing: nothing generated, the built-in synthesised sounds stay in use.");
  process.exit(0);
}
mkdirSync(OUT, { recursive: true });
const force = process.argv.includes("--force");
for (const c of CLIPS) {
  const path = join(OUT, c.file);
  if (existsSync(path) && !force) { console.log(`${c.file}: exists (use --force to re-render)`); continue; }
  const audio = await render(c);
  writeFileSync(path, audio);
  console.log(`${c.file}: ${audio.length} bytes ≈ ${(audio.length / 8000).toFixed(1)} s`);
}
