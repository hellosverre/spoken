import { describe, expect, test } from "bun:test";
import { createPersister, MAX_AGE_MS, parseDurable, PERSIST_KEY, PERSIST_VERSION, toDurable, type Source, type StorageLike } from "./persist";

const mem = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};
const src = (over: Partial<Source> = {}): Source => ({
  tab: "chat", screen: "call", scenario: "real", thread: [{ kind: "me" }, { kind: "dots" }, { kind: "plan" }],
  draft: "hei", liveCallId: "c1", callStartedAt: 1000, transcript: [{ id: 1 }], elapsed: "0:42", pill: "live",
  callEnded: false, chips: ["a"], holdSince: null, sheet: null, multi: null, ...over,
});
const extras = { uid: 9, receipt: null, facts: [], recent: [], now: 5000 };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("persist", () => {
  test("round trip drops typing dots and keeps the call", () => {
    const d = parseDurable(JSON.stringify(toDurable(src(), extras)), 5000)!;
    expect(d.thread).toHaveLength(2);
    expect(d.liveCallId).toBe("c1");
    expect(d.screen).toBe("call");
    expect(d.transcript).toEqual([{ id: 1 }]);
  });
  test("approval sheets are not saved, result sheets are", () => {
    expect(toDurable(src({ sheet: { kind: "ask" } }), extras).result).toBeNull();
    expect(toDurable(src({ sheet: { kind: "result" } }), extras).result).toEqual({ kind: "result" });
  });
  test("multi-call falls back to home", () => {
    expect(toDurable(src({ multi: {} }), extras).screen).toBe("home");
  });
  test("keeps at most 20 recent calls", () => {
    const recent = Array.from({ length: 30 }, (_, i) => ({ callId: `c${i}`, contact: "x", title: "t", ok: true, at: i }));
    const d = toDurable(src(), { ...extras, recent });
    expect(d.recent).toHaveLength(20);
    expect(d.recent[19]!.callId).toBe("c29");
  });
  test("version bump, corrupt data and stale data restore nothing", () => {
    const raw = JSON.stringify(toDurable(src(), extras));
    expect(parseDurable(JSON.stringify({ ...JSON.parse(raw), v: PERSIST_VERSION + 1 }), 5000)).toBeNull();
    expect(parseDurable("{nope", 5000)).toBeNull();
    expect(parseDurable(null, 5000)).toBeNull();
    expect(parseDurable(raw, 5000 + MAX_AGE_MS + 1)).toBeNull();
  });
  test("debounced save, load, and logout clear", async () => {
    const st = mem();
    const p = createPersister(st, 20);
    let n = 0;
    for (let i = 0; i < 5; i++) p.schedule(() => toDurable(src({ draft: `d${++n}` }), extras));
    expect(st.data.size).toBe(0);
    await wait(60);
    expect(st.data.size).toBe(1);
    expect((await p.load(5000))!.draft).toBe("d1"); // computed once, when the timer fired
    p.schedule(() => toDurable(src(), extras));
    await p.clear(); // logout while a write is pending: nothing may land afterwards
    await wait(60);
    expect(st.data.has(PERSIST_KEY)).toBe(false);
    expect(await p.load(5000)).toBeNull();
  });
  test("an old-version blob is removed on load", async () => {
    const st = mem();
    st.data.set(PERSIST_KEY, JSON.stringify({ v: 0 }));
    expect(await createPersister(st).load()).toBeNull();
    expect(st.data.size).toBe(0);
  });
  test("the token never appears in saved state", () => {
    expect(JSON.stringify(toDurable(src(), extras))).not.toMatch(/token|passcode/i);
  });
});
