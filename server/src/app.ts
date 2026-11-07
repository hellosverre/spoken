// REST + live WebSocket per CONTRACT.md, plus the Telnyx webhook and media socket.

import type { Server, ServerWebSocket } from "bun";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Clarify, LiveCommand, Plan, Profile, TaskInput } from "../../shared/contract.ts";
import { timingSafeEqual } from "node:crypto";
import { MockLine } from "./call/mock-line.ts";
import { MockLlm } from "./llm/mock.ts";
import { CallSession } from "./call/session.ts";
import { TelnyxLine, telnyxBalance } from "./call/telnyx-line.ts";
import { config } from "./config.ts";
import { lookup } from "./directory.ts";
import { createLlm } from "./llm/index.ts";
import type { LlmProvider, TaskForLlm } from "./llm/types.ts";
import { EMERGENCY_ALTERNATIVE, checkGoal, checkNumber, disclosureLine, ensureDisclosure } from "./safety.ts";
import { calls, profile as defaultProfile, purge, setProfile, takeCallSlot, tasks } from "./store.ts";
import { FallbackDb, isDeviceId, type Db } from "./db.ts";
import { designVoice, listVoices } from "./voice/voices.ts";

// Words that come up on service calls in Norwegian; boosted in Scribe on every call.
// "sjefen" was heard as "rektor" on call #3.
const CALL_LEXICON = [
  "KI", "sjef", "sjefen", "sjefen min", "bestille", "bestilling", "bestillingen", "henting", "hente", "levering",
  "levere", "pepperoni", "pizza", "kroner", "klokka", "navnet", "navn", "telefonnummer", "adresse", "betale",
  "betaling", "kort", "vipps", "kontant", "ett øyeblikk", "vent litt", "på vent", "minutter", "time", "timen",
  "avbestille", "reservere", "bord", "ledig", "stengt", "åpent", "allergi", "glutenfri", "laktosefri",
];

type WsData = { kind: "live"; callId: string; unsub?: () => void } | { kind: "media"; callId: string; line: TelnyxLine };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Spoken-User, X-Spoken-Passcode, X-Spoken-Device",
};

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: CORS });
const err = (status: number, error: string) => json({ error }, status);

async function body(req: Request): Promise<any> {
  try { return await req.json(); } catch { return null; }
}

const id = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

function userKey(req: Request, server: Server<WsData>): string {
  return req.headers.get("x-spoken-user") || req.headers.get("cf-connecting-ip") || server.requestIP(req)?.address || "local";
}

function taskForLlm(input: TaskInput, profile: Profile): TaskForLlm {
  return { text: input.text, lang: input.lang, phone: input.phone, profile };
}

/** The app's device id (header, or ?device= for GET /api/calls). */
function deviceOf(req: Request): string | undefined {
  const d = req.headers.get("x-spoken-device") ?? new URL(req.url).searchParams.get("device");
  return isDeviceId(d) ? d.toLowerCase() : undefined;
}

function validTask(b: any): TaskInput | string {
  if (!b || typeof b.text !== "string" || !b.text.trim()) return "text is required";
  if (b.text.length > 1000) return "text is too long (max 1000)";
  if (b.lang !== undefined && b.lang !== "no" && b.lang !== "en") return "lang must be no or en";
  if (b.phone !== undefined && typeof b.phone !== "string") return "phone must be a string";
  return { text: b.text.trim(), lang: b.lang ?? "no", phone: b.phone?.trim() || undefined, contactId: b.contactId };
}

function validProfile(b: any): Profile | string {
  if (!b || typeof b.name !== "string") return "name is required";
  if (b.personality && !["warm", "neutral", "short"].includes(b.personality)) return "bad personality";
  if (b.lang && !["no", "en"].includes(b.lang)) return "bad lang";
  const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
  return {
    name: b.name.trim().slice(0, 80),
    phone: str(b.phone, 20),
    address: str(b.address),
    email: str(b.email),
    allergies: str(b.allergies),
    hearCall: b.hearCall !== false,
    voiceId: str(b.voiceId, 64),
    personality: b.personality ?? "warm",
    lang: b.lang ?? "no",
  };
}

