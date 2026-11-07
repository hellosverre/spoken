// Inbound calls: a shop rings our Vonage number back. Vonage hits GET /vonage/answer; we match the
// caller to the user who called that number in the last 24 h, start a CallSession in inbound mode on
// a VonageLine, and let the user's app learn about it through GET /api/incoming?device=<id>.
//
// Docs: https://developer.vonage.com/en/voice/voice-api/webhook-reference (answer webhook: GET with
// from/to/uuid/conversation_uuid, or POST JSON), /en/getting-started/concepts/webhooks (signed
// webhooks: Authorization: Bearer <HS256 JWT signed with the signature secret>).

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Lang, Plan, Profile } from "../../../shared/contract.ts";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import type { LlmProvider } from "../llm/types.ts";
import { calls, profile as defaultProfile } from "../store.ts";
import { CallSession } from "./session.ts";
import { VonageLine } from "./vonage-line.ts";

const REMEMBER_MS = 24 * 3600_000;
const MAX_ACTIVE = 3;
const MAX_PER_HOUR = 12;

export interface OutboundMemory {
  /** E.164 of the number we called. */
  callee: string;
  calleeName: string;
  device?: string;
  taskText: string;
  profile: Profile;
  callId: string;
  lang: Lang;
  at: number;
}

export interface IncomingCall { callId: string; callerName: string; topic: string }

const remembered = new Map<string, OutboundMemory>(); // by digits of the callee number
const pending = new Map<string, IncomingCall>(); // by device: shown to the app once
let latest: OutboundMemory | undefined; // fallback for unmatched callers
const starts: number[] = [];

const digits = (n: string) => n.replace(/^\+|^00/, "").replace(/\D/g, "");

/** Called when we place a real call: the shop may ring back within 24 h. */
export function rememberOutbound(m: Omit<OutboundMemory, "at">) {
  const full = { ...m, at: Date.now() };
  remembered.set(digits(m.callee), full);
  latest = full;
}

function recall(from: string, now = Date.now()): OutboundMemory | undefined {
  const m = remembered.get(digits(from));
  return m && now - m.at < REMEMBER_MS ? m : undefined;
}

export function resetInbound() { remembered.clear(); pending.clear(); latest = undefined; starts.length = 0; }

/** The incoming call for this device, once; undefined if none. */
export function takeIncoming(device: string): IncomingCall | undefined {
  const c = pending.get(device);
  if (c) pending.delete(device);
  return c;
}

/** Vonage signs webhooks with an HS256 JWT in the Authorization header. Checked only if a secret is set. */
export function vonageSigned(req: Request, secret = process.env.VONAGE_SIGNATURE_SECRET): boolean {
  if (!secret) return true;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const parts = token?.split(".");
  if (!parts || parts.length !== 3) return false;
  try {
    const want = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
    const got = Buffer.from(parts[2]!, "base64url");
    if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
    const head = JSON.parse(Buffer.from(parts[0]!, "base64url").toString());
    const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
    if (head.alg !== "HS256") return false;
    return typeof claims.iat !== "number" || Math.abs(Date.now() / 1000 - claims.iat) < 300;
  } catch { return false; }
}

const clip = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

function greeting(lang: Lang, name: string, topic: string): string {
  return lang === "en"
    ? `Hi, this is Spoken, ${name}'s AI assistant. Are you calling back about ${topic}?`
    : `Hei, dette er Spoken, KI-assistenten til ${name}. Ringer du tilbake om ${topic}?`;
}

function messageGreeting(lang: Lang, name: string): string {
  return lang === "en"
    ? `Hi, this is Spoken, an AI assistant. ${name} can't take the phone. What is it about?`
    : `Hei, dette er Spoken, en KI-assistent. ${name} kan ikke ta telefonen. Hva gjelder det?`;
}

