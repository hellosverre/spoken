import { afterAll, describe, expect, test } from "bun:test";
import { startServer } from "./helpers.ts";

const s = startServer();
afterAll(() => s.stop());
const targets = [
  { name: "Pizzabakeren", phone: "+4722000001" },
  { name: "Dolce Vita", phone: "+4722000002" },
  { name: "Peppes", phone: "+4722000003" },
];

describe("compare", () => {
  test("3 mock legs run concurrently, answers differ, nobody books", async () => {
    const start = await s.post("/api/compare", { text: "billigste store pepperoni, henting i kveld", lang: "no", targets });
    expect(start.status).toBe(200);
    expect(start.data.legs).toHaveLength(3);
    let st: any;
    for (let i = 0; i < 300; i++) {
      st = (await s.get(`/api/compare/${start.data.compareId}`)).data;
      if (st.done) break;
      await Bun.sleep(100);
    }
    expect(st.done).toBe(true);
    const answers = st.legs.map((l: any) => l.answer);
    expect(new Set(answers).size).toBe(3);
    for (const l of st.legs) {
      expect(l.outcome).toBe("done");
      expect(l.answer).toMatch(/kr/);
    }
    for (const l of start.data.legs) {
      const r = await s.get(`/api/calls/${l.callId}`);
      expect(r.status).toBe(200);
      const said = r.data.transcript.filter((t: any) => t.who === "agent").map((t: any) => t.text).join(" ");
      expect(said).not.toMatch(/bestill(er|ing) (en|den)|ja takk|bekrefter/i);
    }
  });

  test("validation: 1 or 4 targets, emergency number, bad text", async () => {
    expect((await s.post("/api/compare", { text: "pizza", lang: "no", targets: targets.slice(0, 1) })).status).toBe(400);
    expect((await s.post("/api/compare", { text: "pizza", lang: "no", targets: [...targets, targets[0]] })).status).toBe(400);
    expect((await s.post("/api/compare", { text: "pizza", lang: "no", targets: [targets[0], { name: "X", phone: "113" }] })).status).toBe(403);
    expect((await s.post("/api/compare", { text: "", lang: "no", targets })).status).toBe(400);
  });

  test("each leg counts against the daily call cap", async () => {
    const { config } = await import("../src/config.ts");
    const { resetLimits } = await import("../src/store.ts");
    const old = config.maxCallsPerDay;
    resetLimits();
    config.maxCallsPerDay = 2;
    const r = await s.post("/api/compare", { text: "pizza", lang: "no", targets });
    config.maxCallsPerDay = old;
    resetLimits();
    expect(r.status).toBe(429);
  });

  test("unknown id is 404", async () => {
    expect((await s.get("/api/compare/nope")).status).toBe(404);
  });
});

describe("chat planner → compare", () => {
  test("three numbers in one request → plan.targets, then /api/compare from the same text", async () => {
    const text = "Hva koster en stor pepperoni? Ring 22000001, 22000002 og 22000003";
    const t = await s.post("/api/tasks", { text, lang: "no" });
    expect(t.status).toBe(200);
    const plan = await s.post(`/api/tasks/${t.data.taskId}/answers`, { answers: {} });
    expect(plan.data.blocked).toBeUndefined();
    expect(plan.data.targets).toHaveLength(3);
    expect(plan.data.targets.map((x: any) => x.phone)).toEqual(["+4722000001", "+4722000002", "+4722000003"]);
    expect(plan.data.callee.phone).toBe("+4722000001");
    expect(plan.data.goal).toMatch(/3 steder/);
    const start = await s.post("/api/compare", { text, lang: "no", targets: plan.data.targets });
    expect(start.status).toBe(200);
    expect(start.data.legs).toHaveLength(3);
  });

  test("one number stays a single call (no targets, no parallel claim)", async () => {
    const t = await s.post("/api/tasks", { text: "Bestill en stor pepperoni hos 22000001", lang: "no", phone: "22000001" });
    const plan = await s.post(`/api/tasks/${t.data.taskId}/answers`, { answers: {} });
    expect(plan.data.targets).toBeUndefined();
    expect(plan.data.goal).not.toMatch(/steder/);
  });
});
