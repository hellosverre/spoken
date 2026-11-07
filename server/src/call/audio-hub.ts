// Live call audio for the user who placed the call ("Hear the call"). Frames go from the line
// straight to the listening sockets: nothing is stored, queued or written to disk. With no
// listener a published frame is dropped before it is even copied.
//
// Wire format (binary websocket message): 1 byte who (0 = callee, 1 = agent) + s16le mono PCM
// at 16 kHz (Vonage's media rate; 20 ms = 640 bytes).

export const WHO_CALLEE = 0;
export const WHO_AGENT = 1;

/** The part of a websocket the hub needs. send returns -1 when the socket is backed up. */
export interface AudioSink {
  send(data: Uint8Array): number | void;
  close(code?: number, reason?: string): void;
  getBufferedAmount?(): number;
}

/** Skip a frame for a listener whose socket already holds this much unsent audio (~1 s). */
const MAX_BACKLOG = 32_000;

interface Entry {
  owner: string;
  listeners: Set<AudioSink>;
}

export class AudioHub {
  private calls = new Map<string, Entry>();

  /** A call starts. Only the owner device may listen, and only if its profile has "Hear the call" on. */
  open(callId: string, owner: string | undefined, hearCall: boolean) {
    if (owner && hearCall) this.calls.set(callId, { owner, listeners: new Set() });
  }

  /** The call ended: disconnect listeners and forget the call. Late frames then go nowhere. */
  close(callId: string) {
    const e = this.calls.get(callId);
    if (!e) return;
    this.calls.delete(callId);
    for (const s of e.listeners) { try { s.close(1000, "call ended"); } catch { /* already gone */ } }
    e.listeners.clear();
  }

  /** Is `device` (the caller's data key) allowed to hear this call? */
  allows(callId: string, device: string | undefined): boolean {
    const e = this.calls.get(callId);
    return !!e && !!device && e.owner === device;
  }

  /** Register a listener (call allows() first). Returns the unsubscribe function. */
  listen(callId: string, sink: AudioSink): () => void {
    const e = this.calls.get(callId);
    if (!e) return () => {};
    e.listeners.add(sink);
    return () => { e.listeners.delete(sink); };
  }

  listenerCount(callId: string): number {
    return this.calls.get(callId)?.listeners.size ?? 0;
  }

  /** Called by a line for every frame in either direction. Cheap when nobody listens. */
  publish(callId: string, who: typeof WHO_CALLEE | typeof WHO_AGENT, pcm16k: Uint8Array) {
    const e = this.calls.get(callId);
    if (!e || e.listeners.size === 0) return;
    const out = new Uint8Array(1 + pcm16k.length);
    out[0] = who;
    out.set(pcm16k, 1);
    for (const s of e.listeners) {
      try {
        if ((s.getBufferedAmount?.() ?? 0) > MAX_BACKLOG) continue; // slow listener: drop, never queue
        s.send(out);
      } catch { e.listeners.delete(s); }
    }
  }
}

export const audioHub = new AudioHub();
