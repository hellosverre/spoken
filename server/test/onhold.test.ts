import { describe, expect, test } from "bun:test";
import { OnHoldDetector } from "../src/call/onhold.ts";

function make() {
  let t = 1000;
  const ev: string[] = [];
  const d = new OnHoldDetector({ onHold: () => ev.push("on_hold"), holdOver: () => ev.push("hold_over"), now: () => t });
  return { d, ev, tick: (ms: number) => { t += ms; } };
}

describe("OnHoldDetector", () => {
  for (const phrase of ["Et øyeblikk.", "Vent litt, jeg setter deg på vent.", "Hold on", "One moment, please hold."]) {
    test(`«${phrase}» → on_hold, line swallowed`, () => {
      const { d, ev } = make();
      expect(d.onCallee(phrase)).toBe(true);
      expect(ev).toEqual(["on_hold"]);
    });
  }
  test("a question after the phrase is not a hold", () => {
    const { d, ev } = make();
    expect(d.onCallee("Et øyeblikk, hva heter du?")).toBe(false);
    expect(ev).toEqual([]);
  });
  test("person speaks again → hold_over, line goes to the agent", () => {
    const { d, ev, tick } = make();
    d.onCallee("Et øyeblikk");
    tick(500);
    expect(d.onCallee("la la")).toBe(true); // inside grace
    tick(5000);
    expect(d.onCallee("Hei, takk for at du ventet")).toBe(false);
    expect(ev).toEqual(["on_hold", "hold_over"]);
    expect(d.active).toBe(false);
  });
  test("short music noise keeps the hold", () => {
    const { d, ev, tick } = make();
    d.onCallee("Vent litt");
    tick(4000);
    expect(d.onCallee("mm")).toBe(true);
    expect(ev).toEqual(["on_hold"]);
  });
  test("end() closes an open hold once", () => {
    const { d, ev } = make();
    d.onCallee("Et øyeblikk");
    d.end(); d.end();
    expect(ev).toEqual(["on_hold", "hold_over"]);
  });
});
