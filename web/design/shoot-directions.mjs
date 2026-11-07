// Headless screenshots of the direction mockups: one 390x844 shot per screen/theme,
// plus a contact sheet per direction so the lead can show them side by side.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "directions");
const sets = {
  "a-caption": ["home", "call"],
  "b-lanes": ["home", "call"],
  "c-signal": ["home", "call", "ask"],
};
function nixChrome() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return undefined;
  const d = readdirSync(root).find((n) => /^chromium-\d+$/.test(n));
  return d ? path.join(root, d, "chrome-linux64", "chrome") : undefined;
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || nixChrome() || chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
for (const [name, screens] of Object.entries(sets)) {
  const shots = [];
  for (const theme of ["dark", "light"]) {
    for (const screen of screens) {
      await page.goto(`file://${dir}/${name}.html?screen=${screen}&theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const file = `${name}-${screen}-${theme}.png`;
      await page.screenshot({ path: path.join(dir, file) });
      shots.push(file);
    }
  }
  const cols = screens.length * 2;
  const sheet = await browser.newPage({ viewport: { width: cols * 410 + 30, height: 844 + 100 }, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;background:#1a1a1f;font:15px system-ui;color:#aaa;padding:20px 20px 0;display:flex;gap:20px">
    ${shots.map((s) => `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(path.join(dir, s)).toString("base64")}" width="390" height="844" style="border-radius:18px;display:block"><figcaption style="padding:10px 4px">${s.replace(".png", "")}</figcaption></figure>`).join("")}</body>`);
  await sheet.waitForTimeout(400);
  await sheet.screenshot({ path: path.join(dir, `${name}-sheet.png`) });
  await sheet.close();
}
await browser.close();
