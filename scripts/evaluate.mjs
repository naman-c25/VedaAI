/**
 * Scores the project against the brief's "What We Evaluate" criteria, using
 * measured accuracy against known ground truth rather than self-assessment.
 *
 * The fixture paper is fully known: 16 questions in a fixed order, and a fixed
 * correct answer→question mapping. That makes extraction and mapping accuracy
 * genuinely measurable instead of a matter of opinion.
 *
 *   npm run dev            # in another terminal
 *   node scripts/evaluate.mjs
 */
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DIR = join(process.cwd(), "fixtures");
const SCALE = 0.5;

const shim = join(DIR, ".refine.mjs");
writeFileSync(shim, readFileSync(join(process.cwd(), "lib", "refine.js")));
const { buildInkMask, refineRect } = await import(`file://${shim.replace(/\\/g, "/")}`);
unlinkSync(shim);

const truth = JSON.parse(readFileSync(join(DIR, "ground-truth.json"), "utf8"));

/* ---------------------------- ground truth ------------------------------- */
// The paper, exactly as printed.
const EXPECTED_QUESTIONS = [
  { label: "1", text: "which blood vessel carries blood away from the heart" },
  { label: "2", text: "name the green pigment found in chloroplasts" },
  { label: "3", text: "state the si unit of electrical resistance" },
  { label: "4", text: "explain the role of chloroplasts in photosynthesis" },
  { label: "5", text: "draw a labelled diagram of an alveolus" },
  { label: "6", text: "describe the flow of blood through the human heart" },
  { label: "7a", text: "calculate the pulmonary ventilation rate per minute" },
  { label: "7b", text: "explain what happens to this rate during vigorous exercise" },
  { label: "8", text: "explain the structural differences between palisade mesophyll" },
  { label: "9a", text: "state which plant is photosynthesising more efficiently" },
  { label: "9b", text: "suggest one practical measure that would help plant b recover" },
  { label: "10i", text: "name the functional unit of the kidney" },
  { label: "10ii", text: "describe how filtration occurs in the bowman" },
  { label: "10iii", text: "state one substance that is reabsorbed in the proximal tubule" },
  { label: "11", text: "define resistance and state ohm" },
  { label: "12", text: "describe two adaptations of a leaf" },
];

// Which answer belongs to which question, keyed by a phrase unique to that answer.
// "—" means the answer correctly belongs to no question on this paper.
const EXPECTED_MAPPING = [
  ["chloroplasts are the site", "4"],
  ["arteries carry blood", "1"],
  ["green pigment is chlorophyll", "2"],
  ["thylakoid", "4"],
  ["plant b into bright sunlight", "9b"],
  ["right atrium", "6"],
  ["glomerulus", "10ii"],
  ["functional unit of the kidney", "10i"],
  ["pulmonary ventilation", "7a"],
  ["no wait", "—"],
  ["resistance is the opposition", "11"],
  ["alveolus is a tiny air sac", "5"],
  ["unit of resistance is the watt", "3"],
  ["newton", "—"],
  ["palisade mesophyll", "8"],
];

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

const pagesOf = (prefix) =>
  readdirSync(DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".jpg"))
    .sort()
    .map((f) => ({ dataUrl: `data:image/jpeg;base64,${readFileSync(join(DIR, f)).toString("base64")}` }));

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

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const iy = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  const inter = ix * iy;
  const union = a.width * a.height + b.width * b.height - inter;
  return union > 0 ? inter / union : 0;
}

const bar = (pct) => "█".repeat(Math.round(pct / 5)).padEnd(20, "░");
const scores = [];
function score(name, earned, total, note) {
  const pct = (earned / total) * 100;
  scores.push({ name, earned, total, pct });
  console.log(`  ${bar(pct)}  ${pct.toFixed(1).padStart(5)}%  ${name}`);
  if (note) console.log(`      ${note}`);
}

/* ------------------------------- run ------------------------------------ */
const { questions } = await call({ action: "questions", pages: pagesOf("question-") });
const { blocks, student } = await call({ action: "answers", pages: pagesOf("answer-") });
const result = await call({ action: "map", questions, blocks, student });

console.log("\n════ MEASURED ACCURACY ════\n");

/* ---- 1. Question extraction accuracy ----------------------------------- */
const gotLabels = questions.map((q) => norm(q.label));
const wantLabels = EXPECTED_QUESTIONS.map((q) => q.label);

let labelHits = 0;
let orderHits = 0;
let textHits = 0;
EXPECTED_QUESTIONS.forEach((want, i) => {
  const idx = gotLabels.indexOf(want.label);
  if (idx !== -1) labelHits++;
  if (gotLabels[i] === want.label) orderHits++;
  if (idx !== -1) {
    // Does the extracted text carry the question's distinguishing words?
    const got = words(questions[idx].text);
    const need = words(want.text);
    const overlap = need.filter((w) => got.includes(w)).length / need.length;
    if (overlap >= 0.8) textHits++;
  }
});
const spurious = gotLabels.filter((l) => !wantLabels.includes(l));

score("Question extraction — every question found", labelHits, EXPECTED_QUESTIONS.length,
  `${labelHits}/${EXPECTED_QUESTIONS.length} present · ${spurious.length} spurious ${spurious.length ? `(${spurious.join(", ")})` : ""}`);
