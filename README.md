# VedaAI — Assessment Extraction & Answer Mapping

Upload a question paper and a student's handwritten answer sheet. The app extracts every
question in printed order, transcribes and locates every answer, maps answers to questions,
grades them, and highlights the exact region of the sheet where each answer lives.

## Approach

The pipeline runs as three separate model passes rather than one. Splitting it keeps each
prompt narrow, makes failures diagnosable, and lets the UI show honest progress.

**1. Question extraction** (`lib/gemini.js` → `extractQuestions`)
All question-paper pages go in together so the model can see numbering that continues across
a page break. It returns questions in printed order, with labelled sub-parts as separate
entries — `11 (a)` and `11 (b)` are two rows, never one. The printed label is preserved
verbatim and also split into `number` + `subpart`. A parent number that only carries shared
context (a passage, a diagram) is not emitted as its own question; the context is instead
attached to each sub-part so every question stands alone.

**2. Answer extraction with bounding boxes** (`extractAnswers`)
All answer pages go in together so multi-page answers can be detected as continuations. For
each answer block the model returns a transcription, the question number *the student wrote*
(or `null`), and a tight bounding box normalised to 0–1000. Boxes are converted to
percentages at the API boundary, so the overlay positions correctly at any zoom or page size
without ever needing the original pixel dimensions.

### Feedback and the grading summary

Feedback is addressed to the student as "you". A third-person version using the student's name
was tried and reverted — the direct voice read better.

The student's name and roll number are still read off the answer-sheet header during answer
extraction, but only so the header is recognised *as a header*: it gets reported separately and
never emitted as an answer block, which otherwise leaves it floating in the unmatched list.

Feedback is required to be **technical and specific to the question asked** — it must name the
actual terms, structures, formulas and units involved, drawn from the question wording and from
what the student actually wrote. Generic praise is explicitly banned, and a fully correct answer
must still teach something: the prompt requires one factual extension beyond confirming the
answer, so a 1-mark recall question doesn't just get "Correct."

Alongside the prose, each graded question returns `missing[]` — the specific points that cost
marks, as short phrases that name the term. That array is what the UI renders under **"Why N of M
marks were lost"**, and it is the direct answer to *why* a score is what it is. It is forced empty
on full marks, so a stale reason can never linger.

The whole-paper summary adds `strengths[]` and `gaps[]` — topics the student commands, and topics
where marks were repeatedly lost — plus a **"Where the marks went"** table listing every question
that dropped marks with its reason. Real output on the fixture paper:

```
Q1  1/1  "You correctly identified that arteries carry blood away from the heart. Note that
          while the aorta is the primary artery for systemic circulation, the pulmonary
          artery also carries blood away from the heart to the lungs."

Q5  2/3  "You provided a good description of the alveolar structure and the diffusion
          process. However, you did not provide the requested labelled diagram to
          illustrate the capillary network and air-space."
          missing: • a labelled diagram

Q3  0/1  "You identified the Watt, which is the unit of power, not resistance. The SI unit
          of electrical resistance is the Ohm (Ω), named after Georg Ohm."
          missing: • the Ohm

strengths: photosynthesis stages | kidney ultrafiltration | Ohm's law
gaps:      heart valve anatomy | leaf adaptations | SI units
```

### Highlights are colour-coded by marks

The green box the brief asks for is the *full marks* case. Two more states carry information a
teacher wants at a glance, so the colour follows the score:

| Colour | Meaning |
|---|---|
| Green | Full marks |
| Amber | Partially correct |
| Red | Answered but earned nothing |

The tag on each box shows the question label and the score (`Q3 · 0/1`), and a legend sits in the
panel header. Because the colour is derived from the current score, it updates the moment a
teacher edits a mark.

### Recovering positions the model never gave (the fallback that makes highlighting reliable)

The lite fallback models frequently transcribe every answer correctly but omit `box_2d` entirely,
which would leave a run with no highlights at all. `findBands()` in `lib/refine.js` recovers them
from the page itself: it thresholds the page into ink, splits it into bands of writing separated
by blank runs, and — since the model reports blocks in reading order and bands are in reading
order too — zips the two together.

