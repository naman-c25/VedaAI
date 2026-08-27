# VedaAI — Assessment Extraction & Answer Mapping

**Live:** https://veda-ai-sigma-nine.vercel.app/

Upload a question paper and a handwritten answer sheet. The app extracts every question in printed
order, transcribes and locates every answer, maps them, grades them, and highlights the exact
region of the sheet where each answer sits.

```bash
npm install
cp .env.local.example .env.local     # paste a Gemini key (free: aistudio.google.com/apikey)
npm run dev
```

Sample papers are in `fixtures/`, or run `node scripts/make-fixtures.mjs <dir>` to regenerate them.

---

## The goal

The brief asks three questions a teacher should be able to answer quickly:

| Question | Where the screen answers it |
|---|---|
| Which question was answered? | Score and state on every row; unanswered rows greyed with a badge |
| Where is the answer? | Selecting a question scrolls to it and boxes the writing — **0.97–0.99 IoU** measured, not eyeballed. Box is green / amber / red by marks |
| Which were left unanswered? | Row badge, summary count, and a "Where the marks went" table |

Two rules follow from that:

- **Refusing beats guessing.** A box on the wrong answer is worse than no box — it answers "where?"
  confidently and wrongly. Where evidence is ambiguous the app declines and says so.
- **Unanswered ≠ wrong.** Different facts for a teacher, so separate state, badge and count.

---

## Approach

```
Question Extraction → Answer Extraction → Answer Mapping → Grading / Feedback
    (vision)            (vision + boxes)      (text only)      (text only)
```

**Three passes, not one prompt.** Each pass has one job, so its rules can be strict. Failures say
*which* pass broke. Mapping and grading are text-only — they never re-send images, so the pass that
does most of the reasoning is also the cheap one.

1. **Questions** — all pages together, so numbering across a page break stays intact. Sub-parts are
   separate entries (`11 (a)` and `11 (b)` are two rows), label preserved verbatim and also split
   into `number` + `subpart`. A stem that only carries context isn't emitted as its own question.
2. **Answers** — all pages together, so multi-page answers are detected as continuations. Each block
   returns a transcription, the number *the student wrote* (or null), and a box normalised 0–1000.
   Boxes become percentages at the API boundary, so overlays position correctly at any zoom.
3. **Mapping + grading** — matches on the written label first, falls back to content for unlabelled
   or mislabelled answers.

**Then a deterministic layer that doesn't trust the model** (`lib/assemble.js`): normalised label
matching sweeps every block the model didn't claim, rough work is force-excluded, and the whole
grading summary is computed rather than asked for. This is the most important decision in the
project — the model is a component that will sometimes be wrong, not a source of truth.

**Highlighting is two-step.** The model puts the box roughly right; pixels put it exactly right.
`lib/refine.js` thresholds the page into an ink mask and trims each box to the writing it contains.
Measured: **mean IoU 0.883 → 0.980, 0 worsened.**

---

## AI model

