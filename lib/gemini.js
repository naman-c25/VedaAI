import { GoogleGenAI } from "@google/genai";

/**
 * Free-tier quota is metered per project *per model* — on this project
 * gemini-2.5-flash allows only 20 generate_content calls a day, and a full run
 * costs three. So when the primary model is exhausted we fall through to the
 * next one, which draws on its own separate quota. Order is best-accuracy-first;
 * the later entries are lighter models kept as a safety net rather than a peer.
 */
const MODELS = [
  "gemini-2.5-flash", // primary — the accuracy figures in the README are from this
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
];
// gemini-flash-latest is deliberately absent: it returned 503 "high demand" on
// every probe, so it only ever added a slow hop before the real fallback.

function client() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (local) or your Vercel project settings (deployed)."
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** Gemini sometimes wraps JSON in code fences despite responseMimeType. Be forgiving. */
function parseJson(raw) {
  if (!raw) throw new Error("Empty response from Gemini");
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  try {
    return JSON.parse(text);
  } catch {
    // Last resort: grab the outermost JSON object in the string.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("Could not parse JSON from model response");
  }
}

function imagePart(dataUrl) {
  const [meta, data] = dataUrl.split(",");
  const mimeType = /data:([^;]+)/.exec(meta)?.[1] || "image/jpeg";
  return { inlineData: { mimeType, data } };
}

/**
 * True for errors where trying a different model is worth doing: the model is
 * out of quota (429), unknown to this key (404), or temporarily overloaded
 * (503). Anything else is a real fault and should surface immediately.
 */
function shouldFallThrough(error) {
  const message = String(error?.message || "");
  const status = error?.status ?? error?.code;
  return (
    status === 429 ||
    status === 404 ||
    status === 503 ||
    /RESOURCE_EXHAUSTED|NOT_FOUND|UNAVAILABLE|quota|rate limit|high demand|overloaded/i.test(
      message
    )
  );
}

/** Pulls the human-useful bits out of a Gemini quota error. */
export function describeQuotaError(error) {
  try {
    const parsed = JSON.parse(error.message);
    const violation = parsed.error?.details?.find((d) => d.violations)?.violations?.[0];
    const perDay = /PerDay/i.test(violation?.quotaId || "");
    return {
      limit: violation?.quotaValue,
      model: violation?.quotaDimensions?.model,
      perDay,
    };
  } catch {
    return null;
  }
}

/**
 * `validate` returns a problem string when a parsed response is structurally
 * unusable — e.g. answer blocks that came back without bounding boxes. That is
 * not an API error, so nothing would otherwise catch it, and the UI would show
 * a confident empty result. Treating it as a failure buys a retry instead.
 *
 * Each model gets two attempts: output completeness varies run to run even at
 * temperature 0, and simply asking again usually fixes it.
 */
async function generate({ parts, instruction, maxOutputTokens = 32768, validate }) {
  const ai = client();
  let lastError;
  // A response that parsed but failed validation. If every model ends up here we
  // hand it back rather than failing outright — a graded paper without highlights
  // is far more use to a teacher than a 500.
  let bestEffort = null;

  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: instruction,
            responseMimeType: "application/json",
            temperature: 0,
            maxOutputTokens,
          },
        });
        const finish = res.candidates?.[0]?.finishReason;
        const thoughts = res.usageMetadata?.thoughtsTokenCount ?? 0;
        console.log(
          `[gemini] ${model} try${attempt} finish=${finish} textLen=${(res.text || "").length}` +
            ` out=${res.usageMetadata?.candidatesTokenCount ?? "?"} thoughts=${thoughts}`
        );
        if (!res.text) {
          // An empty body with MAX_TOKENS means thinking ate the whole budget.
          throw new Error(`${model} returned no text (finishReason=${finish})`);
        }

        const parsed = parseJson(res.text);
        const problem = validate?.(parsed);
        if (problem) {
          bestEffort ??= parsed;
          throw new Error(`${model} try${attempt}: ${problem}`);
        }
        return parsed;
      } catch (error) {
        lastError = error;
        // Quota, missing model or overload: no point retrying this model at all.
        if (shouldFallThrough(error)) break;
        if (attempt === 3) {
          console.warn(`[gemini] ${model} failed 3 times, moving on — ${error.message}`);
          break;
        }
      }
    }
  }

  if (bestEffort) {
    console.warn("[gemini] every model failed validation — returning a degraded result");
    bestEffort.__degraded = true;
    return bestEffort;
  }
  throw lastError;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, n));
}

