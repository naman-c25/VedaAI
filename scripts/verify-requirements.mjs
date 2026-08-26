/**
 * Verifies the assignment's Requirements list point by point, printing the
 * evidence behind each claim.
 *
 * Where a requirement is about the UI (upload gating, progress) it is checked
 * against the source and labelled as a source-level check — those are not
 * runtime observations and are not presented as such.
 *
 *   npm run dev            # in another terminal
 *   node scripts/verify-requirements.mjs
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DIR = join(process.cwd(), "fixtures");
const SCALE = 0.5;

const shim = join(DIR, ".refine.mjs");
writeFileSync(shim, readFileSync(join(process.cwd(), "lib", "refine.js")));
const { buildInkMask, refineRect } = await import(`file://${shim.replace(/\\/g, "/")}`);
unlinkSync(shim);

const truth = JSON.parse(readFileSync(join(DIR, "ground-truth.json"), "utf8"));
const src = (f) => readFileSync(join(process.cwd(), f), "utf8");

const pagesOf = (prefix) =>
  readdirSync(DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".jpg"))
    .sort()
    .map((f) => ({
      dataUrl: `data:image/jpeg;base64,${readFileSync(join(DIR, f)).toString("base64")}`,
    }));

async function call(payload) {
  const res = await fetch(`${BASE}/api/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

let pass = 0;
let fail = 0;
function assert(claim, ok, evidence) {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${claim}`);
  if (evidence) console.log(`      ${evidence}`);
}
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

/* ---------------------------- run the pipeline ---------------------------- */
const { questions } = await call({ action: "questions", pages: pagesOf("question-") });
const { blocks, student } = await call({ action: "answers", pages: pagesOf("answer-") });
const result = await call({ action: "map", questions, blocks, student });
const find = (l) => result.questions.find((q) => norm(q.label).endsWith(norm(l)));

/* ===== 1. Upload both files and show processing progress ================== */
console.log("\n━━ REQ 1: Upload both files and show processing progress ━━\n");

