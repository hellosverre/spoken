import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { LiveEvent } from "../../shared/contract.ts";
import { startServer, watchCall } from "./helpers.ts";

let s: ReturnType<typeof startServer>;
beforeAll(() => { s = startServer(); });
afterAll(() => s.stop());

const finals = (evs: LiveEvent[], who: "agent" | "callee") =>
  evs.filter((e): e is Extract<LiveEvent, { type: "transcript" }> => e.type === "transcript" && e.final && e.who === who).map((e) => e.text);

async function planFor(text: string, phone?: string) {
  const c = await s.post("/api/tasks", { text, lang: "no", ...(phone ? { phone } : {}) });
  expect(c.status).toBe(200);
  const answers: Record<string, string> = {};
  for (const q of c.data.questions) answers[q.id] = q.options?.[0] ?? "ja";
  const p = await s.post(`/api/tasks/${c.data.taskId}/answers`, { answers });
  expect(p.status).toBe(200);
  return { clarify: c.data, plan: p.data };
}

describe("mock pizza order, end to end", () => {
  test("task → clarify → plan → call → live transcript → approval → result", async () => {
    const { clarify, plan } = await planFor("Bestill en stor pepperoni fra Domino's Storo til 18:00");
    expect(clarify.questions.length).toBeGreaterThan(0);
    expect(clarify.questions.at(-1).id).toBe("confirm");
    expect(plan.callee.name).toBe("Domino's Storo");
    expect(plan.callee.phone).toMatch(/^\+47\d{8}$/);
    expect(plan.opening).toStartWith("Hei, jeg er en KI-assistent som ringer på vegne av Sverre.");
    expect(plan.blocked).toBeUndefined();

    const noOk = await s.post(`/api/tasks/${plan.taskId}/call`, {});
    expect(noOk.status).toBe(400);

    const call = await s.post(`/api/tasks/${plan.taskId}/call`, { approved: true });
    expect(call.status).toBe(200);
    const { done } = watchCall(s.base, call.data.callId);
    const evs = await done;

    const statuses = evs.filter((e) => e.type === "status").map((e: any) => e.status);
    expect(statuses).toEqual(["dialing", "ringing", "connected", "ended"]);

    const agent = finals(evs, "agent");
    // Disclosure is the very first thing the callee hears.
    expect(agent[0]).toStartWith("Hei, jeg er en KI-assistent som ringer på vegne av Sverre.");
    expect(agent[0]).toContain("si nei");

    // Exactly one approval, and the commitment comes only after it.
    const approvals = evs.filter((e) => e.type === "approval_request");
    expect(approvals.length).toBe(1);
    const approvalIdx = evs.indexOf(approvals[0]!);
    const commitIdx = evs.findIndex((e) => e.type === "transcript" && e.who === "agent" && /bekrefter/i.test(e.text));
    expect(commitIdx).toBeGreaterThan(approvalIdx);
    expect(agent).toContain("Et lite øyeblikk, jeg sjekker med Sverre.");

    // Card number refused, with a note.
    expect(agent.some((t) => /kan ikke oppgi kortnummer/i.test(t))).toBe(true);
    expect(evs.some((e) => e.type === "note" && /kortnummer/i.test(e.text))).toBe(true);

    // Callee words carry confidence so unsure ones can be greyed out.
    const withWords = evs.find((e: any) => e.type === "transcript" && e.who === "callee" && e.final && e.words?.length) as any;
    expect(withWords.words.some((w: any) => w.confidence < 0.6)).toBe(true);

    const result = (evs.at(-1) as any).result;
    expect(result.outcome).toBe("done");
    expect(result.details.pris).toBe("189 kr");
    expect(result.transcript.length).toBeGreaterThan(8);

    const r = await s.get(`/api/calls/${call.data.callId}`);
    expect(r.status).toBe(200);
    expect(r.data.outcome).toBe("done");
  });

  test("user says NEI → no commitment, partial outcome", async () => {
    const { plan } = await planFor("Bestill en stor pepperoni fra Domino's Storo til 18:00");
    const call = await s.post(`/api/tasks/${plan.taskId}/call`, { approved: true });
    const evs = await watchCall(s.base, call.data.callId, () => "NEI").done;
    const agent = finals(evs, "agent");
    expect(agent.some((t) => /bekrefter/i.test(t))).toBe(false);
    expect((evs.at(-1) as any).result.outcome).toBe("partial");
  });

  test("mid-call hangup from the user ends the call", async () => {
    const { plan } = await planFor("Bestill en stor pepperoni fra Domino's Storo til 18:00");
    const call = await s.post(`/api/tasks/${plan.taskId}/call`, { approved: true });
    const w = watchCall(s.base, call.data.callId);
    await new Promise<void>((r) => { const i = setInterval(() => { if (w.events.some((e: any) => e.type === "status" && e.status === "connected")) { clearInterval(i); r(); } }, 5); });
    w.ws.send(JSON.stringify({ type: "hangup" }));
    const evs = await w.done;
    expect((evs.at(-1) as any).result.summary).toContain("Avsluttet");
  });
});

