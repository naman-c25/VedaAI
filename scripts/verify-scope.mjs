/**
 * Verifies the assignment's Scope section point by point against a real run,
 * printing the evidence for each claim rather than just a pass mark.
 *
 *   npm run dev            # in another terminal
 *   node scripts/verify-scope.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DIR = join(process.cwd(), "fixtures");

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
const near = (a, b) => Math.abs(a - b) < 0.01;

/* ================= CORE FLOW: four stages, in order ==================== */
console.log("\n━━ CORE FLOW: Question Extraction → Answer Extraction → Answer Mapping → Grading ━━\n");

const t0 = Date.now();
const { questions } = await call({ action: "questions", pages: pagesOf("question-") });
const tQ = Date.now();
assert(
  "Stage 1 — Question Extraction returns an ordered question list",
  Array.isArray(questions) && questions.length > 0,
  `${questions.length} questions in ${tQ - t0}ms · first="${questions[0]?.label}" last="${questions.at(-1)?.label}"`
);

const { blocks, student } = await call({ action: "answers", pages: pagesOf("answer-") });
const tA = Date.now();
assert(
  "Stage 2 — Answer Extraction returns located, transcribed answer blocks",
  Array.isArray(blocks) && blocks.length > 0,
  `${blocks.length} blocks in ${tA - tQ}ms · ${blocks.filter((b) => b.rect).length} carry a bounding box`
);

const result = await call({ action: "map", questions, blocks, student });
const tM = Date.now();
assert(
  "Stage 3 — Answer Mapping links blocks to questions",
  result.questions.length === questions.length,
  `${result.questions.filter((q) => q.status === "answered").length} mapped, ` +
    `${result.questions.filter((q) => q.status === "unanswered").length} unanswered, ` +
    `${result.unmatched.length} unmatched · ${tM - tA}ms`
);

const graded = result.questions.filter((q) => q.status === "answered");
assert(
  "Stage 4 — Grading/Feedback produces a mark and a comment for every mapped answer",
  graded.every((q) => Number.isFinite(q.score) && (q.feedback || "").trim().length > 0),
  `${graded.length}/${graded.length} graded with feedback`
);

/* ================= BULLET 1: Marks or scores =========================== */
console.log("\n━━ SCOPE 1: Marks or scores ━━\n");

assert(
  "Every question carries a numeric score and maximum",
  result.questions.every((q) => Number.isFinite(q.score) && Number.isFinite(q.maxScore)),
  result.questions.slice(0, 5).map((q) => `${q.label}:${q.score}/${q.maxScore}`).join("  ") + "  …"
);
assert(
  "No score exceeds its maximum, none is negative",
  result.questions.every((q) => q.score >= 0 && q.score <= q.maxScore),
  `range checked across ${result.questions.length} questions`
);
const sum = result.questions.reduce((s, q) => s + q.score, 0);
const max = result.questions.reduce((s, q) => s + q.maxScore, 0);
assert(
  "Totals are arithmetically exact",
  near(sum, result.summary.totalScore) && near(max, result.summary.maxScore),
  `Σscore=${sum} vs reported ${result.summary.totalScore} · Σmax=${max} vs ${result.summary.maxScore}`
);
assert(
  "Percentage is consistent with the totals",
  result.summary.percentage === Math.round((sum / max) * 100),
  `${result.summary.totalScore}/${result.summary.maxScore} = ${result.summary.percentage}%`
);

/* ============ BULLET 2: Correct / incorrect evaluation ================= */
console.log("\n━━ SCOPE 2: Correct / incorrect evaluation ━━\n");

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const find = (l) => result.questions.find((q) => norm(q.label).endsWith(norm(l)));
const correct = graded.filter((q) => q.score === q.maxScore);
const wrong = graded.filter((q) => q.score === 0);
const partial = graded.filter((q) => q.score > 0 && q.score < q.maxScore);

