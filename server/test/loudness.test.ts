// c_d3457ddfdd92: the callee peaked at 2800–5700 RMS, voices in the room at 300–1300.
import { expect, test } from "bun:test";
import { peakLevel, SpeakerLevel } from "../src/call/loudness.ts";

test("peakLevel is the 90th percentile", () => {
  expect(peakLevel([])).toBe(0);
  expect(peakLevel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
  expect(peakLevel([100, 100, 100, 100, 100, 100, 100, 100, 100, 5000, 5000])).toBe(5000);
});

test("quiet voices in the room are background once the speaker is known", () => {
  const s = new SpeakerLevel();
  expect(s.isBackground(800)).toBe(false); // nothing learnt yet: keep everything
  s.accept(4404);
  expect(s.isBackground(1289)).toBe(true);
  expect(s.isBackground(301)).toBe(true);
  expect(s.isBackground(2795)).toBe(false);
});

test("no filtering while the speaker is quiet, and one shout fades", () => {
  const s = new SpeakerLevel();
  s.accept(1200);
  expect(s.isBackground(300)).toBe(false); // speaker under 1500: too little to go on
  s.accept(9000);
  for (let i = 0; i < 10; i++) s.accept(3000);
  expect(s.level).toBeLessThan(4000);
  expect(s.isBackground(1100)).toBe(false);
});
