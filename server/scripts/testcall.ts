// Real test call through the running server (CALL_PROVIDER=telnyx). The number must be on
// CALL_ALLOWLIST. Prints the live transcript. Usage: bun scripts/testcall.ts +47XXXXXXXX ["task"]
const to = process.argv[2];
if (!to) { console.error("usage: bun scripts/testcall.ts +47XXXXXXXX [task]"); process.exit(1); }
const task = process.argv[3] ?? "Ring og si hei, og spør hvordan det går";
const base = process.env.API ?? `http://localhost:${process.env.PORT ?? 8787}`;

const post = async (p: string, b: unknown) => {
  const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  const j: any = await r.json();
  if (!r.ok) { console.error(`${p}: ${r.status} ${j.error}`); process.exit(1); }
  return j;
};

const c = await post("/api/tasks", { text: task, lang: "no", phone: to });
const answers: Record<string, string> = {};
for (const q of c.questions) answers[q.id] = q.options?.[0] ?? "ja";
const plan = await post(`/api/tasks/${c.taskId}/answers`, { answers });
if (plan.blocked) { console.error("blocked:", plan.blocked.reason); process.exit(1); }
// Test calls are capped at 60 s (Telnyx budget, Sat 7 Nov); MAX_SEC=… to override.
const { callId } = await post(`/api/tasks/${c.taskId}/call`, { approved: true, maxSec: Number(process.env.MAX_SEC ?? 60) });

const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
const ws = new WebSocket(`${base.replace(/^http/, "ws")}/api/calls/${callId}/live`);
ws.onmessage = (m) => {
  const e = JSON.parse(String(m.data));
  if (e.type === "transcript") {
    if (!e.final) return;
    const unsure = e.words?.filter((w: any) => w.confidence < 0.6).map((w: any) => w.text) ?? [];
    console.log(`${ts()} ${e.who.padEnd(6)} ${e.text}${unsure.length ? `   [usikre: ${unsure.join(" ")}]` : ""}`);
  } else if (e.type === "approval_request") {
    console.log(`${ts()} APPROVAL ${e.question} → auto JA`);
    ws.send(JSON.stringify({ type: "approval_response", id: e.id, choice: "JA" }));
  } else if (e.type === "result") {
    console.log(`${ts()} RESULT ${e.result.outcome}: ${e.result.summary} (${e.result.durationSec}s)`);
    process.exit(0);
  } else if (e.type === "latency") {
    console.log(`${ts()} latency stt ${e.sttMs} | llm ${e.llmMs} | tts ${e.ttsMs} | total ${e.totalMs} ms`);
  } else if (e.type !== "agent_typing" && e.type !== "level") {
    console.log(`${ts()} ${e.type} ${e.status ?? e.text ?? ""}`);
  }
};

// Ctrl-C hangs up cleanly.
process.on("SIGINT", async () => {
  await fetch(`${base}/api/calls/${callId}/hangup`, { method: "POST" });
  setTimeout(() => process.exit(0), 6000);
});
