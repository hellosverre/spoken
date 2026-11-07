// In-memory state only (no transcript or audio persistence, by design).

import type { Clarify, Plan, Profile, TaskInput, Voice } from "../../shared/contract.ts";
import type { CallSession } from "./call/session.ts";

export interface Task {
  id: string;
  input: TaskInput;
  clarify: Clarify;
  blocked?: { reason: string; alternative?: string };
  answers?: Record<string, string>;
  plan?: Plan;
  createdAt: number;
}

export const tasks = new Map<string, Task>();
export const calls = new Map<string, CallSession>();
export const designedVoices: Voice[] = [];

export let profile: Profile = {
  name: "Sverre",
  hearCall: true,
  personality: "warm",
  lang: "no",
};
export function setProfile(p: Profile) { profile = p; }

const daily = new Map<string, { day: string; n: number }>();

/** Counts a call for this user today; false if over the limit. */
export function takeCallSlot(user: string, max: number): boolean {
  const day = new Date().toISOString().slice(0, 10);
  const d = daily.get(user);
  if (!d || d.day !== day) { daily.set(user, { day, n: 1 }); return true; }
  if (d.n >= max) return false;
  d.n++;
  return true;
}

export function resetLimits() { daily.clear(); }

/** Drop finished calls after 30 min and old tasks after 2 h. */
export function purge(now = Date.now()) {
  for (const [id, c] of calls) if (c.isEnded && now - endedAt(c) > 30 * 60_000) calls.delete(id);
  for (const [id, t] of tasks) if (now - t.createdAt > 2 * 3600_000) tasks.delete(id);
}

function endedAt(c: CallSession): number {
  const st = c.events.findLast((e) => e.type === "status" && e.status === "ended") as { at: number } | undefined;
  return st?.at ?? now0();
}

const now0 = () => Date.now();