/**
 * Models disagree about how to wrap a list. gemini-2.5-flash honours the asked-for
 * {"questions": [...]} envelope; gemini-3.1-flash-lite returns a bare array with
 * the same items. Accept either, so a fallback model's output isn't silently
 * read as "nothing found".
 *
 * `guess` allows a last-resort "first array-valued property" match. It is off for
 * responses that legitimately carry several arrays, where guessing could pick
 * the wrong one.
 */
function pickArray(out, key, { guess = true } = {}) {
  if (Array.isArray(out)) return out;
  if (Array.isArray(out?.[key])) return out[key];
  if (!guess) return [];
  return Object.values(out || {}).find(Array.isArray) || [];
}

/* ------------------------------------------------------------------ */
/* 1. Question extraction                                              */
/* ------------------------------------------------------------------ */

const QUESTION_INSTRUCTION = `You extract questions from a scanned or printed exam question paper.

RULES - follow exactly:
1. Return EVERY question, in the exact order it is printed. Never reorder, never merge, never skip.
2. A labelled sub-part is its own separate question. "11 (a)" and "11 (b)" are TWO entries, never one.
   The same applies to (i)/(ii), A./B., etc. when they carry their own answerable prompt.
3. Preserve the printed numbering verbatim in "label" - if the paper prints "Q.11 (b)", label is "Q.11 (b)".
   Also split it: "number" is the parent number ("11"), "subpart" is the sub-label ("b") or null.
4. If a parent number only introduces shared context (a passage, a diagram, "Answer the following")
   and has no answerable prompt of its own, do NOT emit the parent - emit only its sub-parts.
   Put the shared context in "context" on each sub-part so the question is self-contained.
5. "marks" = the number printed in brackets for THAT question, usually at the right-hand
   margin on the question's first line (e.g. "[2]", "(5 marks)"). Read it off the page.
   Never infer marks from how long, hard or important the question looks, and never copy a
   neighbouring question's number. If no marks are printed for that question, "marks" MUST be null.
   Most papers print marks against every question, but some leave one out - do not assume a
   question has marks just because the ones around it do. Look at the right-hand margin on that
   question's own lines; if there is no bracketed number there, output null.
6. Ignore page headers, footers, general instructions, section titles, time and total-marks banners.
7. "text" is the question wording only - no numbering prefix, no marks suffix.

Return JSON exactly:
{"questions":[{"label":"11 (b)","number":"11","subpart":"b","text":"...","context":null,"marks":3,"page":1}]}`;

export async function extractQuestions(pages) {
  const parts = [];
  pages.forEach((p, i) => {
    parts.push({ text: `--- Question paper, page ${i + 1} of ${pages.length} ---` });
    parts.push(imagePart(p.dataUrl));
  });
  parts.push({
    text: "Extract every question from these pages, in printed order, following the rules exactly.",
  });

  const out = await generate({ parts, instruction: QUESTION_INSTRUCTION });
  const questions = pickArray(out, "questions");

  return questions.map((q, i) => ({
    id: `q${i + 1}`,
    order: i + 1,
    label: String(q.label ?? q.number ?? i + 1).trim(),
    number: q.number != null ? String(q.number) : null,
    subpart: q.subpart != null ? String(q.subpart) : null,
    text: String(q.text ?? "").trim(),
    context: q.context ? String(q.context).trim() : null,
    marks: Number.isFinite(q.marks) ? q.marks : null,
    page: Number.isFinite(q.page) ? q.page : 1,
  }));
}

/* ------------------------------------------------------------------ */
/* 2. Answer region extraction (with bounding boxes)                   */
/* ------------------------------------------------------------------ */

const ANSWER_INSTRUCTION = `You read a student's HANDWRITTEN answer sheet and locate each answer on the page.

For every distinct answer block the student wrote, return one entry with a tight bounding box.

RULES - follow exactly:
1. EVERY block MUST carry "box_2d". A block without it is worthless and invalid - the whole
   purpose of this task is locating each answer on the page, so never omit the field, never
   leave it null, and never return an empty array for it.
   "box_2d" is [ymin, xmin, ymax, xmax], normalised to 0-1000 relative to the page it is on.
   The box must tightly enclose the WHOLE answer - every line of writing, plus any diagram,
   equation or table belonging to that answer. Do not box just the first line.
   Do not include the margin rule, the page number, or neighbouring answers.
2. "label" = the question number the student wrote next to the answer, copied verbatim
   ("Q2", "Ans 11(b)", "3."). If the student wrote NO number for that block, set label to null.
   Never invent a label, and never renumber based on position on the page.
3. Students answer OUT OF ORDER. Report blocks in the order they physically appear on the page and
   let the label speak for itself.
4. MULTI-PAGE ANSWERS: if an answer continues onto the next page, emit a SEPARATE block on that
   page with the same label and "isContinuation": true. The first block of an answer is false.
   A continuation often has no re-written number - still carry the label forward.
5. "text" = a faithful transcription of the handwriting in that block. Transcribe formulas and
   labelled diagram parts as best you can. If a word is illegible write [illegible].
6. Ignore ruled lines, margins and blank space. The name / roll-number header at the top of the
   sheet is NOT an answer - never emit it as a block. Instead report it once in "student":
   {"name": "...", "roll": "..."}, copying what is written exactly. Use null for either field if
   it is not written on the sheet. Never invent a name.
7. ROUGH WORK: writing that is crossed out, struck through, scribbled over or marked as rough
   is NOT part of any answer. Emit it as its OWN block with "label": null and
   "isRoughWork": true. It must never share a box or a transcription with a real answer -
   an answer's box has to stop before the struck-through lines start, even when the rough
   work sits directly beneath it on the same page.

Return JSON exactly:
{"student":{"name":"...","roll":"..."},
"blocks":[{"page":1,"label":"Q2","text":"...","box_2d":[120,80,430,910],
"isContinuation":false,"isRoughWork":false}]}`;

