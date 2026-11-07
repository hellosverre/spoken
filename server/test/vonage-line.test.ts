import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createPublicKey, generateKeyPairSync, createVerify } from "node:crypto";
import { createApp } from "../src/app.ts";
import { config } from "../src/config.ts";
import { VonageLine, down16to8, ulawToPcm16k, vonageJwt } from "../src/call/vonage-line.ts";
import { ScribeStream } from "../src/voice/scribe.ts";
import type { LineEvents } from "../src/call/line.ts";

// Fake Vonage: REST is a stubbed fetch, the media client is a plain WebSocket against our real
// /vonage/media route. No network, no keys.

const realFetch = globalThis.fetch;
const origScribe = { connect: ScribeStream.prototype.connect, send: ScribeStream.prototype.send, close: ScribeStream.prototype.close };
const origCfg = { provider: config.callProvider, vonage: { ...config.vonage }, el: config.elevenlabs.apiKey, pub: config.publicUrl };
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
let server: ReturnType<typeof Bun.serve>;
let apiCalls: { method: string; url: string; auth: string | null; body: any }[] = [];
let scribeSent: Uint8Array[] = [];
let n = 0;

beforeAll(() => {
  config.callProvider = "vonage";
  Object.assign(config.vonage, { applicationId: "app-1234", privateKey, number: "+4770000001" });
  config.elevenlabs.apiKey = "test-key";
  config.publicUrl = "https://spoken.example";
  const app = createApp();
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
});
afterAll(() => {
  server.stop(true);
  config.callProvider = origCfg.provider;
  Object.assign(config.vonage, origCfg.vonage);
  config.elevenlabs.apiKey = origCfg.el;
  config.publicUrl = origCfg.pub;
});

beforeEach(() => {
  apiCalls = [];
  scribeSent = [];
  ScribeStream.prototype.connect = () => {};
  ScribeStream.prototype.send = function (audio: Uint8Array) { scribeSent.push(audio); };
  ScribeStream.prototype.close = () => {};
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.nexmo.com/")) {
      apiCalls.push({ method: init?.method, url, auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
      return init?.method === "PUT" ? new Response(null, { status: 204 }) : Response.json({ uuid: `uuid-${n}`, status: "started", direction: "outbound" });
    }
    if (url.startsWith("https://api.elevenlabs.io/v1/text-to-speech/")) return new Response(new Uint8Array(4000).fill(0x20));
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
  const log: { status: [string, string | undefined][]; ended: string[]; cost: any[] } = { status: [], ended: [], cost: [] };
  const ev = {
    status: (s: string, d?: string) => log.status.push([s, d]),
    calleeSpeech() {}, calleePartial() {}, calleeFinal() {},
    ended: (r: string) => log.ended.push(r),
    cost: (c: any) => log.cost.push(c),
    debug() {},
  } as unknown as LineEvents;
  return { ev, log };
}

function newLine() {
  const callId = `c_v${++n}`;
  const line = new VonageLine({ callId, to: "+4799999999", keyterms: [], lang: "no" });
  const { ev, log } = events();
  return { callId, line, ev, log };
}

/** The ncco's websocket URI, rewritten to our local test server. */
function mediaUrl(): string {
  const uri = new URL(apiCalls.find((c) => c.method === "POST")!.body.ncco[0].endpoint[0].uri);
  return `ws://localhost:${server.port}${uri.pathname}${uri.search}`;
}

async function vonageSocket(url: string) {
  const text: any[] = [];
  const bin: Uint8Array[] = [];
  const ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onmessage = (e) => (typeof e.data === "string" ? text.push(JSON.parse(e.data)) : bin.push(new Uint8Array(e.data as ArrayBuffer)));
  const closed = new Promise<number>((r) => { ws.onclose = (e) => r(e.code); });
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws error")); });
  const hello = () => ws.send(JSON.stringify({ event: "websocket:connected", "content-type": "audio/l16;rate=16000", callId: "x" }));
  return { ws, text, bin, closed, hello };
}

async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout waiting for condition");
    await Bun.sleep(10);
  }
}

const event = (callId: string, token: string, body: object) =>
  fetch(`http://localhost:${server.port}/vonage/event?call=${callId}&t=${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const tokenOf = () => new URL(apiCalls[0]!.body.event_url[0]).searchParams.get("t")!;

test("JWT is RS256 with application_id and verifies against the public key", () => {
  const jwt = vonageJwt("app-1234", privateKey.replace(/\n/g, "\\n")); // env-style escaped newlines
  const [h, p, s] = jwt.split(".");
  expect(JSON.parse(Buffer.from(h!, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
  expect(claims.application_id).toBe("app-1234");
  expect(claims.exp).toBeGreaterThan(claims.iat);
  expect(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(createPublicKey(publicKey), Buffer.from(s!, "base64url"))).toBe(true);
});

test("sample-rate conversion: 16k→8k halves, µ-law→16k PCM is 640 bytes per 20 ms", () => {
  const f = new Uint8Array(640);
  new DataView(f.buffer).setInt16(0, 1000, true); new DataView(f.buffer).setInt16(2, 3000, true);
  const d = down16to8(f);
  expect(d.length).toBe(160);
  expect(d[0]).toBe(2000);
  expect(ulawToPcm16k(new Uint8Array(160).fill(0xff), { v: 0 }).length).toBe(640);
});

test("dials via POST /v1/calls: JWT bearer, digits-only numbers, inline NCCO websocket connect", async () => {
  const { line, ev, log, callId } = newLine();
  await line.start(ev);
  const c = apiCalls[0]!;
  expect(c.url).toBe("https://api.nexmo.com/v1/calls");
  expect(c.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  expect(c.body.to).toEqual([{ type: "phone", number: "4799999999" }]);
  expect(c.body.from).toEqual({ type: "phone", number: "4770000001" });
  const ep = c.body.ncco[0].endpoint[0];
  expect(c.body.ncco[0].action).toBe("connect");
  expect(ep.type).toBe("websocket");
  expect(ep["content-type"]).toBe("audio/l16;rate=16000");
  expect(ep.headers).toEqual({ callId });
  expect(ep.uri).toStartWith(`wss://spoken.example/vonage/media?call=${callId}&t=`);
  expect(c.body.event_url[0]).toStartWith(`https://spoken.example/vonage/event?call=${callId}&t=`);
  expect(log.status).toEqual([["ringing", undefined]]);
  await line.hangup();
});

