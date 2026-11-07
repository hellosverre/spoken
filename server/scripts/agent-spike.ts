// ElevenLabs Agents spike harness.  All commands need keys: run through bas-secret.
//   provision                      create/update agent, tool, Telnyx FQDN connection, SIP-trunk number
//   sim                            text-only simulated conversation (no phone, no Telnyx cost) incl. the approval tool
//   call +47XXXXXXXX [goal…]       real outbound call; prints live transcript, approvals auto-answer APPROVE (default JA) after APPROVE_AFTER s
//   report <conversation_id>       per-turn latency + interruption stats from the platform's own data
// The harness serves the tool webhook itself on PORT (8787): stop Lim's server first (same tunnel).
import { ElevenAgentEngine, handleToolRequest, latencyReport, type ConversationDoc } from "../src/engines/eleven-agent/engine.ts";
import { eleven } from "../src/engines/eleven-agent/api.ts";
import { loadState, provision } from "../src/engines/eleven-agent/provision.ts";
import { DEFAULT_VARS } from "../src/engines/eleven-agent/prompt.ts";

const [cmd, arg, ...rest] = process.argv.slice(2);
const PUBLIC_URL = process.env.PUBLIC_URL ?? "https://spoken-api.hellosverre.com";
const PORT = Number(process.env.PORT ?? 8787);
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;

function serveTool(secret: string, onApproval: (q: string, o: string[]) => Promise<string>) {
  // The engine's registry decides which conversation a request belongs to; the harness only hosts the route.
  return Bun.serve({
    port: PORT,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/eleven/tool/approval") { console.log(`${ts()} [tool] webhook hit`); return handleToolRequest(req, secret); }
      return new Response("spoken eleven-agent spike", { status: 200 });
    },
  });
}

function report(doc: ConversationDoc) {
  const rows = latencyReport(doc);
  console.log(`\nstatus=${doc.status} duration=${doc.metadata?.call_duration_secs}s turns=${doc.transcript.length} termination=${doc.metadata?.termination_reason}`);
  for (const r of rows) console.log(`agent turn ${String(r.turn).padStart(2)}  gap(user→agent) ${r.gapSec ?? "-"}s  ${JSON.stringify(r.metrics)}`);
  const gaps = rows.map((r) => r.gapSec).filter((g): g is number => g !== null).sort((a, b) => a - b);
  if (gaps.length) console.log(`gap user-turn-start→agent-turn-start: median ${gaps[Math.floor(gaps.length / 2)]}s, min ${gaps[0]}s, max ${gaps.at(-1)}s (n=${gaps.length})`);
  const interrupted = doc.transcript.filter((t) => t.interrupted).length;
  console.log(`interrupted turns: ${interrupted}`);
}

if (cmd === "provision") {
  const s = await provision({ publicUrl: PUBLIC_URL, fromNumber: process.env.TELNYX_FROM_NUMBER ?? "+17733408724" });
  console.log({ ...s, toolSecret: "<hidden>" });
} else if (cmd === "report") {
  report(await eleven.get(`/v1/convai/conversations/${arg}`));
} else if (cmd === "sim") {
  // Text-only chat over the agent websocket (the old simulate-conversation endpoint was sunset 31 Oct 2026).
  // The real tool webhook is hit through PUBLIC_URL, so this proves the tunnel + tool wiring without a phone call.
  const s = loadState();
  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname !== "/eleven/tool/approval") return new Response("ok");
      if (req.headers.get("x-spoken-secret") !== s.toolSecret) return new Response("forbidden", { status: 403 });
      const b: any = await req.json();
      console.log(`${ts()} [tool] question="${b.question}" options="${b.options}" conv=${String(b.conversation_id).slice(0, 12)}…`);
      await new Promise((r) => setTimeout(r, 1500)); // the user taps JA after 1.5 s
      return Response.json({ answer: "JA", instruction: "Brukeren sa JA. Gå videre og bekreft." });
    },
  });
  const { signed_url } = await eleven.get(`/v1/convai/conversation/get-signed-url?agent_id=${s.agentId}`);
  const ws = new WebSocket(signed_url);
  const callee = ["Hei, Pizzabakeren, Ola her.", "Ja, stor pepperoni koster 189 kroner. Den er klar om tjue minutter.", "Greit, hvilket navn skal den stå på?", "Takk, den er notert. Ha en fin dag!"];
  let next = 0;
  const sendCallee = () => { if (next < callee.length) { console.log(`${ts()} callee: ${callee[next]}`); ws.send(JSON.stringify({ type: "user_message", text: callee[next++] })); } };
  ws.onopen = () => ws.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: DEFAULT_VARS, conversation_config_override: { conversation: { text_only: true } } }));
  ws.onmessage = (m) => {
    const e = JSON.parse(String(m.data));
    if (e.type === "ping") ws.send(JSON.stringify({ type: "pong", event_id: e.ping_event.event_id }));
    else if (e.type === "agent_response") { console.log(`${ts()} agent : ${e.agent_response_event.agent_response}`); setTimeout(sendCallee, 600); }
    else if (e.type === "conversation_initiation_metadata") console.log(`${ts()} conversation ${e.conversation_initiation_metadata_event.conversation_id}`);
    else if (!["audio", "vad_score", "internal_tentative_agent_response", "agent_response_correction", "user_transcript"].includes(e.type)) console.log(`${ts()} <${e.type}> ${JSON.stringify(e).slice(0, 200)}`);
  };
  setTimeout(() => { ws.close(); server.stop(true); process.exit(0); }, 60_000);
} else if (cmd === "call") {
  const to = arg;
  if (!to?.startsWith("+")) { console.error("usage: agent-spike.ts call +47XXXXXXXX [goal]"); process.exit(1); }
  const s = loadState();
  const answer = process.env.APPROVE ?? "JA";
  const wait = Number(process.env.APPROVE_AFTER ?? 4) * 1000;
  let doc: ConversationDoc | null = null;
  const eng: ElevenAgentEngine = new ElevenAgentEngine(s, {
    status: (st, d) => console.log(`${ts()} STATUS ${st}${d ? ` (${d})` : ""}`),
    transcript: (t) => console.log(`${ts()} ${t.who.padEnd(6)} [call ${t.atSec.toFixed(1)}s] ${t.text}   (seen +${((Date.now() - t0) / 1000).toFixed(1)}s)`),
    requestApproval: async (_id, q, o) => { console.log(`${ts()} APPROVAL ${q} [${o}] → ${answer} in ${wait / 1000}s`); await new Promise((r) => setTimeout(r, wait)); return answer; },
    ended: (reason, d) => { console.log(`${ts()} ENDED ${reason}`); doc = d; },
  });
  const server = serveTool(s.toolSecret!, async () => answer);
  const goal = rest.length ? `${arg === to ? "" : ""}${rest.join(" ")}` : DEFAULT_VARS.goal;
  const id = await eng.dial(to, { ...DEFAULT_VARS, goal });
  console.log(`${ts()} conversation ${id}`);
  process.on("SIGINT", () => { void eng.hangup(); setTimeout(() => process.exit(0), 100); });
  while (!doc) await new Promise((r) => setTimeout(r, 500));
  // The platform finalises the transcript/metrics a few seconds after hangup.
  await new Promise((r) => setTimeout(r, 6000));
  report(await eleven.get(`/v1/convai/conversations/${id}`));
  server.stop(true);
  process.exit(0);
} else {
  console.error("commands: provision | sim | call +47… [goal] | report <conversation_id>");
  process.exit(1);
}
