// Realtime vs batch on call c_05079f8d4529 (lines the user said were never spoken).
import { expect, test } from "bun:test";
import { batchVerdict } from "../src/call/batch-verdict.ts";

test("noise tag from batch drops a made-up realtime line", () => {
  expect(batchVerdict("Jeg vet ikke hva jeg skal gjøre.", "[snakking i bakgrunnen]", 0.42)).toBe("noise");
  expect(batchVerdict("Ja.", "(musikk)", undefined)).toBe("noise");
  expect(batchVerdict("Pepperoni pizza.", "[snakking i bakgrunnen]", 0.95)).toBe("keep"); // realtime was sure
});

test("a much surer batch wins even with no shared words", () => {
  expect(batchVerdict("Hold da.", "Ha det bra!", 0.63, 0.93)).toBe("revise");
  expect(batchVerdict("Jeg må bare se på andre, så kan jeg bare bestille.", "Domino's, har bare adressen og telefonnummeret ditt på vent litt.", 0.54, 0.9)).toBe("revise");
  expect(batchVerdict("Hold da.", "Ha det bra!", 0.63, 0.7)).toBe("keep"); // batch not sure enough
  // c_5b26344610cc: right at 0.95+, wrong at 0.86.
  expect(batchVerdict("Okei, da får jeg se om jeg kan akte den.", "Okay, da sees vi klokka åtte", 0.56, 0.96)).toBe("revise");
  expect(batchVerdict("Hva kan jeg hjelpe deg med?", "To kroner hjelper, nå", 0.61, 0.86)).toBe("keep");
  expect(batchVerdict("Pepperoni pizza.", "Peppa pizza", 0.9, 0.95)).toBe("keep"); // realtime was sure
});

test("otherwise only numbers may change, and the window must overlap", () => {
  expect(batchVerdict("Den koster 15 kroner.", "Den koster femti kroner.", 0.7, 0.8)).toBe("revise");
  expect(batchVerdict("hvor skal vi ha adressen", "hvor så var adressen", 0.7, 0.8)).toBe("keep");
  expect(batchVerdict("I Storo.", "Bestill levering", 0.7, 0.8)).toBe("keep");
  expect(batchVerdict("Ja.", "Ja, ja. Hva skal du ha på pizzaen i dag da, vennen?", 0.3, 0.95)).toBe("keep"); // wrong window size
});
