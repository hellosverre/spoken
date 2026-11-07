// Records the 390 px dark flow: a webm video, CDP screencast frames for frame
// strips of the key motion moments, and a frame-rate sample during the live call
// with the CPU throttled 4× to approximate a mid-range phone.
//   bun run build && node design/record.mjs
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, "design", "recording");
const framesDir = path.join(out, "frames");
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
const PORT = 4795;
let server;
// Never leave a preview server behind, even when a step throws.
process.on("exit", () => server?.kill());

function nixChrome() {
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!dir) return undefined;
  const d = readdirSync(dir).find((n) => /^chromium-\d+$/.test(n));
  return d ? path.join(dir, d, "chrome-linux64", "chrome") : undefined;
}

server = spawn("node_modules/.bin/vite", ["preview", "--port", String(PORT), "--strictPort"], { cwd: root, stdio: "pipe" });
await new Promise((res, rej) => {
  server.stdout.on("data", (b) => String(b).includes(String(PORT)) && res());
  setTimeout(() => rej(new Error("preview did not start")), 15000);
});

const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || nixChrome() || chromium.executablePath() });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  colorScheme: "dark",
  deviceScaleFactor: 1,
  recordVideo: { dir: out, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);

// Screencast frames, tagged with the moment they belong to.
let moment = "intro";
let n = 0;
cdp.on("Page.screencastFrame", async (f) => {
  writeFileSync(path.join(framesDir, `${moment}-${String(n++).padStart(4, "0")}.jpg`), Buffer.from(f.data, "base64"));
  await cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 });

const settle = () => page.waitForFunction(() => document.querySelectorAll(".sp-page").length === 1);
const pause = (ms) => page.waitForTimeout(ms);

await page.goto(`http://localhost:${PORT}/?mockSpeed=1.4#/`);
await page.getByLabel("Your first name").fill("Sverre");
await pause(600);
await page.getByRole("button", { name: "Next" }).click();
await settle();
await page.getByRole("button", { name: "Next" }).click();
await settle();
await page.getByText("Ingrid").waitFor();
await page.getByRole("button", { name: "Start using Spoken" }).click();
await settle();

moment = "home";
await pause(1200);
await page.getByRole("button", { name: "Order food" }).click();
await page.getByRole("textbox", { name: "What do you want done?" }).fill("Order a large pepperoni from Domino's Storo for 18:00");
await pause(500);
moment = "morph-task";
await page.getByRole("button", { name: "Plan the call" }).click();
await page.getByRole("heading", { name: "A few quick questions" }).waitFor();
await pause(1200);
moment = "clarify";
await page.getByText("Pickup", { exact: true }).click();
await page.getByText("No, that's all").click();
await pause(400);
moment = "morph-plan";
await page.getByRole("button", { name: "See the plan" }).click();
await page.getByRole("heading", { name: "The plan" }).waitFor();
await pause(1500);
moment = "morph-call";
await page.getByRole("button", { name: "OK, call now" }).click();
await pause(1600);

// Frame rate during the busiest part of the call, CPU throttled 4×.
moment = "call";
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
const fps = await page.evaluate(
  () =>
    new Promise((res) => {
      const times = [];
      const start = performance.now();
      const tick = (t) => {
        times.push(t);
        if (t - start < 4000) requestAnimationFrame(tick);
        else {
          const gaps = times.slice(1).map((x, i) => x - times[i]);
          const sorted = [...gaps].sort((a, b) => a - b);
          res({
            avgFps: Math.round(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)),
            p95FrameMs: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10,
            longFrames: gaps.filter((g) => g > 25).length,
            frames: gaps.length,
          });
        }
      };
      requestAnimationFrame(tick);
    }),
);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

await page.getByRole("alertdialog").waitFor({ timeout: 40000 });
moment = "approval";
await pause(1800);
await page.getByRole("button", { name: "JA" }).click();
moment = "after-approval";
await page.getByRole("heading", { name: "Result" }).waitFor({ timeout: 40000 });
moment = "result";
await pause(2200);

await cdp.send("Page.stopScreencast");
await ctx.close();
await browser.close();
server.kill();
writeFileSync(path.join(out, "fps.json"), JSON.stringify({ throttle: "4x CPU", ...fps }, null, 2));
console.log("fps", JSON.stringify(fps), "frames", n);
