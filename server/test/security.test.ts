import { afterAll, beforeAll, expect, test } from "bun:test";
import { startServer } from "./helpers.ts";

// Requests that arrive through the Cloudflare tunnel carry cf-connecting-ip.
let s: ReturnType<typeof startServer>;
beforeAll(() => { s = startServer(); });
afterAll(() => s.stop());

test("public PUT /api/profile without a device id cannot overwrite the default profile", async () => {
  const r = await fetch(`${s.base}/api/profile`, {
    method: "PUT",
    headers: { "cf-connecting-ip": "203.0.113.7" },
    body: JSON.stringify({ name: "Hacker", hearCall: false, personality: "short", lang: "no" }),
  });
  expect(r.status).toBe(400);
  expect(((await (await fetch(`${s.base}/api/profile`)).json()) as any).name).not.toBe("Hacker");
});

test("POST /api/tasks is rate limited per client IP", async () => {
  const send = () => fetch(`${s.base}/api/tasks`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.8" }, body: "{}" });
  for (let i = 0; i < 30; i++) expect((await send()).status).toBe(400);
  expect((await send()).status).toBe(429);
});

test("rotating X-Spoken-User does not dodge the limit", async () => {
  const send = (u: string) => fetch(`${s.base}/api/tasks`, { method: "POST", headers: { "cf-connecting-ip": "203.0.113.9", "x-spoken-user": u }, body: "{}" });
  for (let i = 0; i < 30; i++) await send(`u${i}`);
  expect((await send("fresh")).status).toBe(429);
});

