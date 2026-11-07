// Three things a real call hits that the pizza script never does: a voicemail, a phone menu
// («trykk 1») and a callee who wants the person themselves.
import { expect, test } from "bun:test";
import type { LiveEvent, Plan } from "../../shared/contract.ts";
import { MockLine, type MockScenario } from "../src/call/mock-line.ts";
import { Segmenter } from "../src/call/segment.ts";
import { CallSession } from "../src/call/session.ts";
import { MockLlm } from "../src/llm/mock.ts";
import "./helpers.ts";

const plan: Plan = {
  taskId: "t", callee: { name: "Domino's Storo", phone: "+4722000001", source: "lookup" },
  goal: "bestille en stor pepperoni til henting klokka 18:00", opening: "", willShare: ["name"], needsApprovalFor: ["pris"], voiceId: "v",
};

function run(scenario: MockScenario, lang: "no" | "en" = "no") {
  const line = new MockLine(0.02, scenario);
  const s = new CallSession({
    callId: `g_${Math.random()}`, taskId: "t", plan: { ...plan }, line, llm: new MockLlm(1),
    profile: { name: "Sverre", hearCall: true, personality: "warm", lang },
  });
  return { s, line, events: s.events };
}
const until = async (f: () => boolean, ms = 8000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await Bun.sleep(10); };
const agentSaid = (s: CallSession) => s.transcript.filter((t) => t.who === "agent").map((t) => t.text);

test("[[DTMF: 1]] parses to a dtmf segment; junk digits are dropped", () => {
  expect(new Segmenter().push("[[DTMF: 1]]")).toEqual([{ kind: "dtmf", digits: "1" }]);
  expect(new Segmenter().push("[[DTMF: *9]]")).toEqual([{ kind: "dtmf", digits: "*9" }]);
  expect(new Segmenter().push("[[DTMF: hei]]")).toEqual([]);
});

test("voicemail: hangs up, says nothing more, result asks to try later", async () => {
  const { s, line } = run("voicemail");
  await s.start();
  await until(() => s.isEnded);
  expect(s.result?.outcome).toBe("no_answer");
  expect(s.result?.summary).toBe("Ingen svarte (telefonsvarer). Prøv igjen senere?");
  expect(agentSaid(s).length).toBeLessThanOrEqual(1); // only the disclosure, no message left
  expect(line.dtmf).toEqual([]);
});

test("voicemail summary follows the user's language", async () => {
  const { s } = run("voicemail", "en");
  await s.start();
  await until(() => s.isEnded);
  expect(s.result?.summary).toBe("Nobody answered (voicemail). Try again later?");
});

test("phone menu: agent presses the key matching the goal, then the order goes through", async () => {
  const { s, line, events } = run("ivr");
  await s.start();
  await until(() => line.dtmf.length > 0);
  expect(line.dtmf).toEqual(["1"]); // «bestilling», not «kundeservice»
  await until(() => agentSaid(s).some((t) => /jeg vil gjerne/i.test(t)));
  expect(agentSaid(s).some((t) => /jeg vil gjerne/i.test(t))).toBe(true);
  expect(events.some((e) => e.type === "note" && /Trykker 1/.test((e as any).text))).toBe(true);
  await s.finish("test");
});

test("human request: explains once, asks the user with what was said, relays the answer", async () => {
  const { s, events } = run("human");
  await s.start();
  await until(() => events.some((e) => e.type === "approval_request"));
  const card = events.find((e) => e.type === "approval_request") as Extract<LiveEvent, { type: "approval_request" }>;
  expect(card.question).toContain("Kan jeg få snakke med personen selv");
  await until(() => agentSaid(s).some((t) => /døv/.test(t)));
  expect(agentSaid(s).some((t) => /døv/.test(t))).toBe(true);
  expect(s.isEnded).toBe(false); // did not hang up on them
  s.command({ type: "instruction", text: "Si at jeg kan svare på tekst" });
  await until(() => agentSaid(s).some((t) => /svare på tekst/i.test(t)));
  expect(agentSaid(s).some((t) => /svare på tekst/i.test(t))).toBe(true);
  expect(agentSaid(s).filter((t) => /døv/.test(t)).length).toBe(1);
  await s.finish("test");
});
