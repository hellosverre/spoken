import { describe, expect, test } from "bun:test";
import { parseTimes, timeHint } from "../src/time.ts";

const one = (s: string) => parseTimes(s)[0];

describe("Norwegian time parsing", () => {
  test("digital and spoken clock times", () => {
    expect(one("Den er klar 18:00")).toMatchObject({ kind: "time", hhmm: "18:00" });
    expect(one("kl. 18.30")).toMatchObject({ kind: "time", hhmm: "18:30" });
    expect(one("klokka sju i kveld")).toMatchObject({ kind: "time", hhmm: "19:00" });
    expect(one("halv sju i kveld")).toMatchObject({ kind: "time", hhmm: "18:30" });
    expect(one("kvart over fem på ettermiddagen")).toMatchObject({ kind: "time", hhmm: "17:15" });
    expect(one("kvart på seks i kveld")).toMatchObject({ kind: "time", hhmm: "17:45" });
    expect(one("fem på halv åtte i kveld")).toMatchObject({ kind: "time", hhmm: "19:25" });
  });
  test("invalid times are flagged, never fixed", () => {
    expect(one("du kan hente den 25:00")).toMatchObject({ kind: "invalid" });
    expect(one("klokka tjuefem null null")).toMatchObject({ kind: "invalid" });
    expect(one("18:75")).toMatchObject({ kind: "invalid" });
  });
  test("«en time etter tolv på natta» is 01:00, not 00:30", () => {
    expect(one("en time etter tolv på natta")).toMatchObject({ kind: "time", hhmm: "01:00" });
  });
  test("ambiguous → both readings, or a range", () => {
    expect(one("klokka seks")).toMatchObject({ kind: "ambiguous", candidates: ["06:00", "18:00"] });
    expect(one("timen mellom tolv og ett")).toMatchObject({ kind: "ambiguous" });
  });
  test("hint for the LLM", () => {
    expect(timeHint("Du kan hente den i dag 25.00.")).toContain("ugyldig tid");
    expect(timeHint("Den er klar klokka sju i kveld.")).toBe("⟨tid: 19:00⟩");
    expect(timeHint("Hvilken pizza vil du ha?")).toBe("");
  });
});
