import { expect, test } from "bun:test";
import { extractFacts, FactTracker, wordsToInt } from "../src/call/facts.ts";

const vals = (t: string, kind: string) => extractFacts(t).filter((f) => f.kind === kind).map((f) => f.value);

test("price: digits, thousands, spelled out", () => {
  expect(vals("Det blir 189 kroner.", "price")).toEqual(["189 kr"]);
  expect(vals("Totalt 1 250 kr", "price")).toEqual(["1250 kr"]);
  expect(vals("250,-", "price")).toEqual(["250 kr"]);
  expect(vals("Det blir to hundre og femti kroner totalt.", "price")).toEqual(["250 kr"]);
  expect(vals("Det blir femten kroner.", "price")).toEqual(["15 kr"]);
  expect(vals("Det blir femti kroner.", "price")).toEqual(["50 kr"]);
  expect(vals("Ingen pris her", "price")).toEqual([]);
  expect(wordsToInt(["tusen", "to", "hundre"])).toBe(1200);
  expect(wordsToInt(["hundre", "og", "åttini"])).toBe(189);
});

test("time: 24h, spoken, day prefix; ambiguous stays out", () => {
  expect(vals("Den er klar klokka 18:00.", "time")).toEqual(["kl. 18:00"]);
  expect(vals("Vi har ledig i morgen klokka 14.30", "time")).toEqual(["i morgen kl. 14:30"]);
  expect(vals("Klokka seks passer", "time")).toEqual([]);
  expect(vals("Det går bra i morgen", "time")).toEqual([]);
});

test("address and reference number", () => {
  expect(vals("Vi ligger i Storgata 5, 0182 Oslo", "address")).toEqual(["Storgata 5, 0182 Oslo"]);
  expect(vals("Adressen er Karl Johans gate 12B.", "address")).toEqual(["Karl Johans gate 12B"]);
  expect(vals("Bestillingsnummeret er 48213.", "ref")).toEqual(["48213"]);
  expect(vals("Referansen er AB-1234", "ref")).toEqual(["AB-1234"]);
  expect(vals("Your confirmation number is 77120", "ref")).toEqual(["77120"]);
  expect(vals("Ring oss på 22 33 44 55", "ref")).toEqual([]);
});

test("hints are ignored", () => {
  expect(extractFacts("Klokka 18:00 ⟨tid: 18:00⟩").filter((f) => f.kind === "time")).toHaveLength(1);
});

test("confirmed: false first, true when batch agrees", () => {
  const t = new FactTracker();
  expect(t.observe("callee", "s1", "Det blir 250 kroner.")).toEqual([{ kind: "price", value: "250 kr", confirmed: false }]);
  expect(t.batchAgrees("s1")).toEqual([{ kind: "price", value: "250 kr", confirmed: true }]);
});

test("confirmed: batch revision replaces the fact and does not confirm it", () => {
  const t = new FactTracker();
  t.observe("callee", "s1", "Det blir 15 kroner.");
  expect(t.observe("callee", "s1", "Det blir 50 kroner.")).toEqual([{ kind: "price", value: "50 kr", confirmed: false }]);
  expect(t.batchAgrees("s1")).toBeUndefined();
});

test("confirmed: callee repeats it in another segment", () => {
  const t = new FactTracker();
  t.observe("callee", "s1", "Klar klokka 18:00.");
  expect(t.observe("callee", "s2", "Ja, klokka 18:00.")![0]!.confirmed).toBe(true);
});

test("confirmed: read-back answered with yes", () => {
  const t = new FactTracker();
  t.observe("callee", "s1", "189 kroner, hentes 18:00.");
  t.observe("agent", "a1", "Så 189 kroner, klokka 18:00?");
  const items = t.observe("callee", "s2", "Ja, det stemmer.")!;
  expect(items.every((i) => i.confirmed)).toBe(true);
});

test("noise removes the fact", () => {
  const t = new FactTracker();
  t.observe("callee", "s1", "250 kroner");
  expect(t.drop("s1")).toEqual([]);
});