describe("English call", () => {
  test("an English task gets an English call, with the same safety rules", async () => {
    const { plan } = await planFor("Order a large pepperoni from Domino's Storo for 6pm");
    expect(plan.callee.name).toBe("Domino's Storo");
    expect(plan.opening).toStartWith("Hi, I'm an AI assistant calling on behalf of Sverre.");
    const call = await s.post(`/api/tasks/${plan.taskId}/call`, { approved: true });
    const evs = await watchCall(s.base, call.data.callId).done;
    const agent = finals(evs, "agent");
    if (process.env.DUMP) console.log(evs.filter((e: any) => e.type === "transcript" && e.final || e.type === "note" || e.type === "approval_request").map((e: any) => `${e.who ?? e.type}: ${e.text ?? e.question}`).join("\n"));
    expect(agent[0]).toStartWith("Hi, I'm an AI assistant calling on behalf of Sverre.");
    expect(agent[0]).toContain("say no");
    expect(agent).toContain("Just a moment, I'll check with Sverre.");
    const approvalIdx = evs.findIndex((e) => e.type === "approval_request");
    const commitIdx = evs.findIndex((e) => e.type === "transcript" && e.who === "agent" && /confirm/i.test(e.text));
    expect(approvalIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(approvalIdx);
    expect(agent.some((t) => /can't give card numbers/i.test(t))).toBe(true);
    expect(agent.some((t) => /[æøå]|\bjeg\b/i.test(t))).toBe(false);
    expect((evs.at(-1) as any).result.outcome).toBe("done");
  });

  test("«på norsk» in an English-looking task keeps the call Norwegian", async () => {
    const { plan } = await planFor("Order a large pepperoni from Domino's Storo for 6pm, på norsk");
    expect(plan.opening).toStartWith("Hei, jeg er en KI-assistent");
  });

  test("the start request can override the call language", async () => {
    const { plan } = await planFor("Bestill en stor pepperoni fra Domino's Storo til 18:00");
    const call = await s.post(`/api/tasks/${plan.taskId}/call`, { approved: true, callLang: "en" });
    const evs = await watchCall(s.base, call.data.callId).done;
    expect(finals(evs, "agent")[0]).toStartWith("Hi, I'm an AI assistant");
  });
});

describe("blocked numbers", () => {
  for (const n of ["110", "112", "113", "+47 113", "1412", "1881"]) {
    test(`${n} is never called`, async () => {
      const { plan } = await planFor("Ring dette nummeret", n);
      expect(plan.blocked).toBeDefined();
      const call = await s.post(`/api/tasks/${plan.taskId}/call`, { approved: true });
      expect(call.status).toBe(403);
    });
  }

  test("emergency shows the right alternative", async () => {
    const { plan } = await planFor("Ring 113, det er en nødsituasjon");
    expect(plan.blocked.alternative).toContain("113");
  });

  test("abusive goal is refused", async () => {
    const { plan } = await planFor("Ring naboen og tru han", "+4799999999");
    expect(plan.blocked).toBeDefined();
  });
});

describe("REST basics", () => {
  test("voices and profile", async () => {
    const v = await s.get("/api/voices");
    expect(v.data.filter((x: any) => x.preset).length).toBe(3);
    const p = await fetch(`${s.base}/api/profile`, { method: "PUT", body: JSON.stringify({ name: "Ingvild", hearCall: false, personality: "short", lang: "no" }) });
    expect((await p.json() as any).name).toBe("Ingvild");
    const { plan } = await planFor("Bestill pizza fra Peppes til 19:00");
    expect(plan.opening).toStartWith("Hei, jeg er en KI-assistent som ringer på vegne av Ingvild.");
    await fetch(`${s.base}/api/profile`, { method: "PUT", body: JSON.stringify({ name: "Sverre", hearCall: true, personality: "warm", lang: "no" }) });
  });

  test("bad input is rejected", async () => {
    expect((await s.post("/api/tasks", { text: "" })).status).toBe(400);
    expect((await s.post("/api/tasks/nope/answers", { answers: {} })).status).toBe(404);
  });
});

describe("Telnyx balance guard", () => {
  test("real call refused below the minimum balance, with a clear message", async () => {
    const { config } = await import("../src/config.ts");
    const saved = { p: config.callProvider, key: config.telnyx.apiKey, allow: config.callAllowlist, code: config.demoPasscode, f: globalThis.fetch };
    config.callProvider = "telnyx";
    config.demoPasscode = ""; // no passcode configured → every call is real
    config.telnyx.apiKey = "test";
    config.callAllowlist = ["+4722000001"];
    const realFetch = saved.f;
    globalThis.fetch = (async (url: any, init?: any) =>
      String(url).includes("api.telnyx.com/v2/balance")
        ? Response.json({ data: { balance: "0.21", currency: "USD" } })
        : realFetch(url, init)) as any;
    try {
      const c = await s.post("/api/tasks", { text: "Bestill en stor pepperoni fra Domino's Storo til 18:00", lang: "no" });
      const answers: Record<string, string> = {};
      for (const q of c.data.questions) answers[q.id] = q.options?.[0] ?? "ja";
      const p = await s.post(`/api/tasks/${c.data.taskId}/answers`, { answers });
      config.callAllowlist = [p.data.callee.phone];
      const call = await s.post(`/api/tasks/${p.data.taskId}/call`, { approved: true });
      expect(call.status).toBe(402);
      expect(call.data.error).toContain("$0.21");
    } finally {
      config.callProvider = saved.p; config.telnyx.apiKey = saved.key; config.callAllowlist = saved.allow; config.demoPasscode = saved.code; globalThis.fetch = saved.f;
    }
  });
});

describe("demo passcode guards real calls", () => {
  test("no/wrong code → mock call (nothing dialled); right code → real call", async () => {
    const { config } = await import("../src/config.ts");
    const saved = { p: config.callProvider, key: config.telnyx.apiKey, conn: config.telnyx.connectionId, from: config.telnyx.fromNumber, allow: config.callAllowlist, code: config.demoPasscode, f: globalThis.fetch };
    config.callProvider = "telnyx";
    config.telnyx.apiKey = "test"; config.telnyx.connectionId = "conn"; config.telnyx.fromNumber = "+10000000000";
    config.demoPasscode = "123456";
    const dials: string[] = [];
    const realFetch = saved.f;
    globalThis.fetch = (async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes("api.telnyx.com/v2/balance")) return Response.json({ data: { balance: "2.00" } });
      if (u.endsWith("api.telnyx.com/v2/calls")) { dials.push(u); return Response.json({ data: { call_control_id: "cc1" } }); }
      if (u.includes("api.telnyx.com/v2/calls/")) return Response.json({ data: {} }); // hangup
      return realFetch(url, init);
    }) as any;
    const startWith = async (headers: Record<string, string>) => {
      const c = await s.post("/api/tasks", { text: "Bestill en stor pepperoni fra Domino's Storo til 18:00", lang: "no" });
      const answers: Record<string, string> = {};
      for (const q of c.data.questions) answers[q.id] = q.options?.[0] ?? "ja";
      const p = await s.post(`/api/tasks/${c.data.taskId}/answers`, { answers });
      config.callAllowlist = [p.data.callee.phone];
      const r = await fetch(`${s.base}/api/tasks/${p.data.taskId}/call`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ approved: true }) });
      const j: any = await r.json();
      await fetch(`${s.base}/api/calls/${j.callId}/hangup`, { method: "POST" });
      return j;
    };
    try {
      expect((await startWith({})).mode).toBe("mock");
      const wrong = await startWith({ "X-Spoken-Passcode": "999999" });
      expect(wrong).toMatchObject({ mode: "mock", passcode: "wrong" });
      expect(dials.length).toBe(0);
      expect((await startWith({ "X-Spoken-Passcode": "123456" })).mode).toBe("real");
      expect(dials.length).toBe(1);
    } finally {
      Object.assign(config, { callProvider: saved.p, callAllowlist: saved.allow, demoPasscode: saved.code });
      Object.assign(config.telnyx, { apiKey: saved.key, connectionId: saved.conn, fromNumber: saved.from });
      globalThis.fetch = saved.f;
    }
  });
});
