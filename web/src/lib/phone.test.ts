import { test } from "node:test";
import assert from "node:assert/strict";
const expect = (a: unknown) => ({ toBe: (b: unknown) => assert.equal(a, b), toEqual: (b: unknown) => assert.deepEqual(a, b) });
import { e164List, toE164 } from "./phone";

test("Norwegian formats", () => {
  for (const r of ["91234567", "912 34 567", "91 23 45 67", "+47 912 34 567", "0047 91234567", "4791234567", "(47) 912-34-567"])
    expect(toE164(r)).toBe("+4791234567");
});
test("foreign numbers keep their country", () => {
  expect(toE164("+1 (415) 555-2671")).toBe("+14155552671");
  expect(toE164("0046 70 123 45 67")).toBe("+46701234567");
});
test("junk and short codes are rejected", () => {
  for (const r of ["", "112", "1412", "abc", "+47 123", "12345"]) expect(toE164(r)).toBe("");
});
test("list dedupes", () => {
  expect(e164List(["91234567", "+47 91 23 45 67", "112"])).toEqual(["+4791234567"]);
});
