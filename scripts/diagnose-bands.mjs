/**
 * Prints the ink bands found on each answer page next to the ground-truth
 * answer blocks, so a count mismatch in the position-recovery fallback can be
 * explained rather than guessed at.
 *
 *   node scripts/diagnose-bands.mjs [page]
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, writeFileSync, unlinkSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.cwd(), "fixtures");
const shim = join(DIR, ".refine.mjs");
writeFileSync(shim, readFileSync(join(process.cwd(), "lib", "refine.js")));
const url = "file://" + shim.split("\\").join("/");
const { buildInkMask, findBands, deriveRects } = await import(url);
unlinkSync(shim);

const truth = JSON.parse(readFileSync(join(DIR, "ground-truth.json"), "utf8"));
const only = process.argv[2] ? Number(process.argv[2]) : null;
const files = readdirSync(DIR)
  .filter((f) => f.startsWith("answer-") && f.endsWith(".jpg"))
  .sort();

for (let i = 0; i < files.length; i++) {
  const page = i + 1;
  if (only && page !== only) continue;

  const img = await loadImage(join(DIR, files[i]));
  const w = Math.round(img.width * 0.5);
  const h = Math.round(img.height * 0.5);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  const mask = buildInkMask({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h });

  const bands = findBands(mask);
  const expected = truth.pages[page - 1].blocks;
  const derived = deriveRects(bands, expected.length);

  console.log(
    `\n=== page ${page}: ${bands.length} bands vs ${expected.length} answers` +
      `  ${derived ? "→ resolved" : "→ NO CONFIDENT MAPPING"} ===`
  );
  console.log("  bands found:");
  bands.forEach((b, n) =>
    console.log(
      `    ${String(n + 1).padStart(2)}  top=${b.top.toFixed(1).padStart(5)}%  ` +
        `h=${b.height.toFixed(1).padStart(4)}%  left=${b.left.toFixed(1).padStart(5)}%  w=${b.width.toFixed(1).padStart(5)}%`
    )
  );
  console.log("  ground truth:");
  expected.forEach((t) =>
    console.log(
      `        ${String(t.label ?? "(unlabelled)").padEnd(12)} top=${t.rect.top.toFixed(1).padStart(5)}%  ` +
        `h=${t.rect.height.toFixed(1).padStart(4)}%${t.isRoughWork ? "   [rough work]" : ""}`
    )
  );
}
