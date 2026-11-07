/* "Hear the call": the callee's voice (and the agent's) streamed from the server while a real
   call runs, played with Web Audio. Frames are 1 byte (0 callee, 1 agent) + s16le 16 kHz mono.
   Nothing is stored; each frame is scheduled a little ahead (a small jitter buffer) and dropped
   if it arrives too late. The server only allows the device that placed the call, and only when
   its profile has "Hear the call" on; otherwise the socket is refused and the toggle hides. */

import { useSyncExternalStore } from "react";
import { deviceId, getToken } from "./account";

const HEAR_KEY = "spoken-hear";
const RATE = 16000;
/** Audio is scheduled this far ahead of arrival: enough to ride out network jitter. */
const LEAD_S = 0.12;
/** Past this much queued audio (a stalled tab catching up) the backlog is dropped. */
const MAX_AHEAD_S = 0.6;

export interface LiveAudioState {
  /** A call with audio is running and the server accepted the socket. */
  available: boolean;
  /** The user's speaker toggle. */
  on: boolean;
}

let state: LiveAudioState = { available: false, on: true };
const subs = new Set<() => void>();
const set = (p: Partial<LiveAudioState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};

let ws: WebSocket | null = null;
let ctx: AudioContext | null = null;
let next = [0, 0]; // per voice: when the next frame should start

function readPref(): boolean {
  try { return localStorage.getItem(HEAR_KEY) !== "0"; } catch { return true; }
}

function apiBase(): string {
  const api = process.env.NEXT_PUBLIC_SPOKEN_API ?? "";
  return (api === "/" ? window.location.origin : api.replace(/\/$/, "")).replace(/^http/, "ws");
}

function play(buf: ArrayBuffer) {
  if (!ctx || !state.on || ctx.state !== "running" || buf.byteLength < 3) return;
  const who = new Uint8Array(buf, 0, 1)[0] === 1 ? 1 : 0;
  const pcm = new Int16Array(buf.slice(1, 1 + ((buf.byteLength - 1) & ~1)));
  const audio = ctx.createBuffer(1, pcm.length, RATE);
  const ch = audio.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i]! / 32768;
  const src = ctx.createBufferSource();
  src.buffer = audio;
  src.connect(ctx.destination);
  const now = ctx.currentTime;
  if (next[who]! > now + MAX_AHEAD_S || next[who]! < now) next[who] = now + LEAD_S;
  src.start(next[who]);
  next[who] = next[who]! + pcm.length / RATE;
}

/** Call after a user tap (the toggle, or starting the call): browsers keep audio suspended until then. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext({ sampleRate: RATE });
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no Web Audio: the toggle stays inert */ }
}

/** A real call started: open the audio socket. Quietly does nothing if the server refuses. */
export function beginLiveAudio(callId: string) {
  endLiveAudio();
  set({ on: readPref(), available: false });
  unlockAudio();
  const q = new URLSearchParams({ device: deviceId() });
  const token = getToken();
  if (token) q.set("token", token);
  // The token travels in the query: browsers can't set headers on a websocket.
  document.addEventListener("pointerdown", unlockAudio, { once: true }); // if the start tap was too long ago
  const sock = new WebSocket(`${apiBase()}/api/calls/${encodeURIComponent(callId)}/audio?${q}`);
  sock.binaryType = "arraybuffer";
  sock.onopen = () => set({ available: true });
  sock.onmessage = (m) => { if (m.data instanceof ArrayBuffer) play(m.data); };
  sock.onclose = () => { if (ws === sock) set({ available: false }); };
  ws = sock;
}

/** The call is over: close the socket and let go of the audio device. */
export function endLiveAudio() {
  const sock = ws;
  ws = null;
  if (sock) { sock.onmessage = null; try { sock.close(); } catch { /* already closed */ } }
  next = [0, 0];
  if (ctx) { void ctx.close().catch(() => {}); ctx = null; }
  if (state.available) set({ available: false });
}

export function setSpeaker(on: boolean) {
  try { localStorage.setItem(HEAR_KEY, on ? "1" : "0"); } catch { /* ignore */ }
  if (on) unlockAudio();
  next = [0, 0];
  set({ on });
}

export function useLiveAudio(): LiveAudioState {
  return useSyncExternalStore(
    (f) => { subs.add(f); return () => { subs.delete(f); }; },
    () => state,
    () => state,
  );
}
