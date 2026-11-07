// Frame strips (6 frames per key moment) from design/recording/strips.json.
import { chromium } from "playwright";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "recording");
const strips = JSON.parse(readFileSync(path.join(dir, "strips.json"), "utf8"));
const nix = (() => {
  const d = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const c = d && readdirSync(d).find((n) => /^chromium-\d+$/.test(n));
  return c ? path.join(d, c, "chrome-linux64", "chrome") : undefined;
})();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || nix || chromium.executablePath() });
const page = await browser.newPage({ viewport: { width: 6 * 250 + 70, height: 600 } });
for (const [name, files] of Object.entries(strips)) {
  const imgs = files
    .map((f) => `<img src="data:image/jpeg;base64,${readFileSync(path.join(dir, "frames", f)).toString("base64")}" style="width:240px;border-radius:12px">`)
    .join("");
  await page.setContent(
    `<body style="margin:0;padding:16px;background:#1b1b1f;font:14px system-ui;color:#999"><p style="margin:0 0 10px">${name}</p><div style="display:flex;gap:10px">${imgs}</div></body>`,
  );
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(dir, `strip-${name}.png`), fullPage: true });
}
await browser.close();