export function createInbound(llm: LlmProvider, db: Db) {
  async function answer(params: Record<string, string>): Promise<unknown> {
    const from = params.from ?? "";
    const uuid = params.uuid ?? "";
    const now = Date.now();
    while (starts.length && now - starts[0]! > 3600_000) starts.shift();
    const active = [...calls.values()].filter((s) => s.inbound && !s.isEnded).length;
    if (!uuid || config.callProvider !== "vonage" || active >= MAX_ACTIVE || starts.length >= MAX_PER_HOUR) {
      return [{ action: "talk", text: "Sorry, we cannot take your call right now. Goodbye.", language: "en-GB" }];
    }
    starts.push(now);

    const match = recall(from, now);
    const mem = match ?? (latest && now - latest.at < REMEMBER_MS ? latest : undefined);
    const prof = mem?.profile ?? defaultProfile;
    const name = prof.name || "brukeren";
    const lang: Lang = mem?.lang ?? "no";
    const device = mem?.device;
    const callId = `c_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const topic = match ? clip(match.taskText.replace(/\s+/g, " ").trim(), 70) : "";
    const callerName = match ? match.calleeName || `+${digits(from)}` : `+${digits(from)}`;

    const goal = match
      ? `They are calling back about: ${topic}. Confirm what this is about, answer from the task, and ask the user for anything that needs a decision.`
      : `Take a message. ${name} is unavailable. Ask what it concerns and who is calling, write it down, then thank them and say goodbye. Never promise anything.`;
    const plan: Plan = {
      taskId: `inbound_${callId}`,
      callee: { name: callerName, phone: `+${digits(from)}`, source: "user" },
      goal,
      opening: match ? greeting(lang, name, topic) : messageGreeting(lang, name),
      willShare: ["name"],
      needsApprovalFor: [],
      voiceId: prof.voiceId || config.elevenlabs.defaultVoice,
      callLang: lang,
    };
    const line = new VonageLine({ callId, to: `+${digits(from)}`, voiceId: plan.voiceId, lang, keyterms: [name, callerName, "Spoken", "KI-assistent"].filter(Boolean), maxSec: 300, inbound: { uuid } });
    const session = new CallSession({ callId, taskId: plan.taskId, plan, profile: { ...prof, lang: prof.lang ?? lang }, line, llm, maxSec: 300, taskText: match?.taskText, inbound: true });
    if (device) {
      const unsub = session.subscribe((ev) => {
        if (ev.type !== "result") return;
        unsub();
        void db.saveResult(device, ev.result, callerName).catch((e) => console.warn("[db] saveResult:", (e as Error).message));
      });
      pending.set(device, { callId, callerName, topic: match ? topic : lang === "en" ? "Message for you" : "Beskjed til deg" });
    }
    calls.set(callId, session);
    void session.start(); // runs synchronously up to line.start(), so the line is ready before the socket arrives
    console.log(`[inbound] ${match ? "callback" : "unmatched"} from ${digits(from).slice(0, -4)}xxxx → call ${callId}${device ? "" : " (no device)"}`);

    const wsBase = config.publicUrl.replace(/^http/, "ws");
    return [{
      action: "connect",
      eventUrl: [`${config.publicUrl}/vonage/event?leg=ws&call=${encodeURIComponent(callId)}`],
      eventMethod: "POST",
      endpoint: [{
        type: "websocket",
        uri: `${wsBase}/vonage/media?call=${encodeURIComponent(callId)}&t=${line.mediaToken}`,
        "content-type": "audio/l16;rate=16000",
        headers: { callId },
      }],
    }];
  }

  return {
    /** GET (query) or POST (JSON) /vonage/answer */
    async handleAnswer(req: Request): Promise<Response> {
      if (!vonageSigned(req)) return new Response("bad signature", { status: 401 });
      let params: Record<string, string> = Object.fromEntries(new URL(req.url).searchParams);
      if (req.method === "POST") {
        try { params = { ...params, ...(await req.json()) }; } catch { /* query only */ }
      }
      try { return Response.json(await answer(params)); }
      catch (e) {
        console.error("[inbound] answer failed:", (e as Error).message);
        return Response.json([{ action: "talk", text: "Sorry, something went wrong. Goodbye.", language: "en-GB" }]);
      }
    },
    /** Events of the inbound leg (no call/t params). Always 200 so Vonage doesn't retry. */
    handleEvent(body: any) {
      if (body?.uuid) VonageLine.handleInboundEvent(String(body.uuid), body);
    },
  };
}
