// Regressions from call #5 (c_bf25714b8c13), items 1–5 from the lead's review.
import { describe, expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import type { CallLine, LineEvents } from "../src/call/line.ts";
import { CallSession } from "../src/call/session.ts";
import { config } from "../src/config.ts";
import type { LlmProvider } from "../src/llm/types.ts";

class Line implements CallLine {
  ev!: LineEvents;
  spoken: string[] = [];
  quiet = Infinity; // ms of callee silence the line reports
  speakMs = 5;
  interrupted = 0;
  private stop?: () => void;
  async start(ev: LineEvents) { this.ev = ev; setTimeout(() => ev.status("connected"), 1); }
  speak(text: string) {
    this.spoken.push(text);
    return new Promise<{ interrupted: boolean }>((r) => {
      const t = setTimeout(() => r({ interrupted: false }), this.speakMs);
      this.stop = () => { clearTimeout(t); this.interrupted++; r({ interrupted: true }); };
    });
  }
  stopSpeaking() { this.stop?.(); }
  silenceMs() { return this.quiet; }
  startWaitingSound() {}
  stopWaitingSound() {}
  async hangup() {}
}

/** Replies from a list, in order. */
function llm(replies: string[]): LlmProvider {
  let i = 0;
  return {
    name: "fake",
    clarify: async () => ({ summary: "", questions: [] }),
    plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
    summarize: async () => ({ outcome: "partial", summary: "x", details: {} }),
    async *reply() { yield replies[Math.min(i++, replies.length - 1)]!; },
  };
}

const plan: Plan = {
  taskId: "t", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting klokka 18:00", opening: "",
  willShare: ["name"], needsApprovalFor: [], voiceId: "v",
};

async function session(replies: string[]) {
  const line = new Line();
  const s = new CallSession({ callId: `x_${Math.random()}`, taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: llm(replies) });
  const evs: LiveEvent[] = [];
  s.subscribe((e) => evs.push(e));
  await s.start();
  await Bun.sleep(30);
  return { line, s, evs, said: () => line.spoken.slice(1) /* after the disclosure */ };
}

describe("1: no half-sentences while the callee is still talking", () => {
  test("waits for real silence before speaking", async () => {
    const { line, s, said } = await session(["Den står på Sverre, takk."]);
    line.quiet = 0; // callee still making sound
    line.ev.calleeFinal("c1", "Hvilket navn skal den stå på?");
    await Bun.sleep(250);
    expect(said()).toEqual([]);
    line.quiet = Infinity;
    await Bun.sleep(120);
    expect(said()[0]).toBe("Den står på Sverre,");
    await s.finish("test");
  });

  test("a bare «ja» from the callee doesn't cut the agent off", async () => {
    const { line, s, said } = await session(["Jeg vil gjerne ha en stor pepperoni til henting klokka 18:00.", "Takk."]);
    line.speakMs = 300;
    line.ev.calleeFinal("c1", "Hva kan jeg hjelpe med?");
    await Bun.sleep(80);
    line.ev.calleeFinal("c2", "Ja.");
    await Bun.sleep(400);
    expect(line.interrupted).toBe(0);
    expect(said().length).toBe(1);
    await s.finish("test");
  });
});

describe("2: goodbye means hang up", () => {
  test("nothing after «ha det», later input ignored", async () => {
    const { line, s, said } = await session(["Takk for samtalen, ha det! Jeg ringer på vegne av Sverre for å bestille pizza."]);
    line.ev.calleeFinal("c1", "Nei, vi har ikke det.");
    await Bun.sleep(150);
    expect(s.isEnded).toBe(true);
    expect(said().join(" ")).not.toContain("på vegne av");
    line.ev.calleeFinal("c2", "Hallo?");
    await Bun.sleep(50);
    expect(said().join(" ")).not.toContain("på vegne av");
  });
});

describe("3: the disclosure is said once", () => {
  test("re-introductions and repeated «på vegne av» are removed", async () => {
    const { line, s, said } = await session([
      "Jeg ringer på vegne av Sverre og vil gjerne bestille en stor pepperoni.",
      "Hei igjen! Jeg ringer på vegne av Sverre og vil gjerne vite om dere har pepperoni.",
      "Hei, det er Spoken, KI-assistenten som ringer for Sverre. Kan dere ta en beskjed?",
    ]);
    for (const [id, t] of [["c1", "Hva kan jeg hjelpe med?"], ["c2", "Unnskyld, hva sa du?"], ["c3", "Hm, okei, og?"]]) {
      line.ev.calleeFinal(id!, t!);
      await Bun.sleep(80);
    }
    const out = said();
    expect(out[0]).toContain("på vegne av Sverre"); // first errand statement is fine
    expect(out[1]).toBe("Jeg vil gjerne vite om dere har pepperoni.");
    expect(out[2]).toBe("Kan dere ta en beskjed?");
    await s.finish("test");
  });

  test("kept when the callee asks who is calling", () => {
    const line = new Line();
    const s = new CallSession({ callId: "w", taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: llm([""]) });
    (s as any).history.push({ role: "agent", text: "opening" }, { role: "agent", text: "Jeg vil gjerne bestille." }, { role: "callee", text: "Hvem er det som ringer?" });
    expect(s.withoutReintro("Jeg er en KI-assistent som ringer på vegne av Sverre.")).toBe("Jeg er en KI-assistent som ringer på vegne av Sverre.");
  });
});

describe("4: times come from code, not the model", () => {
  test("an invented time is blocked and turned into one question", async () => {
    const { line, s, said, evs } = await session(["Da mener du klokka 00:30, altså halv ett på natta."]);
    line.ev.calleeFinal("c1", "Du kan hente den en time etter tolv på natta.");
    await Bun.sleep(100);
    expect(said()).toEqual(["Hvilket klokkeslett mener du?"]);
    // The LLM saw the parsed time as a fact.
    expect(JSON.stringify((s as any).history)).toContain("⟨tid: 01:00⟩");
    await s.finish("test");
    expect(evs.length).toBeGreaterThan(0);
  });

  test("times the callee actually said are allowed", async () => {
    const { line, s, said } = await session(["Klokka 19:00 i kveld kan fungere."]);
    line.ev.calleeFinal("c1", "Vi kan ha den klar klokka sju i kveld.");
    await Bun.sleep(100);
    expect(said()).toEqual(["Klokka 19:00 i kveld kan fungere."]);
    await s.finish("test");
  });
});

describe("5: futile calls go back to the user", () => {
  test("third ask about the goal becomes an approval card; «Legg på» ends as partial", async () => {
    const { line, s, evs, said } = await session([
      "Har dere en stor pepperoni til henting?",
      "Kan jeg få en stor pepperoni til 18:00 da?",
      "Er det helt sikkert at dere ikke har stor pepperoni?",
    ]);
    for (const [id, t] of [["c1", "Nei, det er tomt."], ["c2", "Nei, vi har ingen igjen, men vi har klokka sju i kveld."], ["c3", "Nei, sa jeg."]]) {
      line.ev.calleeFinal(id!, t!);
      await Bun.sleep(80);
    }
    const ap = evs.find((e) => e.type === "approval_request") as any;
    expect(ap).toBeDefined();
    expect(ap.options).toEqual(["Godta det de tilbyr", "Prøv noe annet", "Legg på"]);
    expect(ap.question).toContain("Nei, sa jeg.");
    expect(said().filter((t) => /pepperoni/.test(t)).length).toBe(2);
    s.command({ type: "approval_response", id: ap.id, choice: "Legg på" });
    await Bun.sleep(100);
    expect(s.isEnded).toBe(true);
    expect((evs.at(-1) as any).result.outcome).toBe("partial");
  });

  test("no progress for the cap → polite wrap-up as partial", async () => {
    const saved = config.unproductiveSec;
    config.unproductiveSec = 0.2;
    try {
      const { line, s, evs } = await session(["Okei.", "Ja vel.", "Skjønner."]);
      line.ev.calleeFinal("c1", "Hm.");
      await Bun.sleep(300);
      line.ev.calleeFinal("c2", "Ja, og så?");
      await Bun.sleep(150);
      expect(s.isEnded).toBe(true);
      expect((evs.at(-1) as any).result.outcome).toBe("partial");
    } finally { config.unproductiveSec = saved; }
  });
});

describe("7: messages for the user", () => {
  test("«si til Sverre at …» → note + result detail", async () => {
    const { line, s, evs } = await session(["Det skal jeg si til ham. Ha det!"]);
    line.ev.calleeFinal("c1", "Kan du si til Sverre at dette funka helt greit?");
    await Bun.sleep(150);
    expect(evs.some((e) => e.type === "note" && e.text.includes("dette funka helt greit"))).toBe(true);
    expect(s.isEnded).toBe(true);
    expect((evs.at(-1) as any).result.details.beskjed).toContain("dette funka helt greit");
  });
});

describe("call #6: batch correction arriving after the turn started", () => {
  test("restarts the turn with the corrected text if nothing was said yet", async () => {
    const seen: string[] = [];
    const line = Object.assign(new Line(), { revises: true });
    line.quiet = 0; // callee still audible → agent waits before speaking
    const l: LlmProvider = {
      name: "fake",
      clarify: async () => ({ summary: "", questions: [] }),
      plan: async () => ({ calleeName: "", goal: "", willShare: [], needsApprovalFor: [] }),
      summarize: async () => ({ outcome: "partial", summary: "x", details: {} }),
      async *reply(ctx) { const last = ctx.history.at(-1)!.text; seen.push(last); yield /ikke/.test(last) ? "Å, da ringer jeg et annet sted." : "Så fint!"; },
    };
    const s = new CallSession({ callId: "r6", taskId: "t", plan: { ...plan }, profile: { name: "Sverre", hearCall: true, personality: "warm", lang: "no" }, line, llm: l });
    await s.start();
    await Bun.sleep(30);
    line.ev.calleeFinal("c1", "Vi selger ekte pizza.");
    await Bun.sleep(300);
    line.ev.calleeRevised!("c1", "Vi selger ikke pizza", []);
    line.quiet = Infinity;
    await Bun.sleep(200);
    expect(line.spoken.slice(1)).toEqual(["Å, da ringer jeg et annet sted."]);
    await s.finish("test");
  });
});
