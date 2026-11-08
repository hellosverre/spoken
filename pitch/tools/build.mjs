// Inlines font, logo and app capture into pitch/intro.html (one file, works from file://).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..", "..");
const b64 = (p) => readFileSync(join(root, p)).toString("base64");
const ref = readFileSync(join(here, "..", "reference-title-slide.html"), "utf8");
const logo = ref.match(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/);
if (!logo) throw new Error("logo data URI not found in reference slide");
const html = readFileSync(join(here, "intro.src.html"), "utf8")
  .replace("__INTER__", "data:font/woff2;base64," + b64("site/fonts/inter-var-latin.woff2"))
  .replace("__LOGO__", logo[0])
  .replace("__SHOT__", "data:image/webp;base64," + b64("site/shots/no-light-live.webp"));
if (/__[A-Z]+__/.test(html)) throw new Error("unreplaced placeholder");
writeFileSync(join(here, "..", "intro.html"), html);
console.log("pitch/intro.html", (html.length / 1024).toFixed(0), "KB");
