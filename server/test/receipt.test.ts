import { expect, test } from "bun:test";
import { buildReceipt, sharedFields } from "../src/call/receipt.ts";

const profile = { name: "Kari Nordmann", phone: "+4791234567", address: "Storgata 5", email: "kari@example.no", allergies: "nøtter, laktose" };
const base = { profile, approvals: [], callee: "Pizzabakeren", durationSec: 42, lang: "no" as const };
const L = (who: "agent" | "callee", text: string) => ({ who, text, at: 0 });

test("disclosure detected from the first agent line", () => {
  const r = buildReceipt({ ...base, transcript: [L("callee", "Pizzabakeren"), L("agent", "Hei, jeg er en KI-assistent som ringer på vegne av Kari Nordmann.")] });
  expect(r.disclosedAsAi).toBe(true);
  expect(r.disclosure).toContain("KI-assistent");
  const en = buildReceipt({ ...base, transcript: [L("agent", "Hi, I'm an AI assistant calling on behalf of Kari.")] });
  expect(en.disclosedAsAi).toBe(true);
});

test("no disclosure when the first agent line lacks it, or there is none", () => {
  expect(buildReceipt({ ...base, transcript: [L("agent", "Hei, jeg vil bestille pizza.")] }).disclosedAsAi).toBe(false);
  const none = buildReceipt({ ...base, transcript: [] });
  expect(none.disclosedAsAi).toBe(false);
  expect(none.disclosure).toBeUndefined();
});

test("shared lists only fields actually spoken", () => {
  expect(sharedFields(["Hei, jeg ringer på vegne av Kari Nordmann."], profile)).toEqual(["name"]);
  expect(sharedFields(["Navnet er Kari.", "Telefon 91 23 45 67.", "Adressen er Storgata 5."], profile)).toEqual(["name", "phone", "address"]);
  expect(sharedFields(["Nei, ingen nøtter."], profile)).toEqual(["allergies"]);
  expect(sharedFields(["Ni en to tre fire fem seks sju"], profile)).toEqual(["phone"]);
  expect(sharedFields(["Fødselsnummer er [fødselsnummer]"], profile)).toEqual(["fnr"]);
  expect(sharedFields(["Takk, ha det bra."], profile)).toEqual([]);
});

test("agreed vs declined approvals", () => {
  const r = buildReceipt({
    ...base,
    transcript: [L("agent", "Hei, jeg er en KI-assistent")],
    approvals: [{ question: "189 kroner, hentes 18:00?", choice: "JA" }, { question: "Legge til cola?", choice: "NEI" }, { question: "Oppgi adressen?", choice: "Godta" }],
  });
  expect(r.agreed.map((a) => a.question)).toEqual(["189 kroner, hentes 18:00?", "Oppgi adressen?"]);
  expect(r.declined).toEqual([{ question: "Legge til cola?", choice: "NEI" }]);
  expect(r.stored).toContain("Ingen lydopptak");
  expect(r.callee).toBe("Pizzabakeren");
  expect(r.durationSec).toBe(42);
});

import { afterAll, beforeAll } from "bun:test";
import { startServer, watchCall } from "./helpers.ts";

let s: ReturnType<typeof startServer>;
beforeAll(() => { s = startServer(); });
afterAll(() => s.stop());

test("mock call: facts event on the wire and a receipt on the result", async () => {
  const c = await s.post("/api/tasks", { text: "Bestill en stor pepperoni fra Domino's Storo til 18:00", lang: "no" });
  const answers: Record<string, string> = {};
  for (const q of c.data.questions) answers[q.id] = q.options?.[0] ?? "ja";
  const p = await s.post(`/api/tasks/${c.data.taskId}/answers`, { answers });
  const call = await s.post(`/api/tasks/${p.data.taskId}/call`, { approved: true });
  const evs = await watchCall(s.base, call.data.callId).done;
  const facts = evs.filter((e: any) => e.type === "facts") as any[];
  const last = facts.at(-1).items;
  expect(last.some((i: any) => i.kind === "price" && i.value === "189 kr")).toBe(true);
  expect(last.some((i: any) => i.kind === "time" && i.value === "kl. 18:00")).toBe(true);
  const result = (evs.find((e) => e.type === "result") as any).result;
  expect(result.receipt.disclosedAsAi).toBe(true);
  expect(result.receipt.shared).toContain("name");
  expect(result.receipt.agreed.length).toBeGreaterThan(0);
  expect(result.receipt.stored).toContain("Ingen lydopptak");
});