export function createApp(llm: LlmProvider = createLlm(), db: Db = new FallbackDb(null)) {
  /** The device's saved profile, or the default one (demo without a device id). */
  async function profileFor(device?: string): Promise<Profile> {
    if (!device) return defaultProfile;
    return (await db.getProfile(device)) ?? { ...defaultProfile, name: "" };
  }

  void llm.warm?.(); // open the LLM connection before the first call
  setInterval(() => purge(), 60_000).unref?.();

  async function createTask(req: Request) {
    const v = validTask(await body(req));
    if (typeof v === "string") return err(400, v);
    const taskId = id("t");
    const device = deviceOf(req);
    const profile = await profileFor(device);
    const goal = checkGoal(v.text);
    const num = v.phone ? checkNumber(v.phone) : null;
    let clarify: Clarify;
    let blocked: { reason: string; alternative?: string } | undefined;
    if (!goal.ok) blocked = { reason: goal.reason };
    else if (num && !num.ok) blocked = { reason: num.reason, alternative: num.alternative };
    if (blocked) {
      clarify = { taskId, summary: blocked.reason, questions: [] };
    } else {
      const c = await llm.clarify(taskForLlm(v, profile));
      clarify = { taskId, summary: c.summary, questions: c.questions };
    }
    if (blocked?.reason.startsWith("Nødnummer")) blocked.alternative = EMERGENCY_ALTERNATIVE;
    tasks.set(taskId, { id: taskId, input: v, clarify, blocked, createdAt: Date.now(), device, profile });
    return json(clarify);
  }

  async function answerTask(taskId: string, req: Request) {
    const t = tasks.get(taskId);
    if (!t) return err(404, "unknown task");
    const b = await body(req);
    const answers: Record<string, string> = {};
    if (b?.answers && typeof b.answers === "object") {
      for (const [k, val] of Object.entries(b.answers)) if (typeof val === "string") answers[k.slice(0, 40)] = val.slice(0, 300);
    }
    t.answers = answers;
    const profile = t.profile;
    const voiceId = profile.voiceId || config.elevenlabs.defaultVoice;
    const opening = ensureDisclosure("", profile.name);
    if (t.blocked) {
      t.plan = { taskId, callee: { name: "", phone: "", source: "user" }, goal: t.input.text, opening, willShare: [], needsApprovalFor: [], voiceId, blocked: t.blocked };
      return json(t.plan);
    }
    const p = await llm.plan(taskForLlm(t.input, profile), answers);
    // A saved contact (TaskInput.contactId) gives the number and the name.
    const contact = t.device && t.input.contactId ? (await db.listContacts(t.device)).find((c) => c.id === t.input.contactId) : undefined;
    if (contact) p.calleeName = contact.name;
    const rawPhone = contact?.phone || t.input.phone || answers.phone || p.phone || lookup(t.input.text)?.phone;
    const source: Plan["callee"]["source"] = contact ? "contact" : t.input.phone || answers.phone ? "user" : lookup(t.input.text) ? "lookup" : "user";
    let blocked: Plan["blocked"];
    let phone = "";
    if (!rawPhone) blocked = { reason: "Fant ikke nummeret. Skriv inn nummeret du vil at jeg skal ringe." };
    else {
      const n = checkNumber(rawPhone);
      if (n.ok) phone = n.e164;
      else blocked = { reason: n.reason, alternative: n.alternative };
    }
    const goalCheck = checkGoal(p.goal);
    if (!goalCheck.ok) blocked = { reason: goalCheck.reason };
    t.plan = {
      taskId,
      callee: { name: p.calleeName, phone, source },
      goal: p.goal,
      opening,
      willShare: p.willShare.includes("name") ? p.willShare : ["name", ...p.willShare],
      needsApprovalFor: p.needsApprovalFor.some((x) => /^pris/i.test(x)) ? p.needsApprovalFor : ["pris over 0 kr", ...p.needsApprovalFor],
      voiceId,
      ...(blocked ? { blocked } : {}),
    };
    return json(t.plan);
  }

  async function startCall(taskId: string, req: Request, server: Server<WsData>) {
    const t = tasks.get(taskId);
    if (!t) return err(404, "unknown task");
    const b = await body(req);
    if (b?.approved !== true) return err(400, "approved: true is required (the user must tap OK)");
    if (!t.plan) return err(409, "answer the questions first (POST /api/tasks/:id/answers)");
    if (t.plan.blocked) return err(403, t.plan.blocked.reason + (t.plan.blocked.alternative ? ` ${t.plan.blocked.alternative}` : ""));
    const num = checkNumber(t.plan.callee.phone);
    if (!num.ok) return err(403, num.reason);
    // No (or a wrong) demo passcode → this call runs in mock mode: scripted callee, mock agent.
    const pass = passcodeCheck(req.headers.get("x-spoken-passcode"));
    const real = config.callProvider === "telnyx" && pass === "ok";
    if (config.callProvider === "telnyx" && !real) console.log(`[call] passcode ${pass}: mock mode`);
    if (real && !config.callAllowlist.includes(num.e164)) {
      return err(403, "Dette nummeret er ikke på CALL_ALLOWLIST for ekte samtaler.");
    }
    if (real) {
      // Prepaid Telnyx balance: log it before every real call, refuse when it can't cover one.
      const bal = await telnyxBalance();
      console.log(`[telnyx] balance before call: ${bal === null ? "unknown" : `$${bal.toFixed(2)}`}`);
      if (bal !== null && bal < config.minBalanceUsd) {
        return err(402, `Telnyx-saldoen er for lav ($${bal.toFixed(2)}, minst $${config.minBalanceUsd.toFixed(2)} trengs). Fyll på før neste samtale.`);
      }
    }
    if (!takeCallSlot(userKey(req, server), config.maxCallsPerDay)) return err(429, `Maks ${config.maxCallsPerDay} samtaler per dag.`);

    const maxSec = typeof b.maxSec === "number" && b.maxSec > 10 ? Math.min(b.maxSec, config.maxCallSec) : config.maxCallSec;
    const callId = id("c");
    const line = real
      ? new TelnyxLine({ callId, to: num.e164, voiceId: t.plan.voiceId, keyterms: keyterms(t.input.text, t.plan.callee.name, t.profile.name), maxSec })
      : new MockLine(config.callProvider === "telnyx" ? 1 : config.mockSpeed);
    const fnr = typeof b.fnr === "string" && /^\d{11}$/.test(b.fnr) && t.plan.willShare.includes("fnr") ? b.fnr : undefined;
    const callLlm = config.callProvider === "telnyx" && !real ? new MockLlm(15) : llm; // the mock callee follows the mock agent's script
    const session = new CallSession({ callId, taskId, plan: structuredClone(t.plan), profile: { ...t.profile }, line, llm: callLlm, secrets: { fnr }, maxSec });
    // History: the call's summary (never the transcript) is saved for the device when it ends.
    if (t.device) {
      const device = t.device, calleeName = t.plan.callee.name;
      const unsub = session.subscribe((ev) => {
        if (ev.type !== "result") return;
        unsub();
        void db.saveResult(device, ev.result, calleeName).catch((e) => console.warn("[db] saveResult:", (e as Error).message));
      });
    }
    calls.set(callId, session);
    void session.start();
    const mode = config.callProvider === "telnyx" && real ? "real" : "mock";
    return json({ callId, mode, ...(pass === "wrong" ? { passcode: "wrong" } : {}) });
  }

  function keyterms(text: string, callee: string, userName: string): string[] {
    // Names and nouns from the task, then the call lexicon. Scribe realtime allows 50.
    const fromTask = `${callee} ${text}`.match(/[A-ZÆØÅ][\wæøåÆØÅ']{2,}|\b[\wæøå]{6,}\b/g) ?? [];
    return [...new Set(["KI-assistent", userName, ...fromTask.map((w) => w.trim()), ...CALL_LEXICON].filter(Boolean))].slice(0, 50);
  }

  async function route(req: Request, server: Server<WsData>): Promise<Response | undefined> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const m = req.method;
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (path === "/health") return json({ ok: true, callProvider: config.callProvider, llm: llm.name });

    const live = path.match(/^\/api\/calls\/([\w-]+)\/live$/);
    if (live && m === "GET") {
      const callId = live[1]!;
      if (!calls.has(callId)) return err(404, "unknown call");
      if (server.upgrade(req, { data: { kind: "live", callId } satisfies WsData })) return undefined;
      return err(426, "websocket upgrade required");
    }

    if (path === "/telnyx/media") {
      const line = TelnyxLine.authorize(url.searchParams.get("call") ?? "", url.searchParams.get("t") ?? "");
      if (!line) return new Response("forbidden", { status: 403 });
      if (server.upgrade(req, { data: { kind: "media", callId: url.searchParams.get("call")!, line } satisfies WsData })) return undefined;
      return new Response("upgrade required", { status: 426 });
    }

    if (path === "/telnyx/webhook" && m === "POST") {
      const b = await body(req);
      try { TelnyxLine.handleWebhook(b); } catch (e) { console.error("[telnyx] webhook failed:", (e as Error).message); }
      return new Response("ok");
    }

    if (path === "/api/tasks" && m === "POST") return createTask(req);
    let r = path.match(/^\/api\/tasks\/([\w-]+)\/answers$/);
    if (r && m === "POST") return answerTask(r[1]!, req);
    r = path.match(/^\/api\/tasks\/([\w-]+)\/call$/);
    if (r && m === "POST") return startCall(r[1]!, req, server);

    r = path.match(/^\/api\/calls\/([\w-]+)\/hangup$/);
    if (r && m === "POST") {
      const s = calls.get(r[1]!);
      if (!s) return err(404, "unknown call");
      s.command({ type: "hangup" });
      return json({ ok: true });
    }
    r = path.match(/^\/api\/calls\/([\w-]+)$/);
    if (r && m === "GET") {
      const s = calls.get(r[1]!);
      if (!s) return err(404, "unknown call (results are kept 30 min, in memory only)");
      if (!s.result) return json({ status: s.status, inProgress: true }, 202);
      return json(s.result);
    }

    if (path === "/api/voices" && m === "GET") return json(listVoices());
    if (path === "/api/voices/design" && m === "POST") {
      const b = await body(req);
      if (typeof b?.description !== "string" || b.description.trim().length < 5) return err(400, "description is required");
      return json(await designVoice(b.description));
    }

    if (path === "/api/profile" && m === "GET") {
      const device = deviceOf(req);
      return json(device ? await profileFor(device) : defaultProfile);
    }
    if (path === "/api/profile" && m === "PUT") {
      const v = validProfile(await body(req));
      if (typeof v === "string") return err(400, v);
      const device = deviceOf(req);
      if (device) await db.putProfile(device, v);
      else setProfile(v);
      return json(v);
    }

    // The built web app (web/dist) is served from here, so the phone uses one origin for
    // the page, REST and the live socket.
    if (m === "GET" && !path.startsWith("/api/") && !path.startsWith("/telnyx/")) {
      const page = await webFile(path);
      if (page) return page;
    }
    // Contacts and call history are per device.
    if (path === "/api/contacts" || path.startsWith("/api/contacts/") || (path === "/api/calls" && m === "GET")) {
      const device = deviceOf(req);
      if (!device) return err(400, "X-Spoken-Device header (a UUID) is required");
      if (path === "/api/calls") {
        const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20) || 20));
        return json(await db.listResults(device, limit));
      }
      if (path === "/api/contacts" && m === "GET") return json(await db.listContacts(device));
      if (path === "/api/contacts" && m === "POST") {
        const b = await body(req);
        const name = typeof b?.name === "string" ? b.name.trim().slice(0, 80) : "";
        if (!name) return err(400, "name is required");
        const n = checkNumber(typeof b?.phone === "string" ? b.phone : "");
        if (!n.ok) return err(400, n.reason);
        const kind = b?.kind === "person" ? "person" : "business";
        return json(await db.addContact(device, { name, phone: n.e164, kind }), 201);
      }
      const del = path.match(/^\/api\/contacts\/([\w-]+)$/);
      if (del && m === "DELETE") return (await db.deleteContact(device, del[1]!)) ? json({ ok: true }) : err(404, "unknown contact");
      return err(405, "method not allowed");
    }

    if (path === "/") return json({ name: "spoken-server", disclosure: disclosureLine(defaultProfile.name) });
    return err(404, "not found");
  }

  return {
    async fetch(req: Request, server: Server<WsData>) {
      try {
        return await route(req, server);
      } catch (e) {
        console.error("[http]", req.method, new URL(req.url).pathname, (e as Error).message);
        return err(500, "internal error");
      }
    },
    websocket: {
      open(ws: ServerWebSocket<WsData>) {
        const d = ws.data;
        if (d.kind === "media") { d.line.attach(ws); return; }
        const s = calls.get(d.callId);
        if (!s) { ws.close(1008, "unknown call"); return; }
        for (const ev of s.events) ws.send(JSON.stringify(ev)); // replay for late joiners
        d.unsub = s.subscribe((ev) => ws.send(JSON.stringify(ev)));
      },
      message(ws: ServerWebSocket<WsData>, msg: string | Buffer) {
        const d = ws.data;
        if (d.kind === "media") { d.line.onMedia(String(msg)); return; }
        const s = calls.get(d.callId);
        const cmd = parseCommand(String(msg));
        if (!s || !cmd) { ws.send(JSON.stringify({ type: "note", text: "Ukjent kommando.", level: "warn", at: Date.now() })); return; }
        s.command(cmd);
      },
      close(ws: ServerWebSocket<WsData>) {
        const d = ws.data;
        if (d.kind === "media") d.line.onSocketClosed();
        else d.unsub?.();
      },
    },
  };
}

