import { ApiError } from "../api/index.ts";
import type { Dict } from "../i18n/index.ts";

/** Turns any thrown value into a sentence the user can act on. */
export function errorText(err: unknown, d: Dict, fmt: (t: string, v?: Record<string, string | number>) => string): string {
  if (err instanceof ApiError && err.status === 0) return d.errors.network;
  const message = err instanceof Error ? err.message : String(err);
  return fmt(d.errors.generic, { message });
}
