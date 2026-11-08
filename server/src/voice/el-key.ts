// ElevenLabs key selection: the Creator key first, the old free key as a fallback when the
// primary is rejected (auth) or out of quota. Keys are never logged.
import { config } from "../config.ts";

let fallbackUntil = 0; // the fallback is temporary: try the primary again after a minute
const onFallbackNow = () => Date.now() < fallbackUntil;

export function elKey(): string {
  return onFallbackNow() && config.elevenlabs.fallbackKey ? config.elevenlabs.fallbackKey : config.elevenlabs.apiKey;
}

/** Call after a failed ElevenLabs request. Returns true if the caller should retry with the fallback. */
export function elKeyFailed(status: number, body = ""): boolean {
  // 429 (too many requests at once) is a short wait, never a reason to leave the paid key.
  if (status === 429) return false;
  const authOrQuota = status === 401 || status === 402 || status === 403 || /quota|credits|unauthori[sz]ed|invalid_api_key/i.test(body);
  if (!authOrQuota || onFallbackNow() || !config.elevenlabs.fallbackKey) return false;
  fallbackUntil = Date.now() + 60_000;
  console.warn(`[elevenlabs] primary key rejected (${status}); switching to ELEVENLABS_API_KEY_FALLBACK`);
  return true;
}

export function elOnFallback() { return onFallbackNow(); }