**Google Gemini** (`gemini-2.5-flash`) via `@google/genai`. Chosen because it has a genuine free
tier (Claude has none — ruled out on the brief's own constraint), reads handwriting well, and
returns **normalised bounding boxes natively**. That last point is the deciding one: exact-region
highlighting would otherwise need a separate OCR and layout stage.

All calls run server-side; the key never reaches the browser.

**Quota is per project, per model, per day — not per key.** 20 calls/day for `gemini-2.5-flash`;
one run costs three. (A second key changed nothing — same project.) So there's a fallback chain,
each model drawing its own quota:

```
gemini-2.5-flash → gemini-3.1-flash-lite → gemini-flash-lite-latest
```

The lite models are availability insurance, not peers — they are measurably worse at bounding boxes.

---

## What went wrong

The six worth reading.

**1 · I padded the boxes because they "looked nicer" — and made them worse.** Measured against
ground truth: padding dropped mean IoU from 0.883 to **0.862**. Removing it gave **0.980**.
Breathing room now comes from a fixed pixel outset in the overlay, which looks identical and
doesn't distort the geometry. I'd never have caught this by looking at the screen.

**2 · Valid JSON that was completely useless.** Answer extraction sometimes returned all 15 blocks
with **no `box_2d` on any of them**. Not an API error — the call succeeds, the JSON parses, and the
UI would confidently render zero highlights. So `generate()` takes a `validate` callback that
inspects the *parsed* response and can reject it; three attempts per model. If all fail, the run
**degrades instead of erroring**: text, mapping, grading and summary all work, only highlights are
missing, and the panel says so. (Separately, `gemini-2.5-flash` returns `{"questions": […]}` while
`gemini-3.1-flash-lite` returns a bare array — reading only the named key silently meant "nothing
found".)

**3 · One threshold, picked by eye, silently broke a whole page.** The position-recovery fallback
always refused page 3. I'd written that off as "refusing correctly". It wasn't: a two-line block was
splitting into two bands because I'd set the answer separator to the same value as the *line* gap.
Every answer on that page lost its position — and 7(a), 10(i), 10(ii) all live there, so it looked
like a sub-part bug. Swept the value against ground truth instead of nudging it:

```
0.014 → 4/5 pages   0.018–0.025 → 5/5, IoU 0.980   0.030 → 5/5, 0.968   0.035 → 0/5
```

Took `0.022`, not the sweep's top-scoring `0.018` — that sits one step from the cliff. Mid-plateau
is the robust choice, and tuning for a top score isn't the same as tuning to generalise.

**4 · Sub-part matching was brittle, and my test didn't catch it.** Matching on the printed label
alone broke when a paper prints only `(a)` under a `7.` stem (`a` never matches `Q7(a)` → `7a`), and
when a student writes `Q10` once then just `(ii)`. Keys now come from `number + subpart` too, and a
bare sub-part inherits the parent above it. My test had extracted `7 (a)` and then never asserted
it, so the failure stayed green. `scripts/test-mapping.mjs` now runs with the model's mapping
**forced empty**, so only the deterministic path can match — 14/14, no API.

**5 · A stray answer force-fitted onto a blank question.** On one live run the `Q13` block — a
question that doesn't exist on this paper — was assigned to a question that happened to be empty.
A *correctness* failure, not a cosmetic one. No deterministic guard can catch it: the mislabelled
`Q9` block (content is Ohm's law, genuinely answers Q11) is structurally identical, and there the
match is correct. Only content separates them, so a rule like "reject labels matching nothing" would
break a working feature. Hardened the prompt instead — *never assign a block just because a question
is blank* — then verified the stray stays unmatched **and** both content matches still land.

**6 · Twice the test was wrong, not the app.** A 15-character feedback floor flagged `"Correct."` on
a 1-mark recall question, where it's the right answer; the check now targets questions that *lost*
marks. And the requirements verifier had two bugs of its own. Fixed the tests, not the code.

### The rest, briefly

| Problem | Fix |
|---|---|
| Struck-through rough work was absorbed into the answer above it — an 18%-tall box for a 3-line answer | Explicit rough-work rule in the prompt, **and** force-excluded in `assemble.js` regardless of what the model claims |
| That fix over-generalised: the mapper then dropped *all* unlabelled answers, losing a valid content match | Scoped the rule to `isRoughWork` only, spelled out in the prompt. Caught by the existing test |
| An oversized model box merged two answers — a confident highlight on the wrong one | A band must now be *substantially* inside the box (≥25% of its height), not merely touching. Tested by inflating every true box 60% into the gap below: 10/10 snap back |
| `gemini-2.5-flash` returns `{"questions": […]}`, `gemini-3.1-flash-lite` a bare array — reading only the named key meant "nothing found" | `pickArray()` accepts either shape |
| Feedback was often a bare `"Correct."` — accurate, teaches nothing | Prompt requires subject vocabulary plus one factual extension even on full marks; `missing[]` lists what cost marks. Shortest feedback went 58 → 145 chars |
| Tried third-person feedback using the student's name | Reverted — the direct "you" voice reads better. Name still read, but only so the sheet header isn't mistaken for an answer |
| pdf.js worker resolved through a bundler specifier is fragile across Webpack/Turbopack | Prebuild script copies it to `public/` — identical locally and on Vercel |
| Tailwind v4 drops the default `cursor: pointer` on buttons | One rule in `globals.css` covering buttons, `[role=button]`, labels, selects |
| Converting 28 arbitrary values (`h-[46px]`) to canonical (`h-11.5`) | Checked the *generated CSS* for every one — an unsupported class emits nothing and breaks layout silently, which is worse than the lint warning |
| The app wasn't responsive at all — one breakpoint in the whole codebase, and a fixed `w-115` panel | `lg` breakpoint throughout: sidebar → drawer, cards stack, panels → tabs |
| `.gitignore` had `.env*.local`, which doesn't match `.env` — where the key actually was | Widened before anything was pushed |

One I couldn't solve the way I wanted: reproducing the PDF upload path in Node segfaulted (pdf.js
with native canvas). Rather than fight the tooling, I found the sub-part bug through unit tests
instead — which turned out to be the better test anyway, since it doesn't depend on the model.

---

## Tradeoffs

| Decision | Gained | Cost |
|---|---|---|
| Three model calls, not one | Narrow prompts, diagnosable failures, cheap reasoning pass | 3× quota on a 20/day tier |
| PDF rendered in the browser | Predictable payloads, real per-page progress | Work on the teacher's device |
| 1400px / JPEG 0.82 | Enough for handwriting, bodies stay under limits | Faint pencil scans lose detail |
| Refuse when ink bands don't line up | Never a confidently wrong highlight | Some answers show none |
| Fallback to lite models | App keeps working past quota | Worse bounding boxes |
| Deterministic layer over model output | Sub-parts don't depend on model mood | More code, matching logic in two places |
| Marks editable by hand | Every reading error fixable in a click, no API cost | The grade is a proposal, not an authority |

---

## Assumptions & limitations

**Assumptions** — one sheet at a time; answers written in reading order (the ink fallback relies on
this, the primary path doesn't); handwriting darker than the ruled lines; marks printed in brackets
near the question, defaulting to 5 where absent; uploads ≤10MB.

**Reading printed marks is the weakest part.** Two failures against the fixture paper: a question
printing *no* marks gets one invented, and a printed `[4]` is occasionally read as `1`. Three rounds
of prompt tightening didn't reliably shift either — **the same paper has totalled 38 on one run and
42 on another.** Both affect only a question's *denominator*; mapping, highlighting and the earned
score are unaffected. `scripts/test-pipeline.mjs` reports them as `KNOWN` every run rather than
being softened to stay green. Neither reproduces on `gemini-3.1-flash-lite`, so it's model-specific.

**This is why both the awarded mark and the maximum are editable.** Click, type, Enter. The award
clamps to `0..max`; lowering a max below an awarded score pulls it down too, so `5/3` can't appear;
the summary recomputes. Covers every marks-reading error at no API cost.

**Others:** free-tier quota is tight (20/day, three per run); boxes are tight on separated answers
but may clip a neighbour on a dense page; faint scans weaken *content*-based matching for unlabelled
answers (label matching is unaffected); grading is indicative and presented as a proposal.

---

## Verification

Two suites need no API key at all.

```bash
npm run dev                            # in another terminal

node scripts/verify-requirements.mjs   # all 9 Requirements, with evidence
node scripts/verify-scope.mjs          # every Scope bullet
node scripts/evaluate.mjs              # measured accuracy vs ground truth
node scripts/test-pipeline.mjs         # edge cases
node scripts/test-mapping.mjs          # label matching     (no API)
node scripts/test-boxes.mjs            # highlight accuracy (no API)
```

Point any at the deployment with `BASE_URL=https://veda-ai-sigma-nine.vercel.app`.

**The fixtures are deliberately hostile.** `make-fixtures.mjs` generates a 3-page paper and a 5-page
sheet in a real handwriting font containing: section headings, letter and roman sub-parts,
context-only stems, a question with no printed marks, a sheet opening on Q4, an answer crossing a
page break with the number never rewritten, six label styles, sub-parts answered out of order, a
sub-part answered while its sibling is blank, an answer with the **wrong** number, an unlabelled
answer, crossed-out rough work, an answer to a question not on the paper, a wrong answer, a partial
answer, four never attempted, and a name header. It also writes `ground-truth.json` — the exact
glyph bounds of every answer — which is what makes highlight accuracy measurable.

```
verify-requirements  34/34 claims verified          (also against the live deployment)
verify-scope         23/23
test-pipeline        35/35 (2 known marks issues, reported as KNOWN)
test-mapping         14/14                                            (no API)
test-boxes           0.883 → 0.980 mean IoU, 0 worsened
                     fallback 5/5 pages · oversized-box 10/10         (no API)

evaluate.mjs   question extraction 100% found · 100% order · 100% wording
               answer mapping 15/15 · highlighting 0.986 IoU · edge cases 14/14
```

The deterministic parts — arithmetic, label matching, summary consistency, box geometry — are exact
and reproducible. The *model's* reading accuracy is not something any harness can pin at 100%; the
marks issues above are live examples, and the reason marks are editable.

---

## Structure

```
app/
  page.js                upload → extracting → mapping; owns teacher edits
  api/extract/route.js   three actions: questions | answers | map
components/              Sidebar, TopBar, UploadScreen, ExtractingScreen,
                         QuestionPanel, AnswerSheetPanel
lib/
  files.js               PDF/image → page bitmaps, in the browser
  gemini.js              the three passes, model fallback, response validation
  assemble.js            merge, deterministic safety net, grading summary
  refine.js              ink-mask box refinement + band-derivation fallback
scripts/                 fixtures, ground truth, and the six suites above
```

**Responsive** — `lg` (1024px) is the switch, one component tree. Sidebar becomes a drawer, upload
cards stack, and the two mapping panels become Questions / Answer Sheet tabs. Because the core
interaction is *tap a question, see its answer*, selecting one switches to the sheet tab; the
chevron still expands feedback in place.

**Highlight colour follows the marks** — green full, amber partial, red nothing earned — and updates
the moment a teacher edits a score.

**Deploying:** push, import on Vercel, add `GEMINI_API_KEY`. No database, no auth; state is in
memory for the session.