It only does this **when the counts agree exactly**, first on the raw bands and then after
dropping page furniture (short bands hugging the top or bottom edge — name headers, page numbers).
A mismatch means we cannot be sure which band belongs to which answer, and a confidently wrong
highlight is worse than none, so those stay unlocated. Derived boxes are drawn with a **dashed**
border and the panel says how many were placed that way.

Measured against ground truth by `scripts/test-boxes.mjs` — no API calls needed:

```
page 1: 3 answers matched, mean IoU 0.979    ← name header correctly dropped
page 2: 3 answers matched, mean IoU 0.991
page 3: 5 ink bands vs 4 answers — no confident mapping, left unlocated
page 4: 3 answers matched, mean IoU 0.985
page 5: 2 answers matched, mean IoU 0.991

pages resolved : 4/5     boxes >=0.5 IoU: 11/11
```

Page 3 declining is the feature working, not failing.

### A response validator, not just an error handler

Answer extraction intermittently came back with all 15 answer blocks but **no `box_2d` field on
any of them**. That is not an API error — the call succeeds, the JSON parses, and the UI would
confidently render a result with zero highlights. Nothing would have caught it.

`generate()` therefore takes an optional `validate` callback that inspects the *parsed* response
and can declare it unusable, which is then retried like any other failure. Each model gets two
attempts before the chain moves on, because completeness varies run to run even at temperature 0.
Answer extraction rejects "answers found but none located", while still accepting zero blocks,
since a blank answer sheet legitimately has none. A real run:

```
try1  textLen=4032   ← answers came back with no box_2d  → rejected
try2  textLen=3966   ← asked again, boxes present        → accepted
```

Each model gets **three** attempts, because on the lite fallbacks the box field goes missing often
enough that two was not sufficient in practice.

**If every attempt still fails, the run degrades instead of erroring.** The last parseable
response is used, blocks keep their text with `rect: null`, and mapping, grading, feedback and the
summary all work normally — only the green highlights are absent, and the answer-sheet panel says
so plainly. A teacher with a fully graded paper and no boxes is far better served than one staring
at a 500. This matters because the box field is the *only* thing the lite models drop; the
transcription and the numbering come back fine.

**3. Mapping and grading** (`mapAndGrade`)
This pass is text-only — it receives the question list and the transcribed blocks, not the
images. It matches on the student's written label first, falls back to content matching for
unlabelled blocks, and grades what it matched. Keeping it text-only makes it fast, cheap, and
far more reliable than asking one prompt to do vision and reasoning at once.

**Deterministic safety net** (`lib/assemble.js`)
The model does the semantic work, but is never trusted to be exhaustive. After mapping, a
normalised label match (`Q.11 (b)` → `11b`) runs over every block the model didn't claim. A
question whose number the student clearly wrote can therefore never be reported as unanswered
because of a model omission. The same pass computes the grading summary and collects leftover
blocks as unmatched.

Sub-parts are where this matters most, and matching on the printed label alone turned out to be
too brittle for them. Two cases broke it:

- **A paper that prints only `(a)` under a `7.` stem.** The question's label normalises to `a`,
  which never matches a student's `Q7(a)` → `7a`. Keys are now built from `number + subpart` as
  well as from the label, so both forms match.
- **A student who writes `Q10` once and then just `(ii)` beneath it.** A bare sub-part marker now
  inherits the last parent number seen while walking the sheet in order.

A bare `Q11` still refuses to claim `11 (a)` — a parent number is not an answer to a specific
sub-part. `scripts/test-mapping.mjs` covers all of this with the model's mapping forced empty, so
only the deterministic path can produce a match: **14/14, no API calls**.

### How the edge cases are handled

| Case | Handling |
|---|---|
| Sub-parts | Separate entries by prompt rule; verified by the `number`/`subpart` split |
| Original numbering | `label` preserved verbatim from the paper and rendered as-is |
| Out-of-order answers | Mapping is by written label, never by position on the page |
| Unanswered questions | No owning block → `status: "unanswered"`, score 0, explicit badge in the list |
| Answers matching no question | Collected into `unmatched`, listed under the questions and drawn faintly on the sheet |
| Multi-page answers | Continuation blocks carry the same label; the question owns regions on several pages and shows a "Spans pages" badge |
| Low-confidence mapping | Surfaced as a badge rather than hidden |