export async function extractAnswers(pages) {
  const parts = [];
  pages.forEach((p, i) => {
    parts.push({ text: `--- Answer sheet, page ${i + 1} of ${pages.length} ---` });
    parts.push(imagePart(p.dataUrl));
  });
  parts.push({
    text:
      `Locate every handwritten answer block across all ${pages.length} page(s). ` +
      `Set "page" to the 1-based page number the block appears on. Follow the rules exactly.`,
  });

  const out = await generate({
    parts,
    instruction: ANSWER_INSTRUCTION,
    // Blocks without boxes are useless — highlighting is the whole point — but a
    // genuinely blank sheet legitimately has no blocks at all, so only reject
    // the case where answers were found and none of them were located.
    validate: (parsed) => {
      const found = pickArray(parsed, "blocks");
      if (found.length === 0) return null;
      const boxed = found.filter(
        (b) => Array.isArray(b?.box_2d) && b.box_2d.length === 4
      );
      return boxed.length === 0
        ? `${found.length} answers found but none carried box_2d`
        : null;
    },
  });
  const blocks = pickArray(out, "blocks");

  // A model that answers with a bare array has no room for the header, so the
  // name is simply absent — the UI falls back to "the student".
  const name = out?.student?.name ? String(out.student.name).trim() : "";
  const roll = out?.student?.roll ? String(out.student.roll).trim() : "";

  const located = blocks.map((b, i) => {
    const box = Array.isArray(b.box_2d) ? b.box_2d.map(Number) : null;
    const usable = box && box.length === 4 && box.every((n) => Number.isFinite(n));
    const [ymin, xmin, ymax, xmax] = usable ? box : [];
    const page = Number.isFinite(b.page) ? Math.max(1, Math.min(pages.length, b.page)) : 1;

    return {
      id: `b${i + 1}`,
      page,
      label: b.label ? String(b.label).trim() : null,
      text: String(b.text ?? "").trim(),
      isContinuation: Boolean(b.isContinuation),
      isRoughWork: Boolean(b.isRoughWork),
      // Null when the model gave no usable box. The answer is still real and
      // still gets mapped and graded — it just can't be highlighted.
      // Stored as percentages so the overlay positions directly in CSS,
      // independent of the rendered page size.
      rect: usable
        ? {
            top: clampPct(Math.min(ymin, ymax) / 10),
            left: clampPct(Math.min(xmin, xmax) / 10),
            height: clampPct(Math.abs(ymax - ymin) / 10),
            width: clampPct(Math.abs(xmax - xmin) / 10),
          }
        : null,
    };
  });

  // Silence here would be indistinguishable from a blank answer sheet, so say
  // which of the two failure modes actually happened.
  const withBox = located.filter((b) => b.rect).length;
  if (blocks.length === 0) {
    console.warn(
      `[gemini] no answer array found. top-level keys=${JSON.stringify(Object.keys(out || {}))}`
    );
  } else if (withBox === 0) {
    console.warn(`[gemini] ${blocks.length} answers found but none could be located on the page`);
  }

  return {
    blocks: located,
    student: { name, roll },
    // True when answers were read but none could be located — the UI drops
    // highlighting for this run and says so, rather than showing nothing.
    highlightsUnavailable: located.length > 0 && withBox === 0,
  };
}

/* ------------------------------------------------------------------ */
/* 3. Mapping + grading                                                */
/* ------------------------------------------------------------------ */

