/**
 * Snaps model-provided answer boxes onto the actual ink on the page.
 *
 * Gemini's boxes land in the right place but are rarely tight — they overshoot
 * into blank paper, or clip a descender or a final line. Because we already hold
 * the page bitmap in the browser, we can correct them for free: threshold the
 * page into an ink mask, then trim each box to the writing it actually contains.
 *
 * The trim is band-aware. Rows of ink separated by a blank run wider than GAP are
 * treated as separate bands, and only the bands overlapping the model's original
 * box are kept. That lets the search area be padded generously (recovering a
 * clipped line) without swallowing the neighbouring answer below it.
 */

const SCALE = 0.5; // analyse at half resolution — ~0.1% of page height per row
const PAD_Y = 0.018; // widen the vertical search by 1.8% of page height
const PAD_X = 0.02;
const GAP = 0.014; // a blank run this tall separates two answers
const BREATH = 0; // snap to the true ink bounds; padding only cost accuracy

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Builds a binary ink mask from RGBA pixels. The threshold adapts to the scan's
 * contrast, so it works on a crisp render and a washed-out phone photo alike.
 * Returns null when the page holds no usable ink (blank or no contrast).
 */
export function buildInkMask({ data, width, height }) {
  const n = width * height;
  const lum = new Uint8Array(n);
  for (let i = 0, p = 0; p < n; i += 4, p++) {
    lum[p] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
  }

  // Paper level and ink level as percentiles, which are robust to speckle.
  const hist = new Int32Array(256);
  for (let p = 0; p < n; p++) hist[lum[p]]++;
  const paper = percentile(hist, n, 0.85);
  const darkest = percentile(hist, n, 0.01);
  if (paper - darkest < 25) return null; // nothing meaningful to trim to

  const threshold = clamp(paper - 0.45 * (paper - darkest), 30, 235);
  const ink = new Uint8Array(n);
  for (let p = 0; p < n; p++) ink[p] = lum[p] < threshold ? 1 : 0;
  return { ink, width, height };
}

function percentile(hist, total, q) {
  const target = total * q;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen >= target) return v;
  }
  return 255;
}

/**
 * Returns a tightened copy of `rect` (percentages) for the given mask, or the
 * original rect when the page yields nothing to snap to.
 */
export function refineRect(mask, rect) {
  if (!mask) return rect;
  const { ink, width: w, height: h } = mask;

  const oTop = clamp(Math.round((rect.top / 100) * h), 0, h - 1);
  const oBot = clamp(Math.round(((rect.top + rect.height) / 100) * h), oTop + 1, h);
  const oLeft = clamp(Math.round((rect.left / 100) * w), 0, w - 1);
  const oRight = clamp(Math.round(((rect.left + rect.width) / 100) * w), oLeft + 1, w);

  const padY = Math.round(PAD_Y * h);
  const padX = Math.round(PAD_X * w);
  const sTop = Math.max(0, oTop - padY);
  const sBot = Math.min(h, oBot + padY);
  const sLeft = Math.max(0, oLeft - padX);
  const sRight = Math.min(w, oRight + padX);
  const spanX = sRight - sLeft;
  if (spanX <= 0 || sBot - sTop <= 0) return rect;

  // --- rows ---------------------------------------------------------------
  const minRowInk = Math.max(2, Math.round(0.004 * spanX));
  const rows = sBot - sTop;
  const rowInk = new Int32Array(rows);
  for (let y = 0; y < rows; y++) {
    const base = (sTop + y) * w;
    let c = 0;
    for (let x = sLeft; x < sRight; x++) c += ink[base + x];
    rowInk[y] = c;
  }

  const gapRows = Math.max(2, Math.round(GAP * h));
  const bands = [];
  let start = -1;
  let blank = 0;
  for (let y = 0; y < rows; y++) {
    if (rowInk[y] >= minRowInk) {
      if (start === -1) start = y;
      blank = 0;
    } else if (start !== -1) {
      blank++;
      if (blank >= gapRows) {
        bands.push([start, y - blank]);
        start = -1;
        blank = 0;
      }
    }
  }
  if (start !== -1) bands.push([start, rows - 1 - blank]);
  if (bands.length === 0) return rect;

  // Keep only bands the model's own box actually touches.
  const tol = Math.round(0.01 * h);
  const oTopRel = oTop - sTop;
  const oBotRel = oBot - sTop;
  const kept = bands.filter(([a, b]) => b >= oTopRel - tol && a <= oBotRel + tol);
  if (kept.length === 0) return rect;

  const top = sTop + Math.min(...kept.map((b) => b[0]));
  const bottom = sTop + Math.max(...kept.map((b) => b[1])) + 1;

  // --- columns ------------------------------------------------------------
  const colInk = new Int32Array(spanX);
  for (let y = top; y < bottom; y++) {
    const base = y * w;
    for (let x = 0; x < spanX; x++) colInk[x] += ink[base + sLeft + x];
  }
  let left = -1;
  let right = -1;
  for (let x = 0; x < spanX; x++) if (colInk[x] > 0) { left = x; break; }
  for (let x = spanX - 1; x >= 0; x--) if (colInk[x] > 0) { right = x; break; }
  if (left === -1 || right < left) return rect;
  left += sLeft;
  right += sLeft + 1;

  // --- back to percentages -------------------------------------------------
  // BREATH stays 0: measured against ground truth, any padding here cost
  // accuracy. Visual breathing room is added in the overlay as a fixed pixel
  // outset instead, so it never distorts the geometry.
  const bY = BREATH * h;
  const bX = BREATH * w;
  const pctTop = clamp(((top - bY) / h) * 100, 0, 100);
  const pctLeft = clamp(((left - bX) / w) * 100, 0, 100);
  const pctBottom = clamp(((bottom + bY) / h) * 100, 0, 100);
  const pctRight = clamp(((right + bX) / w) * 100, 0, 100);

  return {
    top: pctTop,
    left: pctLeft,
    height: Math.max(0.4, pctBottom - pctTop),
    width: Math.max(0.4, pctRight - pctLeft),
  };
}

/* ------------------------------------------------------------------ */
/* Browser glue                                                        */
/* ------------------------------------------------------------------ */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read a page image"));
    img.src = src;
  });
}

async function maskForPage(dataUrl) {
  const img = await loadImage(dataUrl);
  const w = Math.max(1, Math.round(img.naturalWidth * SCALE));
  const h = Math.max(1, Math.round(img.naturalHeight * SCALE));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return buildInkMask(ctx.getImageData(0, 0, w, h));
}

/**
 * Refines every region in the assembled result against the answer-sheet pages.
 * Any failure leaves the original boxes untouched — a loose highlight is far
 * better than no highlight.
 */
export async function refineResult(pages, result) {
  let masks;
  try {
    masks = await Promise.all(pages.map((p) => maskForPage(p.dataUrl)));
  } catch {
    return result;
  }

  const fix = (page, rect) => {
    const mask = masks[page - 1];
    try {
      return refineRect(mask, rect);
    } catch {
      return rect;
    }
  };

  return {
    ...result,
    questions: result.questions.map((q) => ({
      ...q,
      regions: q.regions.map((r) => ({ ...r, rect: fix(r.page, r.rect) })),
    })),
    unmatched: result.unmatched.map((u) => ({ ...u, rect: fix(u.page, u.rect) })),
  };
}