## AI model

**Google Gemini 2.5 Flash** (`gemini-2.5-flash`) via `@google/genai`.

Chosen for three reasons: it has a genuine free tier (the assignment requires one), it reads
handwriting well, and it returns normalised bounding boxes natively — which is what makes
exact-region highlighting possible without a separate OCR/layout stage.

All model calls run server-side in `app/api/extract/route.js`, so the API key is never
exposed to the browser.

### Free-tier quota and the model fallback chain

Gemini's free tier is metered **per project, per model, per day** — not per key. On the project
used here `gemini-2.5-flash` allows **20 `generateContent` calls a day**, and one full run costs
three. Swapping in a second API key from the same project does not help, because the quota is
shared across keys.

So `lib/gemini.js` runs a fallback chain. When a model is out of quota (429), unknown to the key
(404) or temporarily overloaded (503), the request falls through to the next model, which draws
on its own separate quota:

```
gemini-2.5-flash  ->  gemini-3.1-flash-lite  ->  gemini-flash-lite-latest
```

`gemini-flash-latest` is deliberately excluded: it returned 503 "high demand" on every probe, so
it only added a slow hop before the real fallback.

Two things this shook out, both fixed:

- **Response envelopes differ between models.** `gemini-2.5-flash` honours the requested
  `{"questions": [...]}` shape; `gemini-3.1-flash-lite` returns a bare `[...]` array with the
  same items. The original code read only the named key, so a perfectly good fallback response
  was silently treated as "no questions found". `pickArray()` now accepts either.
- **Quota errors were being mislabelled.** The handler said "wait a minute and try again" for
  every quota error, which is wrong for a per-day cap. It now reads the actual `QuotaFailure`
  detail and says whether the limit is per-minute or per-day, and when it resets.

**Accuracy differs by model.** The 27/27 figures below were measured on the fallback
`gemini-3.1-flash-lite`; `gemini-2.5-flash` scored 27/28 with two marks-reading issues that the
lite model actually got right. The fallback keeps the app working when quota runs out — treat it
as availability insurance, not an equivalent substitute.

## Running locally

```bash
npm install
cp .env.local.example .env.local   # then paste your key
npm run dev
```

Get a free key at <https://aistudio.google.com/apikey> and set:

```
GEMINI_API_KEY=your_key_here
```

## Deploying

Push to GitHub, import the repo on Vercel, and add `GEMINI_API_KEY` under
**Settings → Environment Variables**. No database or auth is needed — everything is held in
memory for the duration of the session.

## Assumptions & limitations

- **In-memory only.** Nothing is persisted. A refresh clears the session, by design.
- **One answer sheet at a time**, matching the brief. The pipeline is per-student.
- **10MB per upload**, enforced client-side to match the design and keep request bodies within
  serverless limits. Pages are rendered at 1400px wide as JPEG in the browser before upload.
- **Highlight accuracy depends on the model's boxes.** They are tight and reliable on clearly
  separated answers; on a densely packed page where two answers share a line, a box may
  include a sliver of the neighbouring answer.
- **Free-tier rate limits apply.** Three model calls per run. Hitting the limit surfaces a
  plain-language message rather than a stack trace.
- **Handwriting quality is the main accuracy driver.** A faint or heavily slanted scan
  degrades transcription, which in turn weakens content-based matching for unlabelled answers.
  Label-based matching is unaffected.
- **Grading is indicative.** Marks come from the model reading the question's printed marks;
  where a paper prints none, questions default to 5 marks.
