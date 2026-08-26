/**
 * Measures highlight accuracy against ground truth.
 *
 * fixtures/ground-truth.json holds the exact glyph bounds of every answer block,
 * recorded by the generator as it drew them. This compares the model's raw boxes
 * and the pixel-refined boxes against that truth, using IoU (intersection over
 * union — 1.0 is a perfect box, 0 is no overlap).
 *
 *   npm run dev            # in another terminal
 *   node scripts/test-boxes.mjs
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DIR = join(process.cwd(), "fixtures");
const SCALE = 0.5;

// lib/refine.js is ESM inside a CJS package, so hand Node a .mjs copy to import.
const shim = join(DIR, ".refine.mjs");
writeFileSync(shim, readFileSync(join(process.cwd(), "lib", "refine.js")));
const { buildInkMask, refineRect, findBands, deriveRects } = await import(`file://${shim.replace(/\\/g, "/")}`);
unlinkSync(shim);

const truth = JSON.parse(readFileSync(join(DIR, "ground-truth.json"), "utf8"));
const pageFiles = truth.pages.map((_, i) => `answer-p${i + 1}.jpg`);

function iou(a, b) {
  const ix = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)
  );
  const iy = Math.max(
    0,
    Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top)
  );
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/* ---------------------------- model boxes ---------------------------- */
const pages = pageFiles.map((f) => ({
  dataUrl: `data:image/jpeg;base64,${readFileSync(join(DIR, f)).toString("base64")}`,
}));

// Cache the model's boxes so the geometry can be tuned without re-billing the
// API on every run. Pass --refresh to force a new extraction.
const cachePath = join(DIR, "model-blocks.json");
let blocks;
if (!process.argv.includes("--refresh") && existsSync(cachePath)) {
  blocks = JSON.parse(readFileSync(cachePath, "utf8"));
  console.log(`using cached model boxes (${blocks.length}) — pass --refresh to re-extract`);
} else {
  const res = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "answers", pages }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  blocks = body.blocks;
  writeFileSync(cachePath, JSON.stringify(blocks, null, 2));
  console.log(`extracted ${blocks.length} blocks from the model and cached them`);
}

/* ------------------------------ masks -------------------------------- */
const masks = [];
for (const f of pageFiles) {
  const img = await loadImage(join(DIR, f));
  const w = Math.round(img.width * SCALE);
  const h = Math.round(img.height * SCALE);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  masks.push(buildInkMask({ data, width: w, height: h }));
}
console.log(`ink masks built for ${masks.length} pages (${masks.filter(Boolean).length} usable)\n`);

/* ----------------------------- compare ------------------------------- */
console.log("block                    raw IoU   refined   change");
console.log("-".repeat(56));

let rawSum = 0;
let refSum = 0;
let improved = 0;
let worsened = 0;
const rows = [];

for (const b of blocks) {
  const candidates = truth.pages[b.page - 1]?.blocks || [];
  if (candidates.length === 0) continue;

  let best = null;
  let bestIou = -1;
  for (const t of candidates) {
    const v = iou(b.rect, t.rect);
    if (v > bestIou) {
      bestIou = v;
      best = t;
    }
  }
  if (!best) continue;

  const refinedRect = refineRect(masks[b.page - 1], b.rect);
  const refinedIou = iou(refinedRect, best.rect);

  rawSum += bestIou;
  refSum += refinedIou;
  if (refinedIou > bestIou + 0.005) improved++;
  else if (refinedIou < bestIou - 0.005) worsened++;

  const delta = refinedIou - bestIou;
  rows.push({ label: b.label, page: b.page, bestIou, refinedIou, delta });
  console.log(
    `p${b.page} ${String(b.label ?? "(unlabelled)").padEnd(20)} ` +
      `${bestIou.toFixed(3)}     ${refinedIou.toFixed(3)}     ` +
      `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`
  );
}

const n = rows.length;
const rawMean = rawSum / n;
const refMean = refSum / n;
const worstRaw = Math.min(...rows.map((r) => r.bestIou));
const worstRef = Math.min(...rows.map((r) => r.refinedIou));

console.log("-".repeat(56));
console.log(`blocks compared : ${n}`);
console.log(`mean IoU        : ${rawMean.toFixed(3)}  ->  ${refMean.toFixed(3)}`);
console.log(`worst IoU       : ${worstRaw.toFixed(3)}  ->  ${worstRef.toFixed(3)}`);
console.log(`improved        : ${improved}`);
console.log(`worsened        : ${worsened}`);
console.log(`>=0.75 IoU      : ${rows.filter((r) => r.bestIou >= 0.75).length} -> ${rows.filter((r) => r.refinedIou >= 0.75).length}`);

const ok = refMean > rawMean && worsened === 0;
console.log(`\n${ok ? "PASS" : "REVIEW"}  refinement ${ok ? "improves every box" : "needs a look"}`);
if (!ok) process.exitCode = 1;

/* ==================================================================== */
/* Fallback: deriving positions from ink when the model omits box_2d     */
/* ==================================================================== */
console.log("\n=== INK-BAND FALLBACK (no API) ===");

let derivedOk = 0;
let derivedTotal = 0;
let pagesResolved = 0;

for (let p = 0; p < truth.pages.length; p++) {
  const expected = truth.pages[p].blocks;
  const bands = findBands(masks[p]);
  const derived = deriveRects(bands, expected.length);

  if (!derived) {
    console.log(
      `  page ${p + 1}: ${bands.length} ink bands vs ${expected.length} answers — no confident mapping`
    );
    continue;
  }

  pagesResolved++;
  const ious = derived.map((rect, i) => iou(rect, expected[i].rect));
  const mean = ious.reduce((a, b) => a + b, 0) / ious.length;
  derivedTotal += ious.length;
  derivedOk += ious.filter((v) => v >= 0.5).length;
  console.log(
    `  page ${p + 1}: ${expected.length} answers matched, mean IoU ${mean.toFixed(3)} ` +
      `(${ious.map((v) => v.toFixed(2)).join(", ")})`
  );
}

console.log(
  `\n  pages resolved : ${pagesResolved}/${truth.pages.length}` +
    `\n  boxes >=0.5 IoU: ${derivedOk}/${derivedTotal}`
);
// Every page must resolve: one that does not means every answer on it loses its
// position, which is how 7(a), 10(i) and 10(ii) — all on page 3 — went missing.
const fallbackOk = pagesResolved === truth.pages.length && derivedOk === derivedTotal;
console.log(
  fallbackOk
    ? "PASS  ink-band fallback recovers usable positions"
    : "REVIEW  ink-band fallback needs a look"
);
if (!fallbackOk) process.exitCode = 1;
