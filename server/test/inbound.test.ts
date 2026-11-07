import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApp } from "../src/app.ts";
import { config } from "../src/config.ts";
import { rememberOutbound, resetInbound, vonageSigned } from "../src/call/inbound.ts";
import { calls } from "../src/store.ts";
import { ScribeStream } from "../src/voice/scribe.ts";
import { MockLlm } from "../src/llm/mock.ts";

// Inbound: Vonage answer webhook → NCCO + CallSession on a VonageLine; the app learns via /api/incoming.
// REST/TTS/Scribe are stubbed; the media client is a plain WebSocket against the real /vonage/media route.

const realFetch = globalThis.fetch;
const origScribe = { connect: ScribeStream.prototype.connect, send: ScribeStream.prototype.send, close: ScribeStream.prototype.close };
const origCfg = { provider: config.callProvider, vonage: { ...config.vonage }, el: config.elevenlabs.apiKey, pub: config.publicUrl };
const DEVICE = "11111111-1111-4111-8111-111111111111";
const DEVICE2 = "22222222-2222-4222-8222-222222222222";
let server: ReturnType<typeof Bun.serve>;
let base = "";
let n = 0;

beforeAll(() => {
  config.callProvider = "vonage";
  Object.assign(config.vonage, { applicationId: "app-1", privateKey: "unused", number: "+4420000000" });
  config.elevenlabs.apiKey = "test-key";
  config.publicUrl = "https://spoken.example";
  const app = createApp(new MockLlm(0));
  server = Bun.serve({ port: 0, fetch: app.fetch, websocket: app.websocket });
  base = `http://localhost:${server.port}`;
});
afterAll(() => {
  server.stop(true);
  config.callProvider = origCfg.provider;
  Object.assign(config.vonage, origCfg.vonage);
  config.elevenlabs.apiKey = origCfg.el;
  config.publicUrl = origCfg.pub;
});
beforeEach(() => {
  resetInbound();
  ScribeStream.prototype.connect = () => {};
  ScribeStream.prototype.send = () => {};
  ScribeStream.prototype.close = () => {};
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.nexmo.com/")) return new Response(null, { status: 204 });
    if (url.startsWith("https://api.elevenlabs.io/")) return new Response(new Uint8Array(4000).fill(0x20));
    return realFetch(input, init);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Object.assign(ScribeStream.prototype, origScribe);
});

const profile = { name: "Sverre", hearCall: true, personality: "warm" as const, lang: "no" as const };
function seed(callee: string, device = DEVICE) {
  rememberOutbound({ callee, calleeName: "Pizzabakeren", device, taskText: "Bestill en pepperoni til henting", profile, callId: "c_old", lang: "no" });
}
const answer = (from: string) => realFetch(`${base}/vonage/answer?to=442039616247&from=${from}&uuid=in-${++n}&conversation_uuid=CON-${n}`);
const incoming = (device: string) => realFetch(`${base}/api/incoming?device=${device}`);
const callIdOf = (ncco: any) => new URL(ncco[0].endpoint[0].uri).searchParams.get("call")!;
async function until(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timeout"); await Bun.sleep(10); }
}
async function connectMedia(ncco: any) {
  const uri = new URL(ncco[0].endpoint[0].uri);
  const ws = new WebSocket(`ws://localhost:${server.port}${uri.pathname}${uri.search}`);
  await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("ws error")); });
  ws.send(JSON.stringify({ event: "websocket:connected", "content-type": "audio/l16;rate=16000" }));
  return ws;
}
const agentLines = (callId: string) => calls.get(callId)!.events.filter((e) => e.type === "transcript" && e.who === "agent").map((e: any) => e.text as string);

test("matched callback: NCCO connects the websocket, session greets for the right device, app sees it once", async () => {
  seed("+4799990001");
  const r = await answer("4799990001");
  const ncco: any = await r.json();
  expect(ncco[0].action).toBe("connect");
  expect(ncco[0].endpoint[0].type).toBe("websocket");
  expect(ncco[0].endpoint[0]["content-type"]).toBe("audio/l16;rate=16000");
  expect(ncco[0].eventUrl[0]).toContain("/vonage/event?leg=ws&call=");
  const callId = callIdOf(ncco);

  const first = await incoming(DEVICE);
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ callId, callerName: "Pizzabakeren", topic: "Bestill en pepperoni til henting" });
  expect((await incoming(DEVICE)).status).toBe(204); // once
  expect((await incoming(DEVICE2)).status).toBe(204); // other devices never see it

  const ws = await connectMedia(ncco);
  await until(() => agentLines(callId).length > 0);
  const greet = agentLines(callId)[0]!;
  expect(greet).toBe("Hei, dette er Spoken, KI-assistenten til Sverre. Ringer du tilbake om Bestill en pepperoni til henting?");
  expect(calls.get(callId)!.inbound).toBe(true);
  ws.close();
  await realFetch(`${base}/vonage/event`, { method: "POST", body: JSON.stringify({ uuid: `in-${n}`, status: "completed" }), headers: { "content-type": "application/json" } });
  await until(() => calls.get(callId)!.isEnded);
});

test("unmatched caller: message-taking greeting, summary goes to the most recent device", async () => {
  seed("+4799990002", DEVICE2);
  const r = await answer("4700000099");
  const ncco: any = await r.json();
  const callId = callIdOf(ncco);
  const inc = await (await incoming(DEVICE2)).json() as any;
  expect(inc.callId).toBe(callId);
  expect(inc.callerName).toBe("+4700000099");
  const ws = await connectMedia(ncco);
  await until(() => agentLines(callId).length > 0);
  expect(agentLines(callId)[0]).toBe("Hei, dette er Spoken, en KI-assistent. Sverre kan ikke ta telefonen. Hva gjelder det?");
  ws.close();
});

test("callbacks older than 24 h are not matched", async () => {
  seed("+4799990003");
  const real = Date.now;
  Date.now = () => real() + 25 * 3600_000;
  try {
    const ncco: any = await (await answer("4799990003")).json();
    expect(ncco[0].action).toBe("connect");
    // Unmatched and the fallback memory is stale too: nobody to tell.
    expect((await incoming(DEVICE)).status).toBe(204);
  } finally { Date.now = real; }
});

test("/api/incoming needs a valid device id", async () => {
  expect((await incoming("nope")).status).toBe(400);
});

test("signed webhooks: HS256 Bearer is checked only when VONAGE_SIGNATURE_SECRET is set", () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const sign = (secret: string, claims: object) => {
    const h = b64({ alg: "HS256", typ: "JWT" }), p = b64(claims);
    return `${h}.${p}.${createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url")}`;
  };
  const req = (auth?: string) => new Request("http://x/vonage/answer", { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
  const iat = Math.floor(Date.now() / 1000);
  expect(vonageSigned(req(), undefined)).toBe(true);
  expect(vonageSigned(req(), "")).toBe(true);
  expect(vonageSigned(req(sign("s3cret", { iat })), "s3cret")).toBe(true);
  expect(vonageSigned(req(sign("other", { iat })), "s3cret")).toBe(false);
  expect(vonageSigned(req(), "s3cret")).toBe(false);
  expect(vonageSigned(req(sign("s3cret", { iat: iat - 3600 })), "s3cret")).toBe(false);
});