- **Known weak spot — reading printed marks.** Reading the bracketed marks off the right-hand
  margin is the least reliable part of the pipeline, and it varies between runs even at
  temperature 0. Two distinct failures show up against the fixtures:
  - a question that prints *no* marks gets a plausible number invented for it (reporting
    absence is a known LLM weakness, made worse when every surrounding question does have marks);
  - a printed `[4]` is occasionally read as `1` — intermittent, not reproducible on demand.

  Three rounds of prompt tightening did not reliably shift either on `gemini-2.5-flash`. Both are
  limited to a question's *denominator*; mapping, highlighting and the earned score are
  unaffected. `scripts/test-pipeline.mjs` reports them every run as KNOWN issues so they can't
  quietly get worse, and the suite stays honest rather than green.

  Worth noting: **both reproduce on `gemini-2.5-flash` and neither reproduces on
  `gemini-3.1-flash-lite`**, which read every mark on the fixture paper correctly, including
  returning `null` for the question that prints none. Reading small marginal digits is evidently
  model-specific rather than inherent.

  **Mitigated in the UI: the teacher has the final say on every mark.** Both halves of the score
  are editable in place on the mapping screen — the marks awarded *and* the maximum. Click either
  number, type, press Enter (Escape reverts). The AI proposes a grade; the teacher decides it.

  - Awarded marks clamp to `0..maxScore`; lowering a maximum below an already-awarded score pulls
    that score down with it, so an impossible `5/3` can never appear.
  - Marks can be awarded to a question reported unanswered — useful when an answer was written
    somewhere the extractor did not look. The "Unanswered" badge stays, because it records what
    was *found on the sheet*, which is a separate fact from what the teacher decided to award.
  - Any value the teacher changed is tinted, so overrides are visible at a glance.
  - The grading summary — total, maximum and percentage — recomputes from every edit.

  This covers every marks-reading error, not just the two above, and costs no extra API calls.
  A dedicated marks-only extraction pass would likely read the printed marks better than the
  current in-line reading, at the cost of one more API call per run.

## Highlight accuracy

Gemini's boxes land in the right place but are not tight. Since the page bitmap is already in
the browser, `lib/refine.js` corrects them for free: it thresholds the page into an ink mask
(the threshold adapts to the scan's contrast, so ruled lines and margin rules fall out) and
trims each box to the writing it actually contains. The trim is band-aware — rows of ink
separated by a blank run are separate bands, and only bands the model's own box touches are
kept, so the search area can be padded generously to recover a clipped line without swallowing
the answer below it.

`scripts/test-boxes.mjs` measures this against ground truth. The fixture generator records the
exact glyph bounds of every answer block as it draws them, so accuracy is measurable rather
than eyeballed:

```
blocks compared : 15
mean IoU        : 0.883  ->  0.980
worst IoU       : 0.673  ->  0.896
improved        : 14
worsened        : 0
```

The measurement earned its keep: an earlier version padded the refined box for visual comfort
and that padding *reduced* mean IoU to 0.862. Breathing room is now added in the overlay as a
fixed pixel outset instead, so it never distorts the geometry. Model boxes are cached in
`fixtures/model-blocks.json`, so this test runs without an API key.

## Testing

`scripts/make-fixtures.mjs` generates a deliberately hostile question paper and answer sheet —
handwriting rendered in a real script font, answers out of order, a page-break continuation,
a mislabelled answer, an unlabelled answer, crossed-out rough work, and four questions never
attempted. `scripts/test-pipeline.mjs` runs the real pipeline against them and asserts each
edge case. Current state: **27/28 checks pass, 1 known issue** (above).

```bash
node scripts/make-fixtures.mjs            # regenerate fixtures
node scripts/make-fixtures.mjs <dir>      # also write PDFs to <dir>
npm run dev                               # in another terminal
node scripts/test-pipeline.mjs
```

## Project structure

```
app/
  page.js               orchestrates upload → extracting → mapping
  api/extract/route.js  three actions: questions | answers | map
components/
  Sidebar, TopBar       app shell, with the collapsed rail from the design
  UploadScreen          empty + filled states, drag/drop, 10MB guard
  ExtractingScreen      progress across the three stages
  QuestionPanel         question list, scores, AI feedback, unmatched answers
  AnswerSheetPanel      page viewer, zoom, region highlighting
lib/
  files.js              PDF/image → page bitmaps, in the browser
  gemini.js             the three model passes and their prompts
  assemble.js           merge, deterministic safety net, grading summary
```