// Next.js static export (web/out, `SPOKEN_EXPORT=1 next build`); web/dist for the older Vite build.
const WEB_DIST = resolve(process.env.WEB_DIST ?? (existsSync(join(import.meta.dir, "../../web/out")) ? join(import.meta.dir, "../../web/out") : join(import.meta.dir, "../../web/dist")));

/** Static file from web/dist; unknown paths get index.html (hash routes, deep links). */
async function webFile(path: string): Promise<Response | undefined> {
  const index = Bun.file(join(WEB_DIST, "index.html"));
  if (!(await index.exists())) return undefined;
  const target = resolve(WEB_DIST, "." + decodeURIComponent(path));
  if (target.startsWith(WEB_DIST + "/") && !target.endsWith("/")) {
    const f = Bun.file(target);
    if (await f.exists()) {
      const immutable = target.includes("/assets/") || target.includes("/_next/static/");
      return new Response(f, { headers: { "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" } });
    }
  }
  return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
}

/** "ok" | "missing" | "wrong" | "off" (no DEMO_PASSCODE configured → every call is real). */
function passcodeCheck(given: string | null): "ok" | "missing" | "wrong" {
  const want = config.demoPasscode;
  if (!want) return "ok";
  if (!given) return "missing";
  const a = Buffer.from(given.trim()), b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "wrong";
}

export function parseCommand(raw: string): LiveCommand | null {
  let c: any;
  try { c = JSON.parse(raw); } catch { return null; }
  switch (c?.type) {
    case "approval_response": return typeof c.id === "string" && typeof c.choice === "string" ? { type: c.type, id: c.id, choice: c.choice } : null;
    case "instruction": return typeof c.text === "string" ? { type: c.type, text: c.text } : null;
    case "say_simpler": return { type: c.type };
    case "tone": return ["friendly", "firm", "hurry"].includes(c.tone) ? { type: c.type, tone: c.tone } : null;
    case "hangup": return { type: c.type };
    default: return null;
  }
}
