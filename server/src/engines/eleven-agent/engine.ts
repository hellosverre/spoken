// ElevenLabs Agents as a call engine. Same shape as the rest of Spoken wants from an engine:
// dial(), live events out (status / transcript / approval_request), approval answers in, hangup().
// ElevenLabs runs STT + LLM + TTS + turn-taking on its side; we only place the call, serve the
// approval tool (blocks until the app's JA/NEI arrives) and follow the transcript.
//
// Live transcript without Enterprise: there is no monitoring socket, so we poll
// GET /v1/convai/conversations/:id (~700 ms) and emit new turns. Turns are final-only, no words.

import type { CallStatus } from "../../../../shared/contract.ts";
import { eleven } from "./api.ts";
import type { SpikeState } from "./provision.ts";

export interface EngineHooks {
  status(status: CallStatus, detail?: string): void;
  /** A finished turn (the agent platform only exposes whole turns while the call runs). */
  transcript(t: { id: string; who: "callee" | "agent"; text: string; atSec: number }): void;
  /** The agent wants a commitment approved. Resolve with the app's choice ("JA" / "NEI"). */
  requestApproval(id: string, question: string, options: string[]): Promise<string>;
  ended(reason: string, conversation: ConversationDoc | null): void;
}

export interface Turn {
  role: "agent" | "user";
  message: string | null;
  time_in_call_secs: number;
  tool_calls?: { tool_name: string; params_as_json?: string; request_id?: string; tool_has_been_called?: boolean }[];
  tool_results?: { tool_name: string; result_value?: string; is_error?: boolean; tool_latency_secs?: number }[];
  conversation_turn_metrics?: { metrics?: Record<string, { elapsed_time: number }> } | null;
  interrupted?: boolean;
}
export interface ConversationDoc {
  conversation_id: string;
  status: "initiated" | "in-progress" | "processing" | "done" | "failed";
  transcript: Turn[];
  metadata?: Record<string, any>;
}

const TERMINAL = new Set(["done", "failed", "processing"]);
const live = new Map<string, ElevenAgentEngine>(); // by conversation id, for the tool webhook

export class ElevenAgentEngine {
  conversationId = "";
  private seen = 0;
  private lastStatus = "";
  private stopped = false;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private approvalSeq = 0;
  /** Wall-clock ms when each turn was first seen by the poller (live-transcript lag figure). */
  readonly seenAt: number[] = [];

  constructor(private state: SpikeState, private hooks: EngineHooks) {}

  async dial(to: string, vars: Record<string, string>): Promise<string> {
    if (!this.state.agentId || !this.state.phoneNumberId) throw new Error("not provisioned: run `bun scripts/agent-spike.ts provision`");
    this.hooks.status("dialing");
    const r = await eleven.post("/v1/convai/sip-trunk/outbound-call", {
      agent_id: this.state.agentId,
      agent_phone_number_id: this.state.phoneNumberId,
      to_number: to,
      conversation_initiation_client_data: { dynamic_variables: vars },
    });
    if (!r.success) throw new Error(`outbound call refused: ${r.message}`);
    this.conversationId = r.conversation_id;
    live.set(this.conversationId, this);
    this.hooks.status("ringing");
    void this.poll();
    return this.conversationId;
  }

  private async poll() {
    if (this.stopped) return;
    let doc: ConversationDoc | null = null;
    try { doc = await eleven.get<ConversationDoc>(`/v1/convai/conversations/${this.conversationId}`); }
    catch (e) { console.warn("[eleven] poll failed:", (e as Error).message); }
    if (doc) {
      if (doc.status !== this.lastStatus) {
        this.lastStatus = doc.status;
        if (doc.status === "in-progress") this.hooks.status("connected");
      }
      for (; this.seen < doc.transcript.length; this.seen++) {
        const t = doc.transcript[this.seen]!;
        this.seenAt[this.seen] = Date.now();
        if (!t.message) continue;
        this.hooks.transcript({ id: `t${this.seen}`, who: t.role === "agent" ? "agent" : "callee", text: t.message, atSec: t.time_in_call_secs });
      }
      if (TERMINAL.has(doc.status)) {
        this.stopped = true;
        live.delete(this.conversationId);
        const reason = doc.status === "failed" ? `failed: ${doc.metadata?.termination_reason ?? "unknown"}` : String(doc.metadata?.termination_reason ?? "ended");
        this.hooks.status(doc.status === "failed" ? "failed" : "ended", reason);
        this.hooks.ended(reason, doc);
        return;
      }
    }
    this.pollTimer = setTimeout(() => void this.poll(), 700);
  }

  async hangup() {
    // The platform has no hangup endpoint for SIP calls; max_duration_seconds (agent config) is the backstop.
    // Closest thing: let end_call fire by telling nobody; the harness simply stops following.
    this.stopped = true;
    clearTimeout(this.pollTimer);
    live.delete(this.conversationId);
  }

  /** Called by the tool webhook while the model waits. */
  async approval(question: string, options: string[]): Promise<string> {
    const id = `ap${++this.approvalSeq}`;
    this.hooks.status("on_hold", "venter på godkjenning");
    try { return await this.hooks.requestApproval(id, question, options); }
    finally { this.hooks.status("connected"); }
  }
}

/** Webhook handler for the `ask_user_approval` server tool. Mount at POST /eleven/tool/approval. */
export async function handleToolRequest(req: Request, secret: string): Promise<Response> {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if (req.headers.get("x-spoken-secret") !== secret) return new Response("forbidden", { status: 403 });
  const b: any = await req.json().catch(() => null);
  const engine = b?.conversation_id ? live.get(String(b.conversation_id)) : undefined;
  if (!engine) return Response.json({ error: "unknown conversation" }, { status: 404 });
  const question = String(b.question ?? "").slice(0, 300);
  const options = String(b.options ?? "JA,NEI").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 4);
  const choice = await engine.approval(question, options.length ? options : ["JA", "NEI"]);
  return Response.json({ answer: choice, instruction: choice === "JA" ? "Brukeren sa JA. Gå videre og bekreft." : "Brukeren sa NEI. Ikke forplikt deg til dette." });
}

/** Per-turn latency from the platform's own metrics + inter-turn gaps. */
export function latencyReport(doc: ConversationDoc) {
  const rows: { turn: number; gapSec: number | null; metrics: Record<string, number> }[] = [];
  doc.transcript.forEach((t, i) => {
    if (t.role !== "agent") return;
    const prev = doc.transcript[i - 1];
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(t.conversation_turn_metrics?.metrics ?? {})) m[k] = Math.round(v.elapsed_time * 1000);
    rows.push({ turn: i, gapSec: prev?.role === "user" ? +(t.time_in_call_secs - prev.time_in_call_secs).toFixed(2) : null, metrics: m });
  });
  return rows;
}
