// Exports key frames at 1920×1080 into pitch/frames/ and fails on any console error.
// Usage: node pitch/tools/capture.mjs  (PLAYWRIGHT=/path/to/node_modules/playwright to override)
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const pw = process.env.PLAYWRIGHT || "/home/sverre/Projects/bas/node_modules/playwright/index.mjs";
const { chromium } = await import(pw);
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(pathToFileURL(join(here, "..", "intro.html")).href);
await page.waitForFunction(() => window.__intro && window.__intro.ready);
const info = await page.evaluate(() => ({ count: window.__intro.count, end: window.__intro.T_END }));
const frames = (process.env.FRAMES || "1-start:-1,2-dissolve:0.7,3-ribbons:1.35,4-drive:2.45,5-tracing:3.9,6-assembled:5.45,7-fill:5.85,8-final:8.5").split(",");
for (const f of frames) {
  const [name, t] = f.split(":");
  await page.evaluate((t) => window.__intro.seek(t), Number(t));
  await page.screenshot({ path: join(here, "..", "frames", `${name}.png`) });
}
// real-time run: reload, press Space, measure frame pacing through the whole sequence
await page.reload();
await page.waitForFunction(() => window.__intro && window.__intro.ready);
await page.evaluate(() => { window.__dts = []; let last = performance.now(); const f = (n) => { window.__dts.push(n - last); last = n; if (window.__dts.length < 400) requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.keyboard.press("Space");
await page.waitForTimeout((info.end + 0.5) * 1000);
const pacing = await page.evaluate(() => { const raw = window.__dts.slice(2); let acc = 0; const slow = []; raw.forEach((d) => { acc += d; if (d > 25) slow.push(+(acc / 1000).toFixed(2)); }); const d = raw.slice().sort((a, b) => a - b); return { thin: window.__intro.quality(), frames: d.length, medianMs: +d[d.length >> 1].toFixed(1), p95Ms: +d[Math.floor(d.length * 0.95)].toFixed(1), slowAtS: slow.slice(0, 30) }; });
await page.keyboard.press("r");
const stats = await page.evaluate(() => window.__intro.stats);
await browser.close();
console.log(JSON.stringify({ pacing, stats, lines: info.count, durationS: +info.end.toFixed(2), errors }));
if (errors.length) process.exit(1);