test("a yes without a read-back confirms nothing", () => {
  const t = new FactTracker();
  t.observe("callee", "s1", "250 kroner");
  t.observe("callee", "s2", "Ja");
  expect(t.items()[0]!.confirmed).toBe(false);
});

import { entityKind, entitiesToFacts, normalizePhone } from "../src/call/facts.ts";

test("entity types map to fact kinds; sensitive ones stay out", () => {
  expect(entityKind("phone_number")).toBe("phone");
  expect(entityKind("money")).toBe("price");
  expect(entityKind("location_address")).toBe("address");
  expect(entityKind("document_reference")).toBe("ref");
  expect(entityKind("name_given")).toBe("name");
  expect(entityKind("credit_card")).toBeUndefined();
  expect(entityKind("dob")).toBeUndefined();
});

test("Norwegian entities are normalised", () => {
  const f = entitiesToFacts([
    { text: "22334455", entity_type: "phone_number" },
    { text: "+47 91 23 45 67", entity_type: "phone_number" },
    { text: "250 kroner", entity_type: "money" },
    { text: "klokka 14.30", entity_type: "time" },
    { text: "i morgen", entity_type: "date" },
    { text: "Storgata 5", entity_type: "location_address" },
    { text: "Kari", entity_type: "name" },
    { text: "4242 4242 4242 4242", entity_type: "credit_card" },
  ]);
  expect(f).toEqual([
    { kind: "phone", value: "22 33 44 55" },
    { kind: "phone", value: "+47 91 23 45 67" },
    { kind: "price", value: "250 kr" },
    { kind: "time", value: "kl. 14:30" },
    { kind: "date", value: "i morgen" },
    { kind: "address", value: "Storgata 5" },
    { kind: "name", value: "Kari" },
  ]);
  expect(normalizePhone("12")).toBeUndefined();
});

test("entities dedupe against regex facts and fold into richer ones", () => {
  const t = new FactTracker();
  t.observe("callee", "c1", "Vi har ledig i morgen klokka 14.30, det blir 250 kroner. Ring 22 33 44 55.");
  const items = t.observeEntities("Vi har ledig i morgen klokka 14.30, det blir 250 kroner. Ring 22 33 44 55.", [
    { text: "klokka 14.30", entity_type: "time" },
    { text: "250 kroner", entity_type: "money" },
    { text: "22 33 44 55", entity_type: "phone_number" },
    { text: "i morgen", entity_type: "date" },
  ])!;
  expect(items.filter((i) => i.kind === "time").map((i) => i.value)).toEqual(["i morgen kl. 14:30"]);
  expect(items.filter((i) => i.kind === "price").length).toBe(1);
  expect(items.find((i) => i.kind === "phone")?.value).toBe("22 33 44 55");
  expect(items.find((i) => i.kind === "date")?.value).toBe("i morgen");
});

test("entities that arrive before their line apply when it lands; repeat confirms; drop removes", () => {
  const t = new FactTracker();
  expect(t.observeEntities("Nummeret er 22334455", [{ text: "22334455", entity_type: "phone_number" }])).toBeUndefined();
  const a = t.observe("callee", "c1", "Nummeret er 22334455")!;
  expect(a.find((i) => i.kind === "phone")).toEqual({ kind: "phone", value: "22 33 44 55", confirmed: false });
  t.observe("callee", "c2", "Altså 22 33 44 55");
  const b = t.observeEntities("Altså 22 33 44 55", [{ text: "22 33 44 55", entity_type: "phone_number" }])!;
  expect(b.find((i) => i.kind === "phone")?.confirmed).toBe(true);
  t.drop("c1"); t.drop("c2");
  expect(t.items().length).toBe(0);
});

test("phone numbers next to a phone word are caught by regex too", () => {
  expect(vals("Ring oss på 22 33 44 55", "phone")).toEqual(["22 33 44 55"]);
  expect(vals("Telefon +47 91234567.", "phone")).toEqual(["91 23 45 67"]);
  expect(vals("Det blir 22334455 kroner", "phone")).toEqual([]);
});
