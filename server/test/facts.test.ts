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
