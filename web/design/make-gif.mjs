// Turns the screencast frames from design/record.mjs into a preview GIF and
// frame strips of the key motion moments.  node design/make-gif.mjs
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;
import jpeg from "jpeg-js";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "recording");
const framesDir = path.join(dir, "frames");
const all = readdirSync(framesDir).sort((a, b) => Number(a.match(/(\d+)\.jpg$/)[1]) - Number(b.match(/(\d+)\.jpg$/)[1]));
const byMoment = (m) => all.filter((f) => f.startsWith(m + "-"));
const pick = (list, count) => (list.length <= count ? list : Array.from({ length: count }, (_, i) => list[Math.floor((i * list.length) / count)]));

function load(file, scale) {
  const img = jpeg.decode(readFileSync(path.join(framesDir, file)), { useTArray: true });
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const out = new Uint8Array(w * h * 4);
  // Box-average downscale: smooth enough for type at this size.
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(img.height, Math.floor((y + 1) * sy)); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.min(img.width, Math.floor((x + 1) * sx)); xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  return { w, h, data: out };
}

// The hero sequence: plan → call curtain → live transcript → approval → result.
const sequence = [
  ...pick(byMoment("morph-plan"), 14),
  ...pick(byMoment("morph-call"), 18),
  ...pick(byMoment("call"), 70),
  ...pick(byMoment("approval"), 24),
  ...pick(byMoment("after-approval"), 30),
  ...pick(byMoment("result"), 26),
];
const gif = GIFEncoder();
for (const f of sequence) {
  const { w, h, data } = load(f, 0.6);
  const palette = quantize(data, 64);
  gif.writeFrame(applyPalette(data, palette), w, h, { palette, delay: 70 });
}
gif.finish();
writeFileSync(path.join(dir, "flow-390-dark.gif"), gif.bytes());
console.log("gif frames", sequence.length);

// Frame strips for the moments that matter, as JSON lists for the sheet step.
const strips = {
  "task-morph": pick(byMoment("morph-task"), 6),
  "call-curtain": pick(byMoment("morph-call"), 6),
  "approval-spring": pick(byMoment("approval").slice(0, 60), 6),
  "result-reveal": pick(byMoment("result").slice(0, 80), 6),
  "live-call": pick(byMoment("call").slice(120, 600), 6),
};
writeFileSync(path.join(dir, "strips.json"), JSON.stringify(strips, null, 2));
