// c_d3457ddfdd92: callee 2800–5700 RMS, voices in the room 300–1300.
// c_73b6b5529e9b: the callee said «Jeg vil ha pizza» at 604 and must not be dropped.
import { expect, test } from "bun:test";
import { peakLevel, SpeakerLevel } from "../src/call/loudness.ts";

test("peakLevel is the 90th percentile", () => {
  expect(peakLevel([])).toBe(0);
  expect(peakLevel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toBe(10);
});

test("nothing is filtered before the callee is known", () => {
  const s = new SpeakerLevel();
  expect(s.isFaint(300)).toBe(false);
  s.accept(1200);
  expect(s.isFaint(300)).toBe(false); // callee under 1500: too little to go on
});

test("quiet lines are marked, only very faint ones dropped", () => {
  const s = new SpeakerLevel();
  for (const p of [3833, 4069, 7056]) s.accept(p);
  expect(s.isBackground(604)).toBe(false); // the callee, quietly
  expect(s.isFaint(604)).toBe(true);
  expect(s.isBackground(301)).toBe(true);
  expect(s.isFaint(2795)).toBe(false);
});

test("one shout doesn't raise the bar", () => {
  const s = new SpeakerLevel();
  for (const p of [3000, 3200, 12000]) s.accept(p);
  expect(s.level).toBe(3200);
});
