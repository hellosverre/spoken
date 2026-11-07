// ElevenLabs key selection: the Creator key first, the old free key as a fallback when the
// primary is rejected (auth) or out of quota. Keys are never logged.
import { config } from "../config.ts";

let onFallback = false;

export function elKey(): string {
  return onFallback && config.elevenlabs.fallbackKey ? config.elevenlabs.fallbackKey : config.elevenlabs.apiKey;
}

/** Call after a failed ElevenLabs request. Returns true if the caller should retry with the fallback. */
export function elKeyFailed(status: number, body = ""): boolean {
  const authOrQuota = status === 401 || status === 402 || status === 403 || /quota|credits|limit_exceeded|unauthori[sz]ed|invalid_api_key/i.test(body);
  if (!authOrQuota || onFallback || !config.elevenlabs.fallbackKey) return false;
  onFallback = true;
  console.warn(`[elevenlabs] primary key rejected (${status}); switching to ELEVENLABS_API_KEY_FALLBACK`);
  return true;
}

export function elOnFallback() { return onFallback; }
