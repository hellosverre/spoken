import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { config } from "../src/config.ts";
import { ElksLine } from "../src/call/elks-line.ts";
import { ScribeStream } from "../src/voice/scribe.ts";
import type { LineEvents } from "../src/call/line.ts";

// A fake 46elks: its REST API is a stubbed fetch, its Realtime Voice client is a plain WebSocket
// talking to our real /elks/media route. No network, no keys.

const realFetch = globalThis.fetch;
const origScribe = { connect: ScribeStream.prototype.connect, send: ScribeStream.prototype.send, close: ScribeStream.prototype.close };
const origCfg = { provider: config.callProvider, elks: { ...config.elks }, el: config.elevenlabs.apiKey };
let server: ReturnType<typeof Bun.serve>;
let wsBase: string;
let apiCalls: { url: string; auth: string | null; form: Record<string, string> }[] = [];
let scribeSent: Uint8Array[] = [];
let n = 0;

beforeAll(() => {
  config.callProvider = "46elks";
  Object.assign(config.elks, { apiUser: "u123", apiPassword: "secretpw", number: "+4676000001", wsNumber: "+4676000002", wsSecret: "wssecret" });
  config.elevenlabs.apiKey = "test-key";
  const app = createApp();
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  wsBase = `ws://localhost:${server.port}`;
});
afterAll(() => {
  server.stop(true);
  config.callProvider = origCfg.provider;
  Object.assign(config.elks, origCfg.elks);
  config.elevenlabs.apiKey = origCfg.el;
});

beforeEach(() => {
  apiCalls = [];
  scribeSent = [];
  ScribeStream.prototype.connect = () => {};
  ScribeStream.prototype.send = function (audio: Uint8Array) { scribeSent.push(audio); };
  ScribeStream.prototype.close = () => {};
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.46elks.com/a1/calls")) {
      apiCalls.push({ url, auth: new Headers(init?.headers).get("authorization"), form: Object.fromEntries(new URLSearchParams(String(init?.body))) });
      return Response.json({ id: `c_elks_${n}`, state: "ongoing", direction: "outgoing" });
    }
    if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) {
      // 0.5 s of µ-law silence-ish tone
      return new Response(new Uint8Array(4000).fill(0x20));
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  ScribeStream.prototype.connect = origScribe.connect;
  ScribeStream.prototype.send = origScribe.send;
  ScribeStream.prototype.close = origScribe.close;
});

function events() {
  const log: { status: [string, string | undefined][]; ended: string[]; cost: any[]; debug: string[] } = { status: [], ended: [], cost: [], debug: [] };
  const ev = {
    status: (s: string, d?: string) => log.status.push([s, d]),
    calleeSpeech() {}, calleePartial() {}, calleeFinal() {},
    ended: (r: string) => log.ended.push(r),
    cost: (c: any) => log.cost.push(c),
    debug: (k: string) => log.debug.push(k),
  } as unknown as LineEvents;
  return { ev, log };
}

/** A 46elks-side socket: collects what the app sends, and can push messages like the API does. */
async function elksSocket(secret = "wssecret") {
  const got: any[] = [];
  const ws = new WebSocket(`${wsBase}/elks/media?t=${secret}`);
  ws.onmessage = (e) => got.push(JSON.parse(String(e.data)));
  const closed = new Promise<number>((r) => { ws.onclose = (e) => r(e.code); });
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws error")); });
  return { ws, got, closed, send: (m: object) => ws.send(JSON.stringify(m)) };
}

async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await Bun.sleep(10);
  }
}

function newLine() {
  const callId = `c_t${++n}`;
  const line = new ElksLine({ callId, to: "+4799999999", keyterms: [], lang: "no" });
  const { ev, log } = events();
  return { callId, line, ev, log, elksId: `c_elks_${n}` };
}

test("dials via POST /calls: basic auth, from/to, connect to the websocket number, whenhangup", async () => {
  const { line, ev, log, callId } = newLine();
  await line.start(ev);
  expect(apiCalls).toHaveLength(1);
  const c = apiCalls[0]!;
  expect(c.url).toBe("https://api.46elks.com/a1/calls");
  expect(c.auth).toBe(`Basic ${Buffer.from("u123:secretpw").toString("base64")}`);
  expect(c.form.from).toBe("+4676000001");
  expect(c.form.to).toBe("+4799999999");
  expect(JSON.parse(c.form.voice_start!)).toEqual({ connect: "+4676000002" });
  expect(c.form.whenhangup).toContain(`/elks/whenhangup?call=${callId}&t=`);
  expect(log.status).toEqual([["ringing", undefined]]);
  await line.hangup();
});

test("missing credentials fail with a clear message", async () => {
  const saved = config.elks.apiPassword;
  config.elks.apiPassword = "";
  try {
    const { line, ev } = newLine();
    await expect(line.start(ev)).rejects.toThrow(/ELKS_API_PASSWORD/);
  } finally { config.elks.apiPassword = saved; }
});

