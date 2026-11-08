// Checks the hand-off from the DOM slide to the canvas raster: pixels at t=-1 vs t=0 must match.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT || "/home/sverre/Projects/bas/node_modules/playwright/index.mjs");
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(join(here, "..", "intro.html")).href);
await page.waitForFunction(() => window.__intro && window.__intro.ready);
const shot = async (t) => { await page.evaluate((t) => window.__intro.seek(t), t); return (await page.screenshot()).toString("base64"); };
const a = await shot(-1), b = await shot(0);
const diff = await page.evaluate(async ([a, b]) => {
  const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
  const [A, B] = await Promise.all([load(a), load(b)]);
  const c = document.createElement("canvas"); c.width = 1920; c.height = 1080; const x = c.getContext("2d");
  x.drawImage(A, 0, 0); const da = x.getImageData(0, 0, 1920, 1080).data;
  x.drawImage(B, 0, 0); const db = x.getImageData(0, 0, 1920, 1080).data;
  let n = 0, big = 0, sx = 0, sxa = 0, sya = 0, syb = 0, cols = {};
  for (let i = 0; i < da.length; i += 4) {
    const d = Math.abs(da[i] - db[i]); if (d > 24) { n++; const p = i / 4, X = p % 1920; cols[Math.floor(X / 100)] = (cols[Math.floor(X / 100)] || 0) + 1; } if (d > 128) big++;
  }
  // ink centroid of each image, to read any offset directly
  let wa = 0, wb = 0, xa = 0, xb = 0, ya = 0, yb = 0;
  for (let i = 0; i < da.length; i += 4) { const p = i / 4, X = p % 1920, Y = (p - X) / 1920; const ia = 255 - da[i], ib = 255 - db[i]; wa += ia; xa += ia * X; ya += ia * Y; wb += ib; xb += ib * X; yb += ib * Y; }
  return { over24: n, over128: big, cols, inkA: wa, inkB: wb, dx: xb / wb - xa / wa, dy: yb / wb - ya / wa };
}, [a, b]);
console.log(JSON.stringify(diff));
await browser.close();
