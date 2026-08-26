/**
 * Merges the three Gemini passes into the view model the UI renders.
 *
 * The model does the semantic work, but we never trust it to be exhaustive:
 * a deterministic label match runs afterwards as a safety net so a question
 * whose number the student clearly wrote can never be reported as unanswered.
 */

/** "Q.11 (b)" -> "11b", "Ans 2." -> "2", "Question 3" -> "3" */
export function normalizeLabel(raw) {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(/\b(?:question|ques|ans(?:wer)?|sol(?:ution)?)\b/g, "")
    .replace(/^q\.?\s*/, "")
    .replace(/[^a-z0-9]/g, "");
}

function defaultMax(q) {
  return Number.isFinite(q.marks) && q.marks > 0 ? q.marks : 5;
}

export function assemble(questions, blocks, mapping, student = {}) {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const resultByQuestion = new Map();
  for (const r of mapping.results || []) {
    if (r && r.questionId) resultByQuestion.set(r.questionId, r);
  }

  // Every block the model already spoke for, so the safety net never double-assigns.
  const claimed = new Set();
  for (const r of mapping.results || []) {
    for (const id of r.blockIds || []) claimed.add(id);
  }

  const questionByNorm = new Map();
  for (const q of questions) {
    const key = normalizeLabel(q.label);
    if (key && !questionByNorm.has(key)) questionByNorm.set(key, q);
  }

  // Safety net: an unclaimed block whose written label matches a question label exactly.
  const rescued = new Map(); // questionId -> [blockId]
  for (const b of blocks) {
    if (claimed.has(b.id) || !b.label) continue;
    const q = questionByNorm.get(normalizeLabel(b.label));
    if (!q) continue;
    if (!rescued.has(q.id)) rescued.set(q.id, []);
    rescued.get(q.id).push(b.id);
    claimed.add(b.id);
  }

  const assembled = questions.map((q) => {
    const r = resultByQuestion.get(q.id);
    const ids = [...(r?.blockIds || []), ...(rescued.get(q.id) || [])];

    const owned = ids
      .map((id) => blockById.get(id))
      .filter(Boolean)
      // Crossed-out working never counts as an answer, whatever the model claimed.
      .filter((b) => !b.isRoughWork)
      .sort((a, b) => a.page - b.page || a.rect.top - b.rect.top);

    const maxScore = Number.isFinite(r?.maxScore) ? r.maxScore : defaultMax(q);
    const answered = owned.length > 0;
    const score = answered && Number.isFinite(r?.score) ? clamp(r.score, 0, maxScore) : 0;

    return {
      ...q,
      status: answered ? "answered" : "unanswered",
      score,
      maxScore,
      feedback:
        r?.feedback ||
        (answered
          ? "Answer located on the sheet, but no feedback was generated for it."
          : "This question was left unanswered, so no marks could be awarded."),
      // The specific points that cost marks — the "why" behind the score.
      // A full-marks answer has nothing missing, so never show stale points.
      missing:
        answered && score < maxScore && Array.isArray(r?.missing)
          ? r.missing.map((m) => String(m).trim()).filter(Boolean)
          : [],
      confidence: r?.confidence || (answered ? "medium" : "high"),
      // Pages this answer touches - drives the multi-page indicator in the UI.
      pages: [...new Set(owned.map((b) => b.page))].sort((a, b) => a - b),
      regions: owned.map((b) => ({
        blockId: b.id,
        page: b.page,
        rect: b.rect,
        isContinuation: b.isContinuation,
        text: b.text,
      })),
    };
  });

  // Anything still unclaimed is an answer that maps to no question on this paper.
  const reasonById = new Map(
    (mapping.unmatchedBlocks || []).map((u) => [u.id, u.reason])
  );
  const unmatched = blocks
    .filter((b) => b.isRoughWork || !claimed.has(b.id))
    .map((b) => ({
      blockId: b.id,
      page: b.page,
      label: b.label,
      text: b.text,
      rect: b.rect,
      reason: b.isRoughWork
        ? "Rough work"
        : reasonById.get(b.id) || "Does not correspond to any question on this paper",
    }));

  return {
    questions: assembled,
    unmatched,
    summary: summarise(assembled, unmatched, {
      student,
      overallFeedback: mapping.overallFeedback || "",
      strengths: mapping.strengths || [],
      gaps: mapping.gaps || [],
    }),
  };
}

/**
 * Derives the grading summary from the current questions. Kept separate from
 * assemble() because the teacher can correct marks in the UI, and the totals
 * have to follow those edits.
 *
 * `narrative` carries the model's prose (overall comment, strengths, gaps)
 * through unchanged — editing a mark changes the arithmetic, not the analysis.
 */
export function summarise(questions, unmatched, narrative = {}) {
  const answered = questions.filter((q) => q.status === "answered");
  const totalScore = questions.reduce((s, q) => s + q.score, 0);
  const maxScore = questions.reduce((s, q) => s + q.maxScore, 0);

  // Every question that lost marks, with the reason — the teacher's "what went wrong" list.
  const lostMarks = questions
    .filter((q) => q.score < q.maxScore)
    .map((q) => ({
      label: q.label,
      lost: round1(q.maxScore - q.score),
      status: q.status,
      missing: q.missing || [],
    }));

  return {
    totalQuestions: questions.length,
    answered: answered.length,
    unanswered: questions.length - answered.length,
    unmatched: unmatched.length,
    totalScore: round1(totalScore),
    maxScore: round1(maxScore),
    percentage: maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0,
    marksLost: round1(maxScore - totalScore),
    lostMarks,
    student: narrative.student || {},
    overallFeedback: narrative.overallFeedback || "",
    strengths: narrative.strengths || [],
    gaps: narrative.gaps || [],
  };
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
