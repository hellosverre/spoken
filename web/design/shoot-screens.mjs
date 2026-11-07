// Clicks through the whole flow against the in-browser mock and screenshots every
// screen at phone and desktop width, dark and light. Fails loudly if a step breaks,
// so it doubles as the smoke test. Needs `bun run build` first.
//   node design/shoot-screens.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "design", "screens");
mkdirSync(out, { recursive: true });
const PORT = 4791;

function nixChrome() {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir) return undefined;
  const d = readdirSync(dir).find((n) => /^chromium-\d+$/.test(n));
  return d ? path.join(dir, d, "chrome-linux64", "chrome") : undefined;
}

process.on("exit", () => server.kill());
const server = spawn("node_modules/.bin/vite", ["preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe" });
await new Promise((resolve, reject) => {
  server.stdout.on("data", (b) => String(b).includes(String(PORT)) && resolve());
  server.on("exit", (c) => reject(new Error(`vite preview exited ${c}`)));
  setTimeout(() => reject(new Error("vite preview did not start")), 15000);
});

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || nixChrome() || chromium.executablePath() });
const errors = [];

async function run(width, height, scheme, calm = false) {
  const tag = `${width}-${scheme}${calm ? "-calm" : ""}`;
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: calm ? "reduce" : "no-preference", deviceScaleFactor: width < 500 ? 2 : 1, locale: "en-US" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  // Wait until the leaving page has finished its exit, so only one screen is on stage.
  const settle = () => page.waitForFunction(() => document.querySelectorAll(".sp-page").length === 1);
  const shot = async (name) => {
    await settle();
    await page.waitForTimeout(name === "call" || name === "approval" ? 0 : 900);
    return page.screenshot({ path: path.join(out, `${name}-${tag}.png`), fullPage: name !== "call" && name !== "approval" });
  };

  await page.goto(`http://localhost:${PORT}/?mockSpeed=3#/`);
  await page.getByLabel("Your first name").fill("Sverre");
  await shot("onboarding-1");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "How do you want to follow calls?" }).waitFor();
  await settle();
  await shot("onboarding-2");
  await page.getByRole("button", { name: "Next" }).click();
  await settle();
  await page.getByText("Ingrid").waitFor();
  await shot("onboarding-3");
  await page.getByRole("button", { name: "Start using Spoken" }).click();

  await page.getByRole("heading", { name: "What do you want done?" }).waitFor();
  await page.getByRole("textbox", { name: "What do you want done?" }).fill("Order a large pepperoni from Domino's Storo for 18:00");
  await shot("home");
  await page.getByRole("button", { name: "Plan the call" }).click();

  await page.getByRole("heading", { name: "A few quick questions" }).waitFor();
  await page.getByText("Pickup", { exact: true }).click();
  await page.getByText("No, that's all").click();
  await shot("clarify");
  await page.getByRole("button", { name: "See the plan" }).click();

  await page.getByRole("heading", { name: "The plan" }).waitFor();
  await shot("plan");
  await page.getByRole("button", { name: "OK, call now" }).click();

  await page.locator(".sp-line").first().waitFor();
  await page.waitForTimeout(2500);
  await shot("call");
  await page.getByRole("alertdialog").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1800); // let the alert flash finish
  await shot("approval");
  await page.getByRole("button", { name: "JA" }).click();

  await page.getByRole("heading", { name: "Result" }).waitFor({ timeout: 30000 });
  await page.getByText("Full transcript").click();
  await shot("result");

  await page.goto(`http://localhost:${PORT}/#/settings`);
  await page.getByRole("heading", { name: "Settings" }).waitFor();
  await shot("settings");
  await page.goto(`http://localhost:${PORT}/#/privacy`);
  await shot("privacy");
  await ctx.close();
  console.log(`ok ${tag}`);
}

try {
  for (const [w, h] of [[390, 844], [1440, 900]]) for (const s of ["dark", "light"]) await run(w, h, s);
  // The calm fallback must carry the whole flow too.
  await run(390, 844, "dark", true);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error("Console errors:\n" + errors.join("\n"));
  process.exit(1);
}