score("Question extraction — printed order preserved", orderHits, EXPECTED_QUESTIONS.length,
  `${orderHits}/${EXPECTED_QUESTIONS.length} in the exact printed position`);
score("Question extraction — wording captured", textHits, EXPECTED_QUESTIONS.length,
  `${textHits}/${EXPECTED_QUESTIONS.length} carry >=80% of the question's distinguishing words`);

/* ---- 2. Answer mapping accuracy ---------------------------------------- */
let mapHits = 0;
const mapMisses = [];
for (const [phrase, wantLabel] of EXPECTED_MAPPING) {
  const owner = result.questions.find((q) =>
    q.regions.some((r) => (r.text || "").toLowerCase().includes(phrase))
  );
  const stray = result.unmatched.find((u) => (u.text || "").toLowerCase().includes(phrase));
  const gotLabel = owner ? norm(owner.label) : stray ? "—" : "(lost)";
  if (gotLabel === wantLabel) mapHits++;
  else mapMisses.push(`"${phrase}" → ${gotLabel}, expected ${wantLabel}`);
}
score("Answer mapping — every answer on the right question", mapHits, EXPECTED_MAPPING.length,
  mapMisses.length ? mapMisses.join(" · ") : `${mapHits}/${EXPECTED_MAPPING.length} correct, including 2 content-only matches and 2 that belong nowhere`);

/* ---- 3. Highlight accuracy --------------------------------------------- */
const masks = [];
for (const f of readdirSync(DIR).filter((f) => f.startsWith("answer-") && f.endsWith(".jpg")).sort()) {
  const img = await loadImage(join(DIR, f));
  const w = Math.round(img.width * SCALE);
  const h = Math.round(img.height * SCALE);
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  masks.push(buildInkMask({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h }));
}
const regions = result.questions.flatMap((q) => q.regions).filter((r) => r.rect);
const ious = regions.map((r) => {
  const refined = refineRect(masks[r.page - 1], r.rect);
  return Math.max(0, ...(truth.pages[r.page - 1]?.blocks || []).map((t) => iou(refined, t.rect)));
});
const meanIou = ious.reduce((a, b) => a + b, 0) / ious.length;
score("Highlighting — region matches the actual writing", Math.round(meanIou * 1000), 1000,
  `mean IoU ${meanIou.toFixed(3)} vs ground-truth glyph bounds · worst ${Math.min(...ious).toFixed(3)} · ${ious.filter((v) => v >= 0.75).length}/${ious.length} above 0.75`);

/* ---- 4. Edge cases ------------------------------------------------------ */
const EDGE = [
  ["sub-parts as separate questions", questions.filter((q) => q.subpart).length === 7],
  ["context-only stems not emitted", !gotLabels.includes("7") && !gotLabels.includes("9") && !gotLabels.includes("10")],
  ["section headings ignored", !questions.some((q) => /^section/i.test(q.text || ""))],
  ["answered out of order", norm(blocks.find((b) => b.label)?.label).replace(/^q/, "") === "4"],
  ["unanswered questions flagged", ["7b", "9a", "10iii", "12"].every((k) => result.questions.find((q) => norm(q.label).endsWith(k))?.status === "unanswered")],
  ["answer to a non-existent question", result.unmatched.some((u) => /newton/i.test(u.text || ""))],
  ["crossed-out rough work excluded", !result.questions.some((q) => q.regions.some((r) => /no wait/i.test(r.text || "")))],
  ["multi-page answer", (result.questions.find((q) => norm(q.label) === "4")?.pages.length ?? 0) >= 2],
  ["unlabelled answer matched by content", (result.questions.find((q) => norm(q.label) === "5")?.status) === "answered"],
  ["mislabelled answer corrected by content", (result.questions.find((q) => norm(q.label) === "11")?.status) === "answered"],
  ["sub-part answered, sibling not", result.questions.find((q) => norm(q.label).endsWith("9b"))?.status === "answered" && result.questions.find((q) => norm(q.label).endsWith("9a"))?.status === "unanswered"],
  ["wrong answer scored zero", result.questions.find((q) => norm(q.label) === "3")?.score === 0],
  ["partial credit given", result.questions.some((q) => q.score > 0 && q.score < q.maxScore)],
  ["name header not treated as an answer", !blocks.some((b) => /name\s*:|roll\s*no/i.test(b.text || ""))],
];
const edgeHits = EDGE.filter(([, ok]) => ok).length;
score("Edge cases handled", edgeHits, EDGE.length,
  EDGE.filter(([, ok]) => !ok).map(([n]) => `MISSED: ${n}`).join(" · ") || `${edgeHits}/${EDGE.length}, including the four the brief names explicitly`);

/* ------------------------------ summary --------------------------------- */
const overall = scores.reduce((a, s) => a + s.pct, 0) / scores.length;
console.log(`\n${"─".repeat(72)}`);
console.log(`  MEASURED AVERAGE: ${overall.toFixed(1)}%`);
console.log(`${"─".repeat(72)}`);
console.log(`
  These are the criteria that can be measured. "Quality of implementation" and
  "Overall product experience" are judged by a human and are not scored here.
`);