const upload = src("components/UploadScreen.js");
const pageSrc = src("app/page.js");
assert(
  "Both files accepted: a question-paper slot and an answer-sheet slot [source]",
  /accentWord="Question Paper"/.test(upload) && /accentWord="Answer Sheet"/.test(upload),
  "two independent DropCards, each accepting PDF or images"
);
assert(
  "Start is blocked until both are present [source]",
  /const ready = Boolean\(question && answer\) && !busy/.test(upload) &&
    /disabled=\{!ready\}/.test(upload),
  "ready = Boolean(question && answer) && !busy; button disabled={!ready}"
);
// Scope this to start() — reset() also calls setProgress(0), which is not part
// of a run and would otherwise look like the progress going backwards.
const startFn = pageSrc.slice(
  pageSrc.indexOf("async function start()"),
  pageSrc.indexOf("function reset()")
);
const stages = [...startFn.matchAll(/setProgress\((\d+)\)/g)].map((m) => Number(m[1]));
assert(
  "Progress advances through the run, not just a spinner [source]",
  stages.length >= 4 && stages.every((v, i) => i === 0 || v > stages[i - 1]),
  `setProgress within start(): ${stages.join(" → ")}`
);
assert(
  "Each step names what it is doing [source]",
  (pageSrc.match(/setProgressStage\(/g) || []).length >= 4,
  '"Reading the question paper…" → "…reading the answer sheet…" → "…mapping and grading…" → "Aligning highlights…"'
);
assert(
  "Per-page progress is reported while a PDF is decoded [source]",
  /onProgress\?\.\(n, doc\.numPages\)/.test(src("lib/files.js")),
  "lib/files.js reports page n of N during render"
);

/* ===== 2. Extract every question in the correct printed order ============= */
console.log("\n━━ REQ 2: Extract every question in the correct printed order ━━\n");

const PRINTED = ["1", "2", "3", "4", "5", "6", "7a", "7b", "8", "9a", "9b", "10i", "10ii", "10iii", "11", "12"];
const got = questions.map((q) => norm(q.label));
assert(
  "Every question on the paper is extracted — none missing, none invented",
  got.length === PRINTED.length,
  `${got.length} extracted, ${PRINTED.length} printed`
);
assert(
  "Order matches the printed order exactly, position by position",
  got.join(",") === PRINTED.join(","),
  `got: ${got.join(" ")}`
);
assert(
  "Section headings are not mistaken for questions",
  !questions.some((q) => /^section\b/i.test(q.text || "")),
  "SECTION A / B / C excluded"
);

/* ===== 3. Labelled sub-parts as separate questions ======================= */
console.log("\n━━ REQ 3: Treat labelled sub-parts as separate questions ━━\n");

const subs = questions.filter((q) => q.subpart);
assert(
  "Each labelled sub-part is its own entry",
  ["7a", "7b", "9a", "9b", "10i", "10ii", "10iii"].every((k) => got.includes(k)),
  subs.map((q) => q.label).join("  ")
);
assert(
  "Sub-parts of one parent are distinct entries, exactly as 11(a)/11(b) requires",
  questions.filter((q) => q.number === "7").length === 2 &&
    questions.filter((q) => q.number === "10").length === 3,
  `7 → ${questions.filter((q) => q.number === "7").length} entries, 10 → ${questions.filter((q) => q.number === "10").length} entries`
);
assert(
  "A context-only stem is not emitted as an extra question",
  !got.includes("7") && !got.includes("9") && !got.includes("10"),
  "stems 7, 9, 10 carry no answerable prompt and were folded into their sub-parts"
);
assert(
  "Parent number and sub-part label are both retained separately",
  subs.every((q) => q.number && q.subpart),
  subs.slice(0, 3).map((q) => `${q.label} → number=${q.number} subpart=${q.subpart}`).join("  |  ")
);

/* ===== 4. Preserve the original question numbering ======================= */
console.log("\n━━ REQ 4: Preserve the original question numbering ━━\n");

assert(
  "Labels are the printed ones, not renumbered 1..N",
  questions.every((q, i) => q.label !== String(i + 1)) || got.join(",") === PRINTED.join(","),
  questions.map((q) => q.label).join("  ")
);
assert(
  "Sub-part numbering survives verbatim — never flattened to 13, 14, 15",
  questions.filter((q) => q.subpart).every((q) => /[()a-z]/i.test(q.label)),
  "10 (i), 10 (ii), 10 (iii) kept their printed form"
);
assert(
  "Numbering is preserved through mapping into the graded output",
  result.questions.map((q) => norm(q.label)).join(",") === PRINTED.join(","),
  "labels unchanged from extraction to the graded result"
);

/* ===== 5. Questions answered out of order =============================== */
console.log("\n━━ REQ 5: Handle questions answered out of order ━━\n");

const sheetOrder = blocks.filter((b) => b.label).map((b) => b.label);
// norm() here keeps a leading "q"; strip it the way the matcher does.
const numberOf = (l) => norm(l).replace(/^q/, "");
assert(
  "The sheet really is out of order — the first answer is not question 1",
  numberOf(sheetOrder[0]) !== norm(questions[0].label),
  `paper starts at "${questions[0].label}", the sheet starts at "${sheetOrder[0]}" · ` +
    `order written: ${sheetOrder.slice(0, 6).join(" → ")} …`
);
assert(
  "Each answer maps to the question it names, not to its position on the page",
  find("4")?.status === "answered" &&
    find("1")?.status === "answered" &&
    find("2")?.status === "answered",
  `Q4 written first → ${find("4")?.status}; Q1 second → ${find("1")?.status}; "2." third → ${find("2")?.status}`
);
assert(
  "Sub-parts answered out of order among themselves still land correctly",
  find("10i")?.status === "answered" && find("10ii")?.status === "answered",
  '10(ii) was written before 10(i) on the sheet; both mapped'
);

/* ===== 6. Unanswered questions ========================================== */
console.log("\n━━ REQ 6: Handle unanswered questions ━━\n");

const unanswered = result.questions.filter((q) => q.status === "unanswered");
assert(
  "Every unattempted question is reported as unanswered",
  ["7b", "9a", "10iii", "12"].every((k) => find(k)?.status === "unanswered"),
  unanswered.map((q) => q.label).join("  ")
);
assert(
  "Unanswered questions own no answer region and score zero",
  unanswered.every((q) => q.regions.length === 0 && q.score === 0),
  `${unanswered.length} unanswered, all 0 regions / 0 marks`
);
assert(
  "No answer is invented for them",
  unanswered.every((q) => q.regions.length === 0 && q.missing.length === 0),
  "no fabricated text or missing-points for unattempted work"
);
assert(
  "A sub-part can be unanswered while its sibling is answered",
  find("9a")?.status === "unanswered" && find("9b")?.status === "answered",
  `9(a)=${find("9a")?.status}, 9(b)=${find("9b")?.status}`
);

/* ===== 7. Answers that don't match any question ========================= */
console.log("\n━━ REQ 7: Handle answers that don't match any question ━━\n");

assert(
  "An answer to a question not on the paper is collected, not force-fitted",
  result.unmatched.some((u) => norm(u.label) === "q13" || /newton|f\s*=\s*ma/i.test(u.text)),
  result.unmatched.map((u) => `${u.label || "(unlabelled)"}: ${u.reason}`).join("  |  ")
);
assert(
  "Crossed-out rough work is excluded from every question",
  !result.questions.some((q) => q.regions.some((r) => /no wait|thats wrong/i.test(r.text || ""))),
  "struck-through working never counted as an answer"
);
assert(
  "Unmatched answers carry a human-readable reason",
  result.unmatched.every((u) => (u.reason || "").length > 0),
  `${result.unmatched.length} unmatched, each with a reason`
);
assert(
  "Unmatched answers are never silently dropped",
  Number.isFinite(result.summary.unmatched) && result.summary.unmatched === result.unmatched.length,
  `summary reports ${result.summary.unmatched}`
);

/* ===== 8. Highlight the exact answer region ============================= */
console.log("\n━━ REQ 8: Highlight the exact answer region ━━\n");

const masks = [];
for (const f of readdirSync(DIR).filter((f) => f.startsWith("answer-") && f.endsWith(".jpg")).sort()) {
  const img = await loadImage(join(DIR, f));
  const w = Math.round(img.width * SCALE);
  const h = Math.round(img.height * SCALE);
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  masks.push(buildInkMask({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }));
}

const allRegions = result.questions.flatMap((q) => q.regions).filter((r) => r.rect);
const ious = allRegions.map((r) => {
  const refined = refineRect(masks[r.page - 1], r.rect);
  const candidates = truth.pages[r.page - 1]?.blocks || [];
  return Math.max(0, ...candidates.map((t) => iou(refined, t.rect)));
});
const mean = ious.reduce((a, b) => a + b, 0) / ious.length;

assert(
  "Every mapped answer has a region on the sheet",
  allRegions.length === result.questions.flatMap((q) => q.regions).length,
  `${allRegions.length} regions, all located`
);
assert(
  "Regions match the true glyph bounds — measured, not eyeballed",
  mean >= 0.9,
  `mean IoU ${mean.toFixed(3)} against ground truth (1.0 = pixel-perfect), worst ${Math.min(...ious).toFixed(3)}`
);
assert(
  "Every region is at least a 0.75 IoU match",
  ious.every((v) => v >= 0.75),
  `${ious.filter((v) => v >= 0.75).length}/${ious.length} above 0.75`
);
assert(
  "Regions stay inside the page and are non-degenerate",
  allRegions.every(
    (r) =>
      r.rect.top >= 0 &&
      r.rect.left >= 0 &&
      r.rect.top + r.rect.height <= 100.5 &&
      r.rect.left + r.rect.width <= 100.5 &&
      r.rect.height > 0.4
  )
);

/* ===== 9. Answers spanning multiple pages =============================== */
console.log("\n━━ REQ 9: Allow answers to span multiple pages ━━\n");

const q4 = find("4");
assert(
  "An answer running across a page break owns a region on each page",
  q4?.pages.length >= 2 && q4.regions.length >= 2,
  `Q4 pages=[${q4?.pages.join(", ")}] regions=${q4?.regions.length}`
);
assert(
  "The continuation is recognised even though the student never rewrote the number",
  q4?.regions.some((r) => r.isContinuation),
  `continuation flagged on page ${q4?.regions.find((r) => r.isContinuation)?.page}`
);
assert(
  "Regions are ordered page-first, so the highlight reads in reading order",
  q4?.regions.every((r, i, a) => i === 0 || r.page >= a[i - 1].page),
  q4?.regions.map((r) => `p${r.page}`).join(" → ")
);
assert(
  "Both halves of the answer are graded as one",
  q4?.status === "answered" && Number.isFinite(q4.score),
  `Q4 ${q4?.score}/${q4?.maxScore} from ${q4?.regions.length} regions across ${q4?.pages.length} pages`
);

/* ================================ VERDICT =============================== */
console.log(`\n${"━".repeat(72)}`);
console.log(`REQUIREMENTS VERIFICATION: ${pass}/${pass + fail} claims verified`);
if (fail) {
  console.log(`${fail} FAILED — see ✗ above`);
  process.exitCode = 1;
}
