/**
 * Sweeps the band-separation threshold against ground truth.
 *
 * Lines *within* an answer and the space *between* answers are both blank runs;
 * the threshold has to sit between the two. Picking it by eye is how page 3
 * ended up unresolvable, so pick it by measurement instead.
 *
 *   node scripts/tune-gap.mjs
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "fixtures");
const truth = JSON.parse(readFileSync(join(DIR, "ground-truth.json"), "utf8"));
const source = readFileSync(join(process.cwd(), "lib", "refine.js"), "utf8");

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

const files = readdirSync(DIR).filter((f) => f.startsWith("answer-") && f.endsWith(".jpg")).sort();
const masksPromise = (async () => {
  const shim = join(DIR, ".tune-base.mjs");
  writeFileSync(shim, source);
  const { buildInkMask } = await import("file://" + shim.split("\\").join("/"));
  unlinkSync(shim);
  const out = [];
  for (const f of files) {
    const img = await loadImage(join(DIR, f));
    const w = Math.round(img.width * 0.5);
    const h = Math.round(img.height * 0.5);
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    out.push(buildInkMask({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }));
  }
  return out;
})();
const masks = await masksPromise;

console.log("BLOCK_GAP   pages resolved   boxes>=0.75   mean IoU   note");
console.log("─".repeat(70));

let best = null;
for (const gap of [0.014, 0.018, 0.02, 0.022, 0.025, 0.028, 0.03, 0.035, 0.04]) {
  // Rebuild the module with this BLOCK_GAP so findBands uses it.
  const patched = source.replace(
    /const BLOCK_GAP = [0-9.]+;/,
    `const BLOCK_GAP = ${gap};`
  );
  const shim = join(DIR, `.tune-${String(gap).replace(".", "_")}.mjs`);
  writeFileSync(shim, patched);
  const { findBands, deriveRects } = await import("file://" + shim.split("\\").join("/"));
  unlinkSync(shim);

  let resolved = 0;
  let good = 0;
  let total = 0;
  let sum = 0;
  for (let p = 0; p < truth.pages.length; p++) {
    const expected = truth.pages[p].blocks;
    const derived = deriveRects(findBands(masks[p]), expected.length);
    if (!derived) continue;
    resolved++;
    derived.forEach((r, i) => {
      const v = iou(r, expected[i].rect);
      sum += v;
      total++;
      if (v >= 0.75) good++;
    });
  }
  const mean = total ? sum / total : 0;
  const row = {
    gap,
    resolved,
    good,
    total,
    mean,
    score: resolved * 100 + good,
  };
  if (!best || row.score > best.score || (row.score === best.score && row.mean > best.mean)) best = row;
  console.log(
    `  ${String(gap).padEnd(9)}   ${String(resolved + "/" + truth.pages.length).padEnd(14)} ` +
      `${String(good + "/" + total).padEnd(13)} ${mean.toFixed(3).padStart(8)}`
  );
}

console.log("─".repeat(70));
console.log(
  `best: BLOCK_GAP=${best.gap} → ${best.resolved}/${truth.pages.length} pages, ` +
    `${best.good}/${best.total} boxes >=0.75, mean IoU ${best.mean.toFixed(3)}`
);