const MAP_INSTRUCTION = `You map a student's answer blocks to exam questions, then grade them.

You receive QUESTIONS (printed order, authoritative numbering) and BLOCKS (handwritten answers
already transcribed and located, each with an id, a page, and the number the student wrote).

MAPPING RULES:
1. Match primarily on the student's written label. "Q2" -> question labelled "2". "Ans 11(b)" -> "11 (b)".
   Normalise punctuation, case and spacing when comparing. A bare "11" never matches "11 (a)" unless
   question 11 has no sub-parts.
2. A block whose label is null, or whose label matches no question, MUST be matched on CONTENT:
   compare its transcription against the wording of the still-unmatched questions. An unlabelled
   answer is still a real answer - a student simply forgot to write the number - so work out
   which question it answers and assign it. Leave it unmatched only when its content genuinely
   answers none of the questions on the paper.
3. One question may own SEVERAL blocks (a multi-page answer, or a diagram block plus a prose block).
   List every owning block id in "blockIds", ordered page-first.
4. A question with no block is "unanswered": blockIds [], score 0, and feedback saying it was
   not attempted. Never invent an answer for it.
5. A block that answers no question goes in "unmatchedBlocks" with a short human reason
   (e.g. "Rough work", "Answer to a question not on this paper").
6. Never assign the same block to two questions.
7. ONLY a block carrying "isRoughWork": true is crossed-out working. Never assign one to a
   question - put it in "unmatchedBlocks" with the reason "Rough work". This rule applies to
   nothing else: an unlabelled block without that flag is a normal answer and rule 2 governs it.

GRADING RULES:
7. "maxScore" is the question's printed marks; if null, use 5.
8. "score" is what the student earned, 0..maxScore, halves allowed. Judge the substance, not the
   handwriting or spelling. Give partial credit for partially correct work.
9. "feedback" is 2-4 sentences written to the student, addressed as "you".
   It MUST be technical and specific to
   THIS question. Name the actual terms, structures, formulas, units, stages or steps involved -
   "thylakoid membrane", "bicuspid valve", "ultrafiltration", "V = IR", "litres per minute" -
   taken from the question wording and from what the student actually wrote.
   Structure it as: what they got right (name the concept, do not just say "correct"), then
   what was wrong or absent (name it), then what a full-mark answer needed.
   On a FULLY CORRECT answer you must still do two things: name the concept the student
   demonstrated, AND add one precise factual extension that deepens it - a related structure,
   the unit, the mechanism, a typical value, or where the idea is used next. Merely confirming
   the answer, or restating it back ("Correct, the nephron is the functional unit"), is NOT
   acceptable: the student should learn something from every comment, including the ones they
   got right. A bare "Correct." or "Good work." is never acceptable.
   Do not invent errors that are not in the answer, and do not pad with generic encouragement.
10. "missing" lists the specific things that cost marks, as short noun phrases that NAME the
    term - e.g. ["the names of the bicuspid and tricuspid valves", "that the alveolar wall is
    one cell thick"]. It is the answer to "why were marks deducted?". Use [] when the student
    earned full marks. Never restate the whole answer here, and never list style or handwriting.
11. "confidence" is your confidence in the MAPPING (not the grade): "high" | "medium" | "low".

WHOLE-PAPER SUMMARY:
12. "overallFeedback" is 3-5 sentences for the TEACHER: what the student genuinely understands,
    where marks were lost, and any pattern across questions. Use subject vocabulary.
13. "strengths" lists topics the student clearly commands, as short technical phrases.
14. "gaps" lists topics where marks were repeatedly lost, as short technical phrases. This is
    the teacher's answer to "what should I reteach?".

Return JSON exactly:
{"results":[{"questionId":"q1","blockIds":["b3"],"status":"answered","score":2,"maxScore":3,
"feedback":"...","missing":["..."],"confidence":"high"}],
"unmatchedBlocks":[{"id":"b9","reason":"Rough work"}],
"overallFeedback":"...","strengths":["..."],"gaps":["..."]}`;

export async function mapAndGrade(questions, blocks) {
  const payload = {
    questions: questions.map((q) => ({
      id: q.id,
      label: q.label,
      text: q.text,
      context: q.context,
      marks: q.marks,
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      page: b.page,
      label: b.label,
      isContinuation: b.isContinuation,
      isRoughWork: b.isRoughWork,
      text: b.text,
    })),
  };

  const out = await generate({
    parts: [{ text: JSON.stringify(payload, null, 2) }],
    instruction: MAP_INSTRUCTION,
  });

  const strings = (v) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];

  return {
    results: pickArray(out, "results", { guess: false }),
    unmatchedBlocks: pickArray(out, "unmatchedBlocks", { guess: false }),
    overallFeedback: out.overallFeedback ? String(out.overallFeedback) : "",
    strengths: strings(out.strengths),
    gaps: strings(out.gaps),
  };
}
