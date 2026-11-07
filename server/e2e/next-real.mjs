// End-to-end: Sverre's Next.js app (static export in web/out, NEXT_PUBLIC_SPOKEN_API=/) served by
// the Bun call server in mock mode. A "user" types a task in the chat, answers the server's
// questions in the chat, starts the call, watches the live transcript, taps approve, gets a result.
// Build first: (cd ../web && SPOKEN_EXPORT=1 NEXT_PUBLIC_SPOKEN_API=/ npx next build)
// Run from server/:  node e2e/next-real.mjs
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.dirname(here);
// Playwright isn't a dependency of the Next app; any local install works (PLAYWRIGHT_DIR).
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? path.join(serverDir, "e2e"), "package.json"));
const { chromium } = require("playwright");

const PORT = 8796;
const srv = spawn("bun", ["src/index.ts"], {
  cwd: serverDir,
  env: { ...process.env, PORT: String(PORT), CALL_PROVIDER: "mock", LLM_PROVIDER: "mock", MOCK_SPEED: "0.4", CALL_LOG: "0", WEB_DIST: path.join(serverDir, "../web/out") },
  stdio: ["ignore", "pipe", "pipe"],
});
process.on("exit", () => srv.kill());
await new Promise((res, rej) => {
  srv.stdout.on("data", (b) => String(b).includes("listening") && res());
  setTimeout(() => rej(new Error("server did not start")), 10000);
});

const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
const d = dir && readdirSync(dir).find((n) => /^chromium-\d+$/.test(n));
const exe = process.env.CHROME_PATH || (d ? path.join(dir, d, "chrome-linux64", "chrome") : undefined);
const browser = await chromium.launch({ headless: true, executablePath: exe });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
const errors = [];
const api = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (r) => { if (r.url().includes("/api/")) api.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname.replace(/[tc]_[0-9a-f]+/, ":id")}`); if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
const sockets = [];
page.on("websocket", (ws) => sockets.push(new URL(ws.url()).pathname));
const step = (s) => console.log(`- ${s}`);

const home = page.locator("#home");
const composer = home.locator("#pane-chat textarea, textarea").first();

/** Login (demo/demo) if shown, skip the intro if shown, open the Chat tab. */
async function enterApp() {
  for (let i = 0; i < 60; i++) {
    if (await page.locator("#login.on").count()) {
      const login = page.locator("#login.on");
      await login.locator("input").nth(0).fill("demo");
      await login.locator("input").nth(1).fill("demo");
      await login.locator("button[type=submit]").click();
    } else if (await page.locator("#intro.on").count()) {
      await page.locator("#intro.on").click().catch(() => {});
    } else if (await page.locator("#tab-chat").isVisible().catch(() => false)) {
      await page.locator("#tab-chat").click();
      await composer.waitFor();
      return;
    }
    await page.waitForTimeout(300);
  }
  throw new Error("could not get past intro/login to the Chat tab");
}
const botTexts = async () => (await home.locator(".bubble.bot").allInnerTexts()).filter((t) => t.trim());
const stable = async () => { const a = await botTexts(); await page.waitForTimeout(400); const b = await botTexts(); return JSON.stringify(a) === JSON.stringify(b) ? b : null; };

let ok = false;
try {
  await page.goto(`http://localhost:${PORT}/`);
  await enterApp();
  step("app loaded: logged in (demo), Chat tab open");
  await composer.fill("Bestill en stor pepperoni fra Domino's Storo til 18:00");
  await composer.press("Enter");
  step("task sent from the chat");

  // Answer each server question in the chat ("1" = first option) until the plan card shows.
  let answered = 0;
  for (let i = 0; i < 60 && !(await home.locator(".plan").count()); i++) {
    const b = await stable();
    const questions = (b ?? []).filter((t) => t.includes("?"));
    if (b && questions.length > answered) {
      step(`server asks: «${questions.at(-1).split("\n")[0]}»`);
      await composer.fill("1");
      await composer.press("Enter");
      answered++;
    }
    await page.waitForTimeout(250);
  }
  await home.locator(".plan").waitFor({ timeout: 10000 });
  step(`plan card: ${(await home.locator(".plan").innerText()).split("\n").slice(0, 4).join(" | ")}`);
  await home.locator(".plan button.btn.primary").click();

  const call = page.locator("#call");
  await call.locator(".who").first().waitFor({ timeout: 15000 });
  step("live transcript from the server");
  const ask = page.locator(".sheet.open button.btn.primary");
  await ask.first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(3000);
  if (!(await ask.first().isVisible())) throw new Error("approval sheet closed without a human answer");
  step(`approval sheet waits for the human: «${await page.locator("#sheetTitle").innerText()}»`);
  await ask.first().click();
  step("approved");
  await page.locator(".sheet.open [data-back]").waitFor({ timeout: 40000 });
  step(`result: «${await page.locator("#sheetTitle").innerText()}» | ${(await page.locator(".sheet.open").innerText()).split("\n").slice(1, 5).join(" | ")}`);
  const lines = await call.locator(".who").count();
  step(`${lines} transcript lines shown`);
  // The scripted demo stays available as the fallback: D plays the pizza call hands-free.
  await page.goto(`http://localhost:${PORT}/`);
  await enterApp();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("d");
  await page.locator(".sheet.open [data-back]").waitFor({ timeout: 60000 });
  step(`scripted demo (D): «${await page.locator("#sheetTitle").innerText()}»`);
  ok = errors.length === 0;
} catch (e) {
  console.error("E2E FAILED:", e.message);
  await page.screenshot({ path: path.join(here, "failure.png"), fullPage: true }).catch(() => {});
} finally {
  console.log(`api: ${[...new Set(api)].join(", ")}`);
  console.log(`websockets: ${sockets.join(", ")}`);
  if (errors.length) console.log(`errors: ${errors.join("; ")}`);
  await browser.close();
  srv.kill();
}
console.log(ok ? "E2E OK" : "E2E FAILED");
process.exit(ok ? 0 : 1);