test("full call: hello → listening/sending → audio both ways → interrupt → bye", async () => {
  const { line, ev, log, elksId } = newLine();
  await line.start(ev);
  const s = await elksSocket();

  s.send({ t: "hello", callid: elksId, from: "+4676000001", to: "+4676000002" });
  await until(() => s.got.length >= 2);
  expect(s.got[0]).toEqual({ t: "listening", format: "ulaw" });
  expect(s.got[1]).toEqual({ t: "sending", format: "ulaw" });
  await until(() => log.status.some(([st]) => st === "connected"));

  // callee → us: two 20 ms µ-law frames reach Scribe as 16-bit PCM (640 bytes for 40 ms)
  const frame = Buffer.alloc(160, 0xff).toString("base64");
  s.send({ t: "audio", data: frame });
  s.send({ t: "audio", data: frame });
  await until(() => scribeSent.length >= 1);
  expect(scribeSent[0]!.length).toBe(640);

  // us → callee: speech arrives as ulaw audio messages of 160 bytes
  const spoke = line.speak(`Hei, test ${crypto.randomUUID()}.`, "say");
  await until(() => s.got.some((m) => m.t === "audio"));
  const firstAudio = s.got.find((m) => m.t === "audio");
  expect(Buffer.from(firstAudio.data, "base64").length).toBe(160);

  // barge-in: interrupt, then sending again, and the pending speak resolves interrupted
  const before = s.got.length;
  line.stopSpeaking();
  expect((await spoke).interrupted).toBe(true);
  await until(() => s.got.length >= before + 2);
  const after = s.got.slice(before).filter((m) => m.t !== "audio");
  expect(after.slice(0, 2)).toEqual([{ t: "interrupt" }, { t: "sending", format: "ulaw" }]);

  // we hang up: bye to the API; the API answers with bye; cost reported once
  await line.hangup();
  await until(() => s.got.some((m) => m.t === "bye"));
  s.send({ t: "bye", reason: "done", message: "Call finished" });
  await s.closed;
  expect(log.ended).toEqual([]); // our own hangup is not "callee hung up"
  expect(log.cost).toHaveLength(1);
  expect(log.cost[0].ttsChars).toBeGreaterThan(0);
});

test("callee hangs up: bye reason=hangup ends the call", async () => {
  const { line, ev, log, elksId } = newLine();
  await line.start(ev);
  const s = await elksSocket();
  s.send({ t: "hello", callid: elksId, from: "+1", to: "+2" });
  await until(() => log.status.some(([st]) => st === "connected"));
  s.send({ t: "bye", reason: "hangup", message: "the caller hung up" });
  await until(() => log.ended.length === 1);
  expect(log.ended[0]).toBe("callee hung up");
  await s.closed;
});

test("hello with an unknown callid still matches the one pending call", async () => {
  const { line, ev, log } = newLine();
  await line.start(ev);
  const s = await elksSocket();
  s.send({ t: "hello", callid: "something-else", from: "+1", to: "+2" });
  await until(() => log.status.some(([st]) => st === "connected"));
  await line.hangup();
  s.send({ t: "bye", reason: "done" });
  await s.closed;
});

test("wrong media secret is refused; hello with no pending call is closed", async () => {
  const bad = new WebSocket(`${wsBase}/elks/media?t=nope`);
  const refused = await new Promise<boolean>((r) => { bad.onopen = () => r(false); bad.onerror = () => r(true); bad.onclose = () => r(true); });
  expect(refused).toBe(true);

  const s = await elksSocket();
  s.send({ t: "hello", callid: "nobody", from: "+1", to: "+2" });
  expect(await s.closed).toBe(1008);
});

test("whenhangup before any hello ends an unanswered call; wrong token is rejected", async () => {
  const { line, ev, log, callId } = newLine();
  await line.start(ev);
  const token = new URL(apiCalls.at(-1)!.form.whenhangup!).searchParams.get("t")!;
  const url = (t: string) => `http://localhost:${server.port}/elks/whenhangup?call=${callId}&t=${t}`;
  const post = (t: string, body: string) => fetch(url(t), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });

  expect((await post("wrong", "state=failed")).status).toBe(403);
  expect((await post(token, "state=busy&cost=0&duration=0&id=x")).status).toBe(200);
  expect(log.status.at(-1)).toEqual(["ended", "Opptatt."]);
});

test("POST /calls failing surfaces an error", async () => {
  const { line, ev } = newLine();
  const f = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) =>
    String(input).startsWith("https://api.46elks.com") ? new Response("Not enough credits", { status: 402 }) : f(input, init)) as typeof fetch;
  await expect(line.start(ev)).rejects.toThrow(/HTTP 402/);
});