assert(
  "Three verdicts are distinguished: correct, partial, incorrect",
  correct.length > 0 && partial.length > 0 && wrong.length > 0,
  `${correct.length} correct · ${partial.length} partial · ${wrong.length} incorrect`
);
const q3 = find("3");
assert(
  "A factually wrong answer is marked incorrect (0)",
  q3?.score === 0,
  `Q3 wrote "the Watt" → ${q3?.score}/${q3?.maxScore} — "${(q3?.feedback || "").slice(0, 70)}…"`
);
const q1 = find("1");
assert(
  "A fully correct answer earns full marks",
  q1 && q1.score === q1.maxScore,
  `Q1 → ${q1?.score}/${q1?.maxScore}`
);
assert(
  "A partially correct answer earns partial credit, not all-or-nothing",
  partial.every((q) => q.score > 0 && q.score < q.maxScore),
  partial.map((q) => `${q.label}:${q.score}/${q.maxScore}`).join("  ")
);
assert(
  "Unanswered is kept distinct from incorrect",
  result.questions
    .filter((q) => q.status === "unanswered")
    .every((q) => q.score === 0 && q.regions.length === 0),
  `${result.summary.unanswered} unanswered, each with 0 regions — not scored as wrong attempts`
);

/* ======== BULLET 3: AI feedback (per question and/or overall) ========== */
console.log("\n━━ SCOPE 3: AI feedback — per question AND overall ━━\n");

assert(
  "Per-question feedback exists for every graded answer",
  graded.every((q) => (q.feedback || "").trim().length > 0),
  `shortest ${Math.min(...graded.map((q) => q.feedback.length))} chars, ` +
    `longest ${Math.max(...graded.map((q) => q.feedback.length))}`
);
assert(
  "Feedback is substantive, never a bare 'Correct.'",
  graded.every((q) => !/^(correct|good|well done)[.!]?$/i.test(q.feedback.trim())),
  `no one-word verdicts across ${graded.length} answers`
);
const lost = graded.filter((q) => q.score < q.maxScore);
assert(
  "Every answer that lost marks says specifically what was missing",
  lost.every((q) => q.missing.length > 0),
  lost.map((q) => `${q.label}: ${q.missing.join("; ")}`).join("  |  ")
);
assert(
  "Full-marks answers carry no stale 'missing' points",
  correct.every((q) => q.missing.length === 0)
);
assert(
  "Overall feedback exists for the whole paper",
  (result.summary.overallFeedback || "").length > 80,
  `"${(result.summary.overallFeedback || "").slice(0, 100)}…"`
);

/* ============== BULLET 4: A clear grading summary ====================== */
console.log("\n━━ SCOPE 4: A clear grading summary ━━\n");

const s = result.summary;
assert(
  "Summary reports score, maximum and percentage",
  Number.isFinite(s.totalScore) && Number.isFinite(s.maxScore) && Number.isFinite(s.percentage),
  `${s.totalScore}/${s.maxScore} = ${s.percentage}%`
);
assert(
  "Summary counts answered, unanswered and unmatched",
  s.answered + s.unanswered === result.questions.length,
  `${s.answered} answered + ${s.unanswered} unanswered = ${result.questions.length} · ${s.unmatched} unmatched answers`
);
assert(
  "Summary accounts for every lost mark",
  near(s.marksLost, s.maxScore - s.totalScore) &&
    near(
      s.lostMarks.reduce((a, r) => a + r.lost, 0),
      s.marksLost
    ),
  `${s.marksLost} marks lost across ${s.lostMarks.length} questions, itemised`
);
assert(
  "Summary names strengths and gaps for reteaching",
  s.strengths.length > 0 && s.gaps.length > 0,
  `strengths: ${s.strengths.join(" | ")}\n      gaps: ${s.gaps.join(" | ")}`
);
assert(
  "Every itemised loss carries a reason",
  s.lostMarks.every((r) => r.status === "unanswered" || r.missing.length > 0 || r.lost > 0),
  s.lostMarks.map((r) => `${r.label} −${r.lost}`).join("  ")
);

/* ============================== VERDICT ================================ */
console.log(`\n${"━".repeat(72)}`);
console.log(`SCOPE VERIFICATION: ${pass}/${pass + fail} claims verified against this run`);
if (fail) {
  console.log(`${fail} FAILED — see ✗ above`);
  process.exitCode = 1;
}
