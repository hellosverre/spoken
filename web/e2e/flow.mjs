// Headless click-test of the full flow against the in-browser mock.
// Needs `bun run build` first. Run: node e2e/flow.mjs   (screenshots -> e2e/shots, findings -> e2e/report.txt)
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "e2e", "shots");
mkdirSync(out, { recursive: true });
const PORT = 4793;
const findings = [];
const errors = [];

const server = spawn("node_modules/.bin/vite", ["preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe" });
process.on("exit", () => server.kill());
await new Promise((res, rej) => {
  server.stdout.on("data", (b) => String(b).includes(String(PORT)) && res());
  server.on("exit", (c) => rej(new Error(`preview exited ${c}`)));
  setTimeout(() => rej(new Error("preview timeout")), 15000);
});

function nixChrome() {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const d = dir && readdirSync(dir).find((n) => /^chromium-\d+$/.test(n));
  return d ? path.join(dir, d, "chrome-linux64", "chrome") : undefined;
}
const exe = process.env.CHROME_PATH || nixChrome() || chromium.executablePath();
const browser = await chromium.launch({ headless: true, executablePath: exe });

async function audit(page, tag, screen) {
  const issues = await page.evaluate(() => {
    const res = [];
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
    document.querySelectorAll("button, a[href], input, textarea, select, [role=button], [role=radio], [role=checkbox], [role=switch]").forEach((e) => {
      if (!vis(e)) return;
      const box = (e.type === "radio" || e.type === "checkbox") ? (e.closest("label") || e) : e;
      const r = box.getBoundingClientRect();
      const name = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("placeholder") || (e.labels && e.labels[0]?.innerText) || e.getAttribute("aria-labelledby") || e.title || "").trim();
      const desc = `${e.tagName.toLowerCase()}[${name.slice(0, 30) || "NO NAME"}]`;
      if (!name) res.push(`no accessible name: ${e.outerHTML.slice(0, 80)}`);
      if (r.height < 44 && r.width < 44 && e.type !== "hidden") res.push(`tap target ${Math.round(r.width)}x${Math.round(r.height)}: ${desc}`);
      else if (r.height < 44) res.push(`tap height ${Math.round(r.height)}: ${desc}`);
    });
    if (document.documentElement.scrollWidth > innerWidth + 1) res.push(`horizontal overflow ${document.documentElement.scrollWidth}>${innerWidth}`);
    if (!document.querySelector("h1,h2")) res.push("no heading");
    return res;
  });
  for (const i of issues) findings.push(`${tag} ${screen}: ${i}`);
}

async function run(width, height, scheme, calm = false) {
  const tag = `${width}-${scheme}${calm ? "-calm" : ""}`;
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, reducedMotion: calm ? "reduce" : "no-preference", deviceScaleFactor: 1, locale: "en-US", hasTouch: width < 500 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
  page.on("requestfailed", (r) => errors.push(`${tag}: request failed ${r.url()}`));
  page.on("response", (r) => r.status() >= 400 && errors.push(`${tag}: ${r.status()} ${r.url()}`));
  const settle = () => page.waitForFunction(() => document.querySelectorAll(".sp-page").length === 1);
  const step = async (name, full = true) => {
    await settle();
    await page.waitForTimeout(700);
    await audit(page, tag, name);
    await page.screenshot({ path: path.join(out, `${name}-${tag}.png`), fullPage: full });
  };

  await page.goto(`http://localhost:${PORT}/?mockSpeed=3#/`);
  await page.getByLabel("Your first name").fill("Sverre");
  await step("onboarding-1");
  // refresh mid-onboarding must not crash
  await page.reload();
  await page.getByLabel("Your first name").waitFor();
  await page.getByLabel("Your first name").fill("Sverre");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("heading", { name: "How do you want to follow calls?" }).waitFor();
  await step("onboarding-2");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Ingrid").waitFor();
  await step("onboarding-3");
  await page.getByRole("button", { name: "Start using Spoken" }).click();

  await page.getByRole("heading", { name: "What do you want done?" }).waitFor();
  // empty state: submit with nothing typed must not advance
  const plan = page.getByRole("button", { name: "Plan the call" });
  if (await plan.isEnabled()) {
    await plan.click();
    await page.waitForTimeout(500);
    if (await page.getByRole("heading", { name: "A few quick questions" }).count()) findings.push(`${tag} home: empty task advances to clarify`);
  }
  await page.getByRole("textbox", { name: "What do you want done?" }).fill("Order a large pepperoni from Domino's Storo for 18:00");
  await step("home");
  await plan.click();

  await page.getByRole("heading", { name: "A few quick questions" }).waitFor();
  await page.getByText("Pickup", { exact: true }).click();
  await page.getByText("No, that's all").click();
  await step("clarify");
  await page.getByRole("button", { name: "See the plan" }).click();

  await page.getByRole("heading", { name: "The plan" }).waitFor();
  await step("plan");
  await page.getByRole("button", { name: "OK, call now" }).click();

  await page.locator(".sp-line").first().waitFor();
  await page.waitForTimeout(2000);
  await step("call", false);
  await page.getByRole("alertdialog").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1800);
  await step("approval", false);
  await page.getByRole("button", { name: "JA" }).click();

  await page.getByRole("heading", { name: "Result" }).waitFor({ timeout: 30000 });
  await page.getByText("Full transcript").click();
  await step("result");

  for (const r of ["settings", "privacy"]) {
    await page.goto(`http://localhost:${PORT}/#/${r}`);
    await page.reload(); // refresh on a deep route
    await page.getByRole("heading").first().waitFor();
    await step(r);
  }
  await ctx.close();
  console.log(`ok ${tag}`);
}

let failed = false;
try {
  const only = process.env.ONLY; // e.g. ONLY=1440-light-calm
  const plan = [[390, 844, "dark"], [390, 844, "light"], [1440, 900, "dark"], [1440, 900, "light"], [390, 844, "dark", true], [1440, 900, "light", true]];
  for (const [w, h, s, calm] of plan) if (!only || only === `${w}-${s}${calm ? "-calm" : ""}`) await run(w, h, s, calm);
} catch (e) {
  failed = true;
  console.error("FLOW FAILED:", e.message);
} finally {
  await browser.close();
  server.kill();
}
const uniq = [...new Set(findings)];
writeFileSync(path.join(root, "e2e", "report.txt"), `FINDINGS (${uniq.length})\n${uniq.join("\n")}\n\nCONSOLE/NETWORK ERRORS (${errors.length})\n${errors.join("\n")}\n`);
console.log(`${uniq.length} findings, ${errors.length} errors -> e2e/report.txt`);
process.exit(failed || errors.length ? 1 : 0);
