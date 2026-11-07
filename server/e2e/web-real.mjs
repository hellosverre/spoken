// End-to-end: the real web build (web/dist, VITE_API_URL=/) served by the Bun call server in
// mock mode, driven headless like a user: onboarding → task → clarify → plan → OK → live
// transcript from the server → JA tapped by "the human" → result.
// Run from server/:  (cd ../web && VITE_API_URL=/ bun run build) && node e2e/web-real.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.dirname(here);
const require = createRequire(path.join(serverDir, "../web/package.json"));
const { chromium } = require("playwright");

const PORT = 8795;
const srv = spawn("bun", ["src/index.ts"], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT), CALL_PROVIDER: "mock", LLM_PROVIDER: "mock", MOCK_SPEED: "0.3", CALL_LOG: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});
const kill = () => srv.kill();
process.on("exit", kill);
await new Promise((res, rej) => {
  srv.stdout.on("data", (b) => String(b).includes("listening") && res());
  setTimeout(() => rej(new Error("server did not start")), 10000);
});

const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
const d = dir && readdirSync(dir).find((n) => /^chromium-\d+$/.test(n));
const exe = process.env.CHROME_PATH || (d ? path.join(dir, d, "chrome-linux64", "chrome") : undefined);
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "nb-NO", hasTouch: true })).newPage();
const errors = [];
const api = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const sockets = [];
page.on("websocket", (ws) => sockets.push(ws.url()));

const step = (s) => console.log(`- ${s}`);
let ok = false;
try {
  await page.goto(`http://localhost:${PORT}/`);
  // Onboarding (labels follow the browser locale; match both)
  await page.getByRole("textbox").first().fill("Sverre");
  for (let i = 0; i < 3; i++) {
    const next = page.getByRole("button", { name: /^(Neste|Next|Start|Kom i gang|Begynn)/i }).first();
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(400);
  }
  step("onboarding done");
  const task = page.getByRole("textbox").first();
  await task.waitFor();
  await task.fill("Bestill en stor pepperoni fra Domino's Storo til 18:00");
  await page.getByRole("button", { name: /(Planlegg|Plan the call)/i }).click();
  step("task sent");
  await page.locator("fieldset.sp-question").first().waitFor({ timeout: 10000 });
  for (const fs of await page.locator("fieldset.sp-question").all()) {
    const choice = fs.locator("label.sp-choice").first();
    if (await choice.count()) await choice.click();
  }
  step(`clarify answered (${await page.locator("fieldset.sp-question").count()} questions from the server)`);
  await page.getByRole("button", { name: /(Se planen|See the plan)/i }).click();
  await page.getByRole("button", { name: /(OK, ring|OK, call)/i }).waitFor({ timeout: 10000 });
  step("plan shown");
  await page.getByRole("button", { name: /(OK, ring|OK, call)/i }).click();
  await page.locator(".sp-line").first().waitFor({ timeout: 15000 });
  step("live transcript streaming");
  const card = page.getByRole("alertdialog");
  await card.waitFor({ timeout: 40000 });
  // The server must wait for the human: still open after 3 s with nobody tapping.
  await page.waitForTimeout(3000);
  if (!(await card.isVisible())) throw new Error("approval card closed without a human answer");
  step(`approval card waits for the human: «${(await card.innerText()).split("\n")[0].slice(0, 70)}»`);
  await card.getByRole("button", { name: "JA" }).click();
  step("JA tapped");
  await page.getByRole("heading", { name: /(Resultat|Result)/i }).waitFor({ timeout: 40000 });
  const body = await page.locator("main, body").first().innerText();
  step(`result: ${body.split("\n").filter((l) => /Bestilt|Ferdig|189|done/i.test(l)).slice(0, 2).join(" | ")}`);
  ok = errors.length === 0;
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await page.screenshot({ path: path.join(here, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  console.log(`api calls: ${[...new Set(api)].join(", ")}`);
  console.log(`websockets: ${sockets.join(", ")}`);
  if (errors.length) console.log(`errors: ${errors.join("; ")}`);
  await browser.close();
  kill();
}
console.log(ok ? "E2E OK" : "E2E FAILED");
process.exit(ok ? 0 : 1);
