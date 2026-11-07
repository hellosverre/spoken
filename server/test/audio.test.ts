import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { AudioHub, WHO_AGENT, WHO_CALLEE, audioHub } from "../src/call/audio-hub.ts";

const OWNER = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const OTHER = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";
const frame = (n: number) => new Uint8Array(640).fill(n);

function sink() {
  const got: Uint8Array[] = [];
  let closed = false;
  return { got, get closed() { return closed; }, send: (d: Uint8Array) => { got.push(d); }, close: () => { closed = true; }, buffered: 0, getBufferedAmount() { return this.buffered; } };
}

describe("AudioHub", () => {
  test("frames reach only authorised listeners of that call, tagged callee/agent", () => {
    const hub = new AudioHub();
    hub.open("c1", OWNER, true);
    hub.open("c2", OTHER, true);
    expect(hub.allows("c1", OWNER)).toBe(true);
    expect(hub.allows("c1", OTHER)).toBe(false);
    expect(hub.allows("c1", undefined)).toBe(false);
    expect(hub.allows("nope", OWNER)).toBe(false);
    const a = sink(), b = sink();
    hub.listen("c1", a);
    hub.listen("c2", b);
    hub.publish("c1", WHO_CALLEE, frame(7));
    hub.publish("c1", WHO_AGENT, frame(9));
    expect(a.got.length).toBe(2);
    expect([a.got[0]![0], a.got[0]![1], a.got[0]!.length]).toEqual([0, 7, 641]);
    expect(a.got[1]![0]).toBe(1);
    expect(b.got.length).toBe(0);
  });

  test("Hear the call off, or no owner → nobody can listen", () => {
    const hub = new AudioHub();
    hub.open("c1", OWNER, false);
    hub.open("c2", undefined, true);
    expect(hub.allows("c1", OWNER)).toBe(false);
    expect(hub.allows("c2", OWNER)).toBe(false);
  });

  test("no listener → frames are dropped, not kept; a late listener hears nothing old", () => {
    const hub = new AudioHub();
    hub.open("c1", OWNER, true);
    for (let i = 0; i < 100; i++) hub.publish("c1", WHO_CALLEE, frame(1));
    const late = sink();
    hub.listen("c1", late);
    expect(late.got.length).toBe(0);
    hub.publish("c1", WHO_CALLEE, frame(2));
    expect(late.got.length).toBe(1);
  });

  test("hangup: listeners are closed and later frames go nowhere", () => {
    const hub = new AudioHub();
    hub.open("c1", OWNER, true);
    const a = sink();
    hub.listen("c1", a);
    hub.close("c1");
    expect(a.closed).toBe(true);
    hub.publish("c1", WHO_CALLEE, frame(3));
    expect(a.got.length).toBe(0);
    expect(hub.allows("c1", OWNER)).toBe(false);
    expect(hub.listenerCount("c1")).toBe(0);
  });

  test("a backed-up listener skips frames instead of queueing", () => {
    const hub = new AudioHub();
    hub.open("c1", OWNER, true);
    const a = sink();
    hub.listen("c1", a);
    a.buffered = 1_000_000;
    hub.publish("c1", WHO_CALLEE, frame(1));
    expect(a.got.length).toBe(0);
    a.buffered = 0;
    hub.publish("c1", WHO_CALLEE, frame(1));
    expect(a.got.length).toBe(1);
  });
});

describe("/api/calls/:id/audio", () => {
  test("only the owning device gets the socket; frames arrive; hangup closes it", async () => {
    const app = createApp();
    const server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
    const base = `ws://localhost:${server.port}`;
    audioHub.open("c_audio_test", OWNER, true);
    try {
      // Wrong device, no device: refused before upgrade.
      for (const q of [`device=${OTHER}`, ""]) {
        const r = await fetch(`http://localhost:${server.port}/api/calls/c_audio_test/audio?${q}`);
        expect(r.status).toBe(403);
      }
      const ws = new WebSocket(`${base}/api/calls/c_audio_test/audio?device=${OWNER}`);
      ws.binaryType = "arraybuffer";
      const frames: Uint8Array[] = [];
      ws.onmessage = (m) => frames.push(new Uint8Array(m.data as ArrayBuffer));
      const closed = new Promise<void>((res) => (ws.onclose = () => res()));
      await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws error")); });
      for (let i = 0; i < 50 && !audioHub.listenerCount("c_audio_test"); i++) await Bun.sleep(10);
      audioHub.publish("c_audio_test", WHO_CALLEE, frame(5));
      for (let i = 0; i < 50 && !frames.length; i++) await Bun.sleep(10);
      expect(frames.length).toBe(1);
      expect([frames[0]![0], frames[0]![1]]).toEqual([0, 5]);
      audioHub.close("c_audio_test");
      await closed;
      expect(audioHub.listenerCount("c_audio_test")).toBe(0);
    } finally {
      server.stop(true);
    }
  });
});
