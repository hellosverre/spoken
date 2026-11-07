// Latency replay: the real Telnyx line code (Scribe, VAD, player, TTS) and the real LLM, with a
// fake media socket instead of a phone call. A scripted shop (pre-generated Norwegian audio,
// cached) answers in real time. Ground truth: callee audio ends → first agent audio frame.
// Usage: bun scripts/replay.ts [label]   (needs ELEVENLABS + LLM keys via bas-secret)
import { CallSession } from "../src/call/session.ts";
import { TelnyxLine } from "../src/call/telnyx-line.ts";
import { createLlm } from "../src/llm/index.ts";
import { concat, tts } from "../src/voice/tts.ts";
import type { LiveEvent, Plan } from "../../shared/contract.ts";

const SHOP_VOICE = "JBFqnCBsd6RMkjVDRZzb"; // George, so the shop sounds unlike the agent
const silence = (ms: number) => new Uint8Array(ms * 8).fill(0xff);
async function clip(text: string) { const p: Uint8Array[] = []; for await (const c of tts(text, { voiceId: SHOP_VOICE, cache: true })) p.push(c); return concat(p); }

const SCRIPT = [
  await clip("Hei, Domino's Storo. Hva kan jeg hjelpe deg med?"),
  // A mid-sentence pause: the guard must not answer after "Det blir".
  concat([await clip("Det blir"), silence(450), await clip("hundre og åttini kroner. Skal jeg legge den inn?")]),
  await clip("Flott. Hvilket navn skal den stå på?"),
  await clip("Supert, den er klar klokka seks. Ha det bra!"),
];

const plan: Plan = {
  taskId: "replay", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting klokka 18:00", opening: "",
  willShare: ["name"], needsApprovalFor: ["pris over 0 kr"], voiceId: "nPczCjzI2devNBz1zQrb",
};
const callId = `replay_${Date.now().toString(36)}`;
const line = new TelnyxLine({ callId, to: "+4722000001", keyterms: ["KI-assistent", "Domino's", "pepperoni"], offline: true });
const session = new CallSession({ callId, taskId: "replay", plan, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: createLlm() });

const FILLER = /^(Ja,|Mm,|Okei,|Mm, et øyeblikk\.|Et lite øyeblikk\.|Ja, la meg se\.)$/;
let lastAgentFrame = 0;
const agentFrames: number[] = [];
const fakeWs: any = {
  send(m: string) { if (m.includes('"media"')) { lastAgentFrame = Date.now(); agentFrames.push(lastAgentFrame); } },
  close() {},
};
const sayStarts: { at: number; text: string }[] = [];
const events: LiveEvent[] = [];
session.subscribe((e) => {
  events.push(e);
  if (e.type === "transcript" && e.who === "agent" && !e.final) sayStarts.push({ at: e.at, text: e.text });
  if (e.type === "approval_request") setTimeout(() => session.command({ type: "approval_response", id: e.id, choice: "JA" }), 600);
});

await session.start();
line.attach(fakeWs);
line.onMedia(JSON.stringify({ event: "start", start: { media_format: { encoding: "PCMU", sample_rate: 8000, channels: 1 } } }));
await Bun.sleep(50);

// Feed 20 ms frames continuously: clip audio when the shop talks, silence otherwise.
let queue: Uint8Array = new Uint8Array(0);
let qOff = 0;
let clipEndAt = 0;
const feeder = setInterval(() => {
  let f: Uint8Array;
  if (qOff < queue.length) {
    f = queue.subarray(qOff, qOff + 160); qOff += 160;
    if (qOff >= queue.length) clipEndAt = Date.now();
  } else f = silence(20);
  line.onMedia(JSON.stringify({ event: "media", media: { payload: Buffer.from(f).toString("base64") } }));
}, 20);

const turns: { any: number; content: number; agent: string }[] = [];
const waitAgentDone = async () => {
  // agent spoke after the clip, then 700 ms with no frames (and nothing pending)
  for (let i = 0; i < 300; i++) {
    await Bun.sleep(50);
    if (session.isEnded) return;
    // Done = real content (not a backchannel) has been said since the clip, then 700 ms quiet.
    const contentSince = sayStarts.some((s) => s.at >= clipEndAt - 2000 && !FILLER.test(s.text));
    if ((contentSince || session.isEnded) && agentFrames.some((t) => t > clipEndAt) && Date.now() - lastAgentFrame > 700) return;
  }
};

await waitAgentDone(); // opening
for (const c of SCRIPT) {
  if (session.isEnded) break;
  await Bun.sleep(400);
  queue = c; qOff = 0; clipEndAt = Number.MAX_SAFE_INTEGER;
  while (clipEndAt === Number.MAX_SAFE_INTEGER) await Bun.sleep(10);
  const end = clipEndAt;
  await waitAgentDone();
  const firstAny = agentFrames.find((t) => t >= end);
  const contentSay = sayStarts.find((s) => s.at >= end - 2000 && !FILLER.test(s.text) && !/^Et øyeblikk/.test(s.text));
  const firstContent = contentSay ? agentFrames.find((t) => t >= Math.max(end, contentSay.at)) : undefined;
  turns.push({ any: firstAny ? firstAny - end : NaN, content: firstContent ? firstContent - end : NaN, agent: sayStarts.filter((s) => s.at >= end - 2000).map((s) => s.text).join(" | ") });
}
clearInterval(feeder);
await session.finish("replay done");

const med = (xs: number[]) => { const s = xs.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1]! : NaN; };
console.log(`\n${process.argv[2] ?? "run"}: callee audio ends → agent audio (ms)`);
turns.forEach((t, i) => console.log(`  turn ${i + 1}: any ${String(t.any).padStart(5)} | content ${String(t.content).padStart(5)} | ${t.agent.slice(0, 110)}`));
console.log(`  MEDIAN any ${med(turns.map((t) => t.any))} ms | content ${med(turns.map((t) => t.content))} ms`);
const lat = events.filter((e: any) => e.type === "latency") as any[];
console.log(`  server latency events: stt ${med(lat.map((l) => l.sttMs))} | llm ${med(lat.map((l) => l.llmMs))} | tts ${med(lat.map((l) => l.ttsMs))} | total ${med(lat.map((l) => l.totalMs))}`);
process.exit(0);
