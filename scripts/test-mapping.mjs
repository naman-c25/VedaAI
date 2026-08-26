/**
 * Unit tests for the deterministic label matching in lib/assemble.js.
 *
 * Sub-part answers (7a, 10ii) must land on their question even when the model's
 * own mapping misses them entirely — that is the whole point of the safety net.
 * Every case here runs the model's mapping as EMPTY, so only the deterministic
 * path can produce a match. No API calls, no network.
 *
 *   node scripts/test-mapping.mjs
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const shim = join(process.cwd(), "fixtures", ".assemble.mjs");
writeFileSync(shim, readFileSync(join(process.cwd(), "lib", "assemble.js")));
const { assemble, normalizeLabel, blockKeys, parentOf } = await import(
  `file://${shim.replace(/\\/g, "/")}`
);
unlinkSync(shim);

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const rect = { top: 10, left: 10, height: 5, width: 50 };
const block = (id, label, text = "answer text") => ({
  id,
  page: 1,
  label,
  text,
  isContinuation: false,
  isRoughWork: false,
  rect,
});
const question = (id, label, number, subpart, marks = 2) => ({
  id,
  label,
  number,
  subpart,
  text: `question ${label}`,
  context: null,
  marks,
  page: 1,
});

// The model contributes nothing: only the deterministic matcher can rescue these.
const NO_MAPPING = { results: [], unmatchedBlocks: [], overallFeedback: "" };
const run = (questions, blocks) => assemble(questions, blocks, NO_MAPPING);

/* --------------------------- label normalisation -------------------------- */
check("normalize Q.11 (b)", normalizeLabel("Q.11 (b)") === "11b", normalizeLabel("Q.11 (b)"));
check("normalize Ans 6.", normalizeLabel("Ans 6.") === "6", normalizeLabel("Ans 6."));
check("normalize bare 2.", normalizeLabel("2.") === "2", normalizeLabel("2."));
check("normalize Q10 (ii)", normalizeLabel("Q10 (ii)") === "10ii", normalizeLabel("Q10 (ii)"));
check("parentOf Q10 (ii)", parentOf("Q10 (ii)") === "10", String(parentOf("Q10 (ii)")));
check("parentOf bare (ii) is null", parentOf("(ii)") === null);

/* ------------------- sub-parts when the paper prints them ----------------- */
{
  const qs = [question("q1", "7 (a)", "7", "a"), question("q2", "7 (b)", "7", "b")];
  const r = run(qs, [block("b1", "Q7(a)")]);
  check(
    "letter sub-part matches its own question",
    r.questions[0].status === "answered" && r.questions[1].status === "unanswered",
    `7(a)=${r.questions[0].status}, 7(b)=${r.questions[1].status}`
  );
}

/* ------- the case that kept breaking: paper prints only "(a)" ------------- */
{
  const qs = [question("q1", "(a)", "7", "a"), question("q2", "(b)", "7", "b")];
  const r = run(qs, [block("b1", "Q7(a)"), block("b2", "Q7 (b)")]);
  check(
    "sub-part label without its parent number still matches",
    r.questions[0].status === "answered" && r.questions[1].status === "answered",
    `(a)=${r.questions[0].status}, (b)=${r.questions[1].status}`
  );
}

/* ---------------------------- roman sub-parts ----------------------------- */
{
  const qs = [
    question("q1", "10 (i)", "10", "i", 1),
    question("q2", "10 (ii)", "10", "ii", 4),
    question("q3", "10 (iii)", "10", "iii", 1),
  ];
  // Written out of order, as students do.
  const r = run(qs, [block("b1", "Q10 (ii)"), block("b2", "Q10 (i)")]);
  check(
    "roman sub-parts match, out of order, third left unanswered",
    r.questions[0].status === "answered" &&
      r.questions[1].status === "answered" &&
      r.questions[2].status === "unanswered",
    `i=${r.questions[0].status}, ii=${r.questions[1].status}, iii=${r.questions[2].status}`
  );
}

/* ------------- parent carried forward from the line above ----------------- */
{
  const qs = [question("q1", "10 (i)", "10", "i"), question("q2", "10 (ii)", "10", "ii")];
  // Student writes "Q10" once, then just "(ii)" beneath it.
  const r = run(qs, [block("b1", "Q10 (i)"), block("b2", "(ii)")]);
  check(
    "bare sub-part inherits the parent number written above it",
    r.questions[1].status === "answered",
    `10(ii)=${r.questions[1].status}`
  );
  check(
    "blockKeys carries the parent",
    blockKeys("(ii)", "10").has("10ii"),
    [...blockKeys("(ii)", "10")].join(",")
  );
}

/* ------------- a bare parent must not hijack a sub-part ------------------- */
{
  const qs = [question("q1", "11 (a)", "11", "a"), question("q2", "11 (b)", "11", "b")];
  const r = run(qs, [block("b1", "Q11")]);
  check(
    "bare parent number does not claim a sub-part question",
    r.questions.every((q) => q.status === "unanswered") && r.unmatched.length === 1,
    `unmatched=${r.unmatched.length}`
  );
}

/* --------- a question with no sub-parts still matches a bare number ------- */
{
  const qs = [question("q1", "6.", "6", null, 5)];
  const r = run(qs, [block("b1", "Ans 6.")]);
  check("plain question matches 'Ans 6.'", r.questions[0].status === "answered");
}

/* ------------------ 11 must never be confused with 1 or 1(a) -------------- */
{
  const qs = [question("q1", "1.", "1", null), question("q2", "11.", "11", null)];
  const r = run(qs, [block("b1", "Q11"), block("b2", "Q1")]);
  check(
    "11 and 1 stay distinct",
    r.questions[0].regions[0]?.blockId === "b2" && r.questions[1].regions[0]?.blockId === "b1",
    `1<-${r.questions[0].regions[0]?.blockId}, 11<-${r.questions[1].regions[0]?.blockId}`
  );
}

console.log(`\n=== ${pass}/${pass + fail} mapping checks passed ===`);
if (fail) process.exitCode = 1;
