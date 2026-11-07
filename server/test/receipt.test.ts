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