test("missing credentials fail with a clear message", async () => {
  const saved = config.vonage.applicationId;
  config.vonage.applicationId = "";
  try {
    const { line, ev } = newLine();
    await expect(line.start(ev)).rejects.toThrow(/VONAGE_APPLICATION_ID/);
  } finally { config.vonage.applicationId = saved; }
});

test("media socket needs the per-call token", async () => {
  const { line, ev } = newLine();
  await line.start(ev);
  const bad = new WebSocket(mediaUrl().replace(/t=\w+$/, "t=nope"));
  const refused = await new Promise<boolean>((r) => { bad.onopen = () => r(false); bad.onerror = () => r(true); bad.onclose = () => r(true); });
  expect(refused).toBe(true);
  await line.hangup();
});

test("full call: answered + connected → audio both ways → barge-in → our hangup (PUT hangup)", async () => {
  const { line, ev, log, callId } = newLine();
  await line.start(ev);
  const token = tokenOf();
  const s = await vonageSocket(mediaUrl());
  s.hello();
  expect((await event(callId, token, { status: "answered", uuid: "u" })).status).toBe(200);
  await until(() => log.status.some(([st]) => st === "connected"));

  // callee → us: two 640-byte 16 kHz frames reach Scribe as 8 kHz PCM (640 bytes per 40 ms)
  const frame = new Uint8Array(640);
  s.ws.send(frame); s.ws.send(frame);
  await until(() => scribeSent.length >= 1);
  expect(scribeSent[0]!.length).toBe(640);

  // us → callee: binary 640-byte frames
  const spoke = line.speak(`Hei, test ${crypto.randomUUID()}.`, "say");
  await until(() => s.bin.length >= 3);
  expect(s.bin.every((b) => b.length === 640)).toBe(true);

  // barge-in: queue cleared, speak resolves interrupted, sending stops shortly after
  line.stopSpeaking();
  expect((await spoke).interrupted).toBe(true);
  await Bun.sleep(150);
  const settled = s.bin.length;
  await Bun.sleep(200);
  expect(s.bin.length).toBe(settled);

  await line.hangup();
  const put = apiCalls.find((c) => c.method === "PUT")!;
  expect(put.url).toBe("https://api.nexmo.com/v1/calls/uuid-" + n);
  expect(put.body).toEqual({ action: "hangup" });
  await s.closed;
  expect(log.ended).toEqual([]);
  expect(log.cost).toHaveLength(1);
  expect(log.cost[0].ttsChars).toBeGreaterThan(0);
});

test("callee hangs up: completed event ends the call", async () => {
  const { line, ev, log, callId } = newLine();
  await line.start(ev);
  const token = tokenOf();
  const s = await vonageSocket(mediaUrl());
  s.hello();
  await event(callId, token, { status: "answered" });
  await until(() => log.status.some(([st]) => st === "connected"));
  await event(callId, token, { status: "completed", duration: "7", price: "0.01" });
  expect(log.ended).toEqual(["callee hung up"]);
  await s.closed;
});

test("unanswered/busy before answer ends without a media socket; wrong token is rejected", async () => {
  const { line, ev, log, callId } = newLine();
  await line.start(ev);
  expect((await event(callId, "wrong", { status: "busy" })).status).toBe(403);
  expect((await event(callId, tokenOf(), { status: "busy" })).status).toBe(200);
  expect(log.status.at(-1)).toEqual(["ended", "Opptatt."]);
});

test("POST /calls failing surfaces an error", async () => {
  const { line, ev } = newLine();
  const f = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) =>
    String(input).startsWith("https://api.nexmo.com") ? new Response('{"title":"Unauthorized"}', { status: 401 }) : f(input, init)) as typeof fetch;
  await expect(line.start(ev)).rejects.toThrow(/HTTP 401/);
});

test("sendDtmf PUTs /v1/calls/{uuid}/dtmf with the digits; invalid digits are refused; nothing after hangup", async () => {
  const { line, ev } = newLine();
  await line.start(ev);
  await line.sendDtmf("1*#0");
  const dtmf = apiCalls.find((c) => c.method === "PUT")!;
  expect(dtmf.url).toBe(`https://api.nexmo.com/v1/calls/uuid-${n}/dtmf`);
  expect(dtmf.body).toEqual({ digits: "1*#0" });
  expect(dtmf.auth).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);

  const before = apiCalls.length;
  await expect(line.sendDtmf("1a")).rejects.toThrow(/ugyldige DTMF-tegn/);
  expect(apiCalls.length).toBe(before);

  await line.hangup();
  const afterHangup = apiCalls.length;
  await line.sendDtmf("5");
  expect(apiCalls.length).toBe(afterHangup);
});
