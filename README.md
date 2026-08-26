# VedaAI — Assessment Extraction & Answer Mapping

**Live:** https://veda-ai-sigma-nine.vercel.app/

Upload a question paper and a student's handwritten answer sheet. The app extracts every question
in printed order, transcribes and locates every answer, maps answers to questions, grades them,
and highlights the exact region of the sheet where each answer lives.

```bash
npm install
cp .env.local.example .env.local     # paste a Gemini key into it
npm run dev
```

A free key comes from <https://aistudio.google.com/apikey>. Sample papers to try it with are in
`fixtures/`, or regenerate them with `node scripts/make-fixtures.mjs <output-dir>`.

---

# 1. Approach

## The pipeline is three model passes, not one

```
Question Extraction  →  Answer Extraction  →  Answer Mapping  →  Grading / Feedback
   (vision)               (vision + boxes)      (text only)         (text only)
```

The obvious design is one prompt that does everything. I split it deliberately, and the split
paid for itself repeatedly:

- **Each prompt stays narrow.** Asking a model to read a printed paper, read handwriting, locate
  it on the page, match the two, and grade — all at once — makes every instruction compete with
  every other. Split, each pass has one job and its rules can be strict.
- **Failures become diagnosable.** When something broke, the logs said *which* pass broke. Several
  bugs in this README were only findable because of that.
- **The expensive part runs once.** Mapping and grading are text-only — they never re-send images.
  That pass is fast and cheap, and it is where most of the reasoning happens.
- **Progress is honest.** The UI shows three real stages because there are three real stages, not
  a fake progress bar.

**1 · Question extraction** — all question-paper pages go in together, so numbering that continues
across a page break stays intact. Labelled sub-parts come back as separate entries (`11 (a)` and
`11 (b)` are two rows, never one), the printed label is preserved verbatim *and* split into
`number` + `subpart`. A parent number that only carries shared context — a passage, a diagram — is
not emitted as its own question; its context is attached to each sub-part instead, so every
question stands alone.

**2 · Answer extraction** — all answer pages go in together so a multi-page answer can be detected
as a continuation. Each block returns a transcription, the question number *the student actually
wrote* (or `null`), and a bounding box normalised 0–1000. Boxes convert to **percentages** at the
API boundary, so the overlay positions correctly at any zoom and any page size without ever
needing the original pixel dimensions.

**3 · Mapping and grading** — text-only. Matches on the written label first, falls back to content
matching for unlabelled or mislabelled answers, then grades what it matched.

## Then a deterministic layer that does not trust the model

Everything above is the model's judgement. `lib/assemble.js` runs afterwards and is pure code:

- A **normalised label match** (`Q.11 (b)` → `11b`) sweeps every block the model did not claim. A
  question whose number the student clearly wrote can therefore never be reported unanswered
  because of a model omission.
- Rough work is **force-excluded** from every question regardless of what the model claimed.
- The grading summary — totals, percentage, itemised losses — is computed, never asked for.

This is the single most important design decision in the project. **The model is treated as a
component that will sometimes be wrong, not as a source of truth.** Almost every bug below was
caught or contained by that layer.

## Highlighting: the model puts the box roughly right, pixels put it exactly right

Gemini's boxes land in the right place but are not tight. Since the page bitmap is already in the
browser, `lib/refine.js` corrects them for free — it thresholds the page into an ink mask (the
threshold adapts to the scan's contrast, so ruled lines and margin rules fall out) and trims each
box to the writing it actually contains.

The trim is **band-aware**: rows of ink separated by a blank run are separate bands, and only
bands the model's own box touches are kept. That lets the search area be padded generously to
recover a clipped final line *without* swallowing the answer below it.

Measured against ground truth: **mean IoU 0.883 → 0.980, 14 boxes improved, 0 worsened.**

---

# 2. AI model / API used

**Google Gemini** via `@google/genai`, primary model `gemini-2.5-flash`.

Three reasons:

1. **It has a genuine free tier.** The brief requires one. Claude does not have a free tier — it
   is paid credits — so it was ruled out on the brief's own constraint, not on preference.
2. **It reads handwriting well.**
3. **It returns normalised bounding boxes natively.** This is the deciding factor. Exact-region
   highlighting is a core requirement, and without native boxes it would need a separate OCR and
   layout stage. Gemini collapses that into the same call that does the transcription.

All model calls run server-side in `app/api/extract/route.js`. The key never reaches the browser.

## The quota reality, and the fallback chain

Gemini's free tier is metered **per project, per model, per day** — not per key. On this project
`gemini-2.5-flash` allows **20 `generateContent` calls a day**, and one full run costs three.

I learned this the hard way: a second API key was generated and changed nothing, because both keys
belonged to the same project. The error message said "quota", the real fact was "this project's
daily allowance for this model".

So `lib/gemini.js` runs a fallback chain. When a model is out of quota (429), unknown to the key
(404), or overloaded (503), the request falls through to the next model, which draws on its own
separate quota:

```
gemini-2.5-flash  →  gemini-3.1-flash-lite  →  gemini-flash-lite-latest
```

`gemini-flash-latest` is deliberately excluded — it returned 503 "high demand" on every probe, so
it only added a slow hop before the real fallback. `gemini-2.5-pro` is listed by the models API
but returns 404 for this key, so it is not in the chain either.

**Accuracy is not equal across the chain.** The lite models are availability insurance, not peers.
They are measurably worse at returning bounding boxes (see §3.4). Where the two disagree it is
noted below.

---

# 3. What went wrong, and what I did about it

This is the section I would most want to read as an interviewer, so it is the longest. Every item
here is a real thing that happened while building this, in order.

## 3.1 I added padding to the highlight boxes "so they look nicer" — and it made them worse

The first version of the pixel refinement added a small margin around each refined box for visual
comfort. Then I measured it against ground truth:

```
with padding:     mean IoU 0.862   (11 boxes got WORSE)
without padding:  mean IoU 0.980   (14 improved, 0 worsened)
```

My aesthetic instinct was actively degrading the thing the brief grades. Padding came out of the
geometry entirely; breathing room is now added in the overlay as a **fixed pixel outset**, which
looks the same and never distorts the measurement.

**This is why the ground-truth harness exists.** The fixture generator records the exact glyph
bounds of every answer as it draws them, so box accuracy is a number, not an opinion. I would not
have caught this by looking at the screen — it looked fine.

## 3.2 Crossed-out rough work was being counted as part of an answer

A struck-through calculation sitting directly beneath Q7(a) was absorbed into Q7(a)'s bounding
box — the box was 18% of page height for a three-line answer, while a four-line answer next to it
was 13%. That is the kind of thing that is invisible until you look at the numbers.

Fixed in two places, because one was not enough: the extraction prompt now has an explicit
rough-work rule, **and** `assemble.js` force-excludes rough-work blocks from every question
regardless of what the model claimed.

## 3.3 A fix for one thing broke another

Adding the rough-work rule made the mapper too conservative — it started treating *all* unlabelled
blocks as not-to-be-assigned, and the unlabelled alveolus answer (which should match Q5 on content)
became unanswered. The rule had to be explicitly scoped:

> ONLY a block carrying `isRoughWork: true` is crossed-out working. This rule applies to nothing
> else: an unlabelled block without that flag is a normal answer and rule 2 governs it.

**Lesson recorded honestly:** prompt rules interact. A rule that reads as narrow to a human can be
generalised by the model. The regression was caught only because the test suite covered the
unlabelled-answer case.

## 3.4 Two model responses that were valid JSON and completely useless

**Different envelopes.** `gemini-2.5-flash` honours the requested `{"questions": [...]}` shape.
`gemini-3.1-flash-lite` returns a **bare array** with the same items. The original code read only
the named key, so a perfectly good fallback response — all 16 questions, correctly extracted — was
silently read as "no questions found". `pickArray()` now accepts either shape.

**Missing boxes.** Answer extraction intermittently returned all 15 blocks with **no `box_2d` on
any of them**. This one is nastier: it is not an API error. The call succeeds, the JSON parses,
and the UI would confidently render a complete result with zero highlights. Nothing in a normal
error path would ever catch it.

So `generate()` gained a `validate` callback that inspects the **parsed** response and can declare
it unusable, which is then retried like any other failure. Each model gets three attempts —
two was measurably not enough on the lite models. A real run:

```
try1  textLen=4032   ← answers came back with no box_2d  → rejected
try2  textLen=3966   ← asked again, boxes present        → accepted
```

**And if every attempt still fails, the run degrades instead of erroring.** Blocks keep their text
with `rect: null`; mapping, grading, feedback and the summary all work normally; only the
highlights are absent, and the panel says so plainly. A teacher with a fully graded paper and no
boxes is far better served than one staring at a 500.

## 3.5 Recovering positions the model never gave

Degrading gracefully was not satisfying — highlighting is a core requirement, not a nice-to-have.
`findBands()` recovers the positions from the page itself: threshold to ink, split into bands of
writing separated by blank runs, and — since the model reports blocks in reading order and bands
are in reading order too — zip the two together.

It only does this **when the counts agree exactly**, first on the raw bands, then after dropping
page furniture (short bands hugging the top or bottom edge — name headers, page numbers). A
mismatch means we cannot be sure which band belongs to which answer, and **a confidently wrong
highlight is worse than none**, so those stay unlocated. Derived boxes are drawn with a dashed
border and the panel says how many were placed that way.

```
page 1: 3 answers matched, mean IoU 0.979    ← name header correctly dropped
page 2: 3 answers matched, mean IoU 0.991
page 3: 4 answers matched, mean IoU 0.965
page 4: 3 answers matched, mean IoU 0.985
page 5: 2 answers matched, mean IoU 0.991

pages resolved: 5/5     boxes >=0.5 IoU: 15/15
```

Getting to 5/5 took a bug fix of its own — see §3.6.

## 3.6 One threshold, picked by eye, silently broke a whole page

The position-recovery fallback resolved four pages out of five. Page 3 always refused:

```
page 3: 5 ink bands vs 4 answers — no confident mapping
```

I had left that as "the feature working, not failing" — refusing to guess is the correct behaviour
when the counts disagree. That was too comfortable an explanation, and it hid a real bug.

**The consequence was specific and bad.** Every answer on page 3 loses its position when the page
does not resolve — and page 3 is where 7(a), 10(i) and 10(ii) live. Clicking those sub-parts did
nothing at all, while every other question worked. It looked like a sub-part bug. It was a
threshold bug.

The cause: the two-line rough-work block was splitting into **two** bands. Both the gap between
lines *inside* an answer and the gap *between* answers are blank runs, and I had set the separator
to `0.014` — numerically identical to the line gap. Answers with short glyphs and few ascenders
have slightly wider line gaps, so they split.

Rather than nudge the number until page 3 passed, I swept it against ground truth
(`scripts/tune-gap.mjs`):

```
BLOCK_GAP   pages resolved   boxes >=0.75   mean IoU
  0.014         4/5             11/11         0.986     ← the bug
  0.018         5/5             15/15         0.980
  0.022         5/5             15/15         0.980     ← chosen
  0.025         5/5             15/15         0.980
  0.030         5/5             15/15         0.968
  0.035         0/5              0/0          0.000     ← answers merge together
```

The sweep's own "best score" was `0.018`, and I did not take it — it sits one step from the cliff
where the bug returns. `0.022` is the middle of the flat region, furthest from failure in both
directions. **Tuning to the top score and tuning for robustness are different things**, and on a
threshold that has to generalise to handwriting I have never seen, the second matters more.

Splitting *inside* a known box still uses the tighter `0.014` — that path measures 0.980 and was
not touched. Two jobs, two thresholds.

`scripts/test-boxes.mjs` now requires **all** pages to resolve, not all-but-one. The old assertion
tolerated exactly the failure that caused this.

## 3.7 Sub-part matching was brittle, and my test did not catch it

Sub-part answers (7a, 10ii) intermittently failed to map. The tests passed, because matching was
done on the printed label alone and my fixture happened to produce labels where that worked. Two
cases broke it:

- **A paper that prints only `(a)`** under a `7.` stem. The question's label normalises to `a`,
  which never matches a student's `Q7(a)` → `7a`.
- **A student who writes `Q10` once and then just `(ii)` beneath it.** `ii` never matches `10ii`.

Keys are now built from `number + subpart` as well as from the label, and a bare sub-part marker
inherits the last parent number seen while walking the sheet in order. A bare `Q11` still refuses
to claim `11 (a)` — a parent number is not an answer to a specific sub-part.

There was also a **test gap**: `7 (a)` was extracted and then never asserted, so a mapping failure
on it would have left the suite green. `scripts/test-mapping.mjs` now covers all of this with the
model's mapping **forced empty**, so only the deterministic path can produce a match — 14/14, no
API calls. Sub-parts no longer depend on the model having done its job.

## 3.8 Feedback took four iterations to get right

| Version | Problem |
|---|---|
| "Correct." | Technically accurate, teaches nothing |
| Technical + specific | Better, but still restated the answer back on full marks |
| Third person, by name — "Aarav identified…" | Tried, then reverted: the direct voice reads better on screen |
| **Current** — second person, technical, plus a factual extension on every correct answer | |

The current rule requires that a fully correct answer *still* teaches something:

```
Q1  1/1  "You correctly identified that arteries carry blood away from the heart. Note that
          while the aorta is the primary artery for systemic circulation, the pulmonary
          artery also carries blood away from the heart to the lungs."

Q3  0/1  "You identified the Watt, which is the unit of power, not resistance. The SI unit
          of electrical resistance is the Ohm (Ω), named after Georg Ohm."
          missing: • the Ohm
```

Shortest feedback went from 58 characters to 145+.

Alongside the prose, each graded question returns `missing[]` — the specific points that cost
marks. That is what the UI renders under **"Why N of M marks were lost"**, and it is the direct
answer to *why* a score is what it is. It is forced empty on full marks so a stale reason can
never linger.

The student's name and roll number are still read off the sheet header — but only so the header is
recognised **as a header** and never emitted as an answer block, which otherwise leaves it
floating in the unmatched list.

## 3.9 Twice, the test was wrong and the app was fine

Worth recording, because the instinct to "fix the app" would have been wrong both times.

**A feedback-length threshold of 15 characters** flagged `"Correct."` on two 1-mark recall
questions the student answered perfectly. For a one-word recall answer, "Correct." *is* the right
thing to say — my arbitrary threshold was the defect. The check now targets what actually matters:
every question that **lost** marks must explain why.

**The requirements verifier had two of its own bugs**: it scraped `setProgress` from the whole file
and picked up `reset()`'s `setProgress(0)`, making progress look like it went backwards; and its
local `norm()` did not strip a leading `q`, so `norm("Q4")` was `"q4"` and a `startsWith("4")`
check failed. Both were fixed in the test, not the app.

## 3.10 The API key would have been committed

The original `.gitignore` had `.env*.local`, which does **not** match `.env` — and that is where
the key ended up. Widened to ignore `.env` and `.env.*`. Verified: `git ls-files` shows zero
`.env` files tracked.

## 3.11 Smaller ones

- **pdf.js worker.** Resolving it through a bundler specifier is fragile across Webpack and
  Turbopack. A prebuild script copies it into `public/`, which works identically locally and on
  Vercel.
- **Tailwind v4 removed the default `cursor: pointer` on buttons.** Rather than remember a class
  on every control, one rule in `globals.css` covers buttons, `[role="button"]`, labels and
  selects, with `not-allowed` on disabled and `text` on the editable mark fields.
- **Tailwind canonical classes.** 28 arbitrary values (`h-[46px]`) were converted to canonical
  form (`h-11.5`). I then checked the generated CSS for every one of them — an unsupported class
  emits nothing and the layout silently breaks, which is worse than the lint warning.
- **Reproducing the PDF upload path in Node segfaulted** (pdf.js + native canvas). Rather than
  fight the tooling, the sub-part bug it was meant to chase was found and fixed through unit tests
  instead — which turned out to be the better test anyway, since it does not depend on the model.

---

# 4. Tradeoffs

| Decision | Gained | Given up |
|---|---|---|
| Three model calls per run, not one | Narrow prompts, diagnosable failures, cheap text-only reasoning pass | 3× the quota — significant on a 20/day free tier |
| PDF rendered in the browser, not the server | Predictable payloads, real per-page progress, no server CPU | Work happens on the teacher's machine; a very old device will be slower |
| Pages rendered at 1400px, JPEG 0.82 | Enough detail for handwriting; request bodies stay well under serverless limits | A very faint pencil scan loses more than it would at full resolution |
| Refuse to guess when ink bands don't line up | Never a confidently wrong highlight | Some answers show no highlight at all |
| Fallback to lite models on quota exhaustion | The app keeps working instead of 500-ing | Those models are measurably worse at bounding boxes |
| Deterministic safety net over model output | Sub-parts and label matching don't depend on model mood | More code, and a second place where matching logic lives |
| Marks editable by the teacher | Every marks-reading error is correctable in one click, at no API cost | The AI's grade is a proposal, not an authority — which is arguably correct anyway |
| In-memory only | Matches the brief; no database, no auth, nothing to leak | A refresh clears the session |

---

# 5. Assumptions and limitations

## Assumptions

- **One answer sheet at a time**, per the brief. The pipeline is per-student.
- **Answers are written in reading order down the page.** The ink-band fallback relies on this;
  the primary path does not.
- **Handwriting is darker than the ruled lines.** The ink threshold adapts to contrast, but a
  pencil scan lighter than its own rulings would confuse it.
- **A question's marks are printed in brackets near its first line**, which is the common
  convention. Where they are not printed, the question defaults to 5 marks.
- **Uploads are ≤10MB**, enforced client-side to match the design and keep bodies within limits.
- **The UI follows the provided design reference**, including both sidebar states, the empty and
  filled upload states, the extracting state and the two-panel mapping screen. Colours and spacing
  were matched visually rather than exported as tokens, so individual pixel values may differ by a
  point or two; layout, states and hierarchy follow the design.

## Limitations — stated plainly

**Reading printed marks is the least reliable part of the pipeline.** Two distinct failures show
up against the fixture paper:

- a question that prints *no* marks gets a plausible number invented for it;
- a printed `[4]` is occasionally read as `1` — intermittent, not reproducible on demand.

Three rounds of prompt tightening did not reliably shift either on `gemini-2.5-flash`. **The same
paper has returned a total of 38 on one run and 42 on another.** Both are limited to a question's
*denominator* — mapping, highlighting and the earned score are unaffected — and
`scripts/test-pipeline.mjs` reports them every run as `KNOWN` issues rather than hiding them to
keep the suite green.

Interestingly, **neither reproduces on `gemini-3.1-flash-lite`**, which read every mark on the
fixture correctly including returning `null` for the one that prints none. Reading small marginal
digits is evidently model-specific rather than inherent.

**This is why both the awarded mark and the maximum are editable in place.** Click either number,
type, Enter. The awarded mark clamps to `0..max`; lowering a maximum below an already-awarded
score pulls that score down with it, so an impossible `5/3` cannot appear; the whole summary
recomputes. It covers every marks-reading error, not just these two, and costs no API calls.

**Other limits:**

- **Free-tier quota is tight.** 20 requests/day for `gemini-2.5-flash` on one project; a full run
  is three. The fallback chain extends this but at lower box accuracy. For heavy use, a key from a
  fresh Google Cloud project or enabled billing removes the cap.
- **Highlight accuracy depends on separation.** Boxes are tight on clearly separated answers; on a
  densely packed page where two answers share a line, a box may include a sliver of its neighbour.
- **Handwriting quality is the main accuracy driver.** A faint or heavily slanted scan degrades
  transcription, which weakens content-based matching for *unlabelled* answers. Label-based
  matching is unaffected.
- **Grading is indicative**, and presented as a proposal the teacher edits.

---

# 6. How this is verified

Four suites. Two need no API key at all, so they run anywhere.

```bash
npm run dev                               # in another terminal

node scripts/verify-requirements.mjs      # all 9 Requirements, with evidence
node scripts/verify-scope.mjs             # every Scope bullet, with evidence
node scripts/evaluate.mjs                 # measured accuracy vs ground truth
node scripts/test-pipeline.mjs            # the edge cases
node scripts/test-mapping.mjs             # label matching          (no API)
node scripts/test-boxes.mjs               # highlight accuracy      (no API)
```

Point any of them at the deployment with `BASE_URL=https://veda-ai-sigma-nine.vercel.app`.

## The fixtures are deliberately hostile

`scripts/make-fixtures.mjs` generates a 3-page question paper and a 5-page answer sheet — real
handwriting rendered in Segoe Script on ruled paper — containing, on purpose:

section headings that must not become questions · letter sub-parts 7(a)/(b), 9(a)/(b) · roman
sub-parts 10(i)/(ii)/(iii) · context-only stems that must fold into their sub-parts · a question
with no printed marks · a sheet that opens on Q4 · an answer crossing a page break with the number
never rewritten · six different label styles (`Q4.`, `Q1.`, bare `2.`, `Ans 6.`, `Q7(a)`,
`Q10 (ii)`) · sub-parts answered out of order among themselves · a sub-part answered while its
sibling is blank · an answer labelled with the **wrong** number · an unlabelled answer matchable
only by content · crossed-out rough work · an answer to a question not on the paper · a factually
wrong answer · a partially correct answer · four questions never attempted · a name/roll header.

It also writes `ground-truth.json` — the exact glyph bounds of every answer, recorded as they are
drawn — which is what makes highlight accuracy measurable rather than eyeballed.

## Measured results

```
verify-requirements  34/34 claims verified      ← also verified against the live deployment
verify-scope         23/23 claims verified
test-pipeline        35/35 checks passed (2 known marks issues, reported as KNOWN)
test-mapping         14/14 checks passed                              (no API)
test-boxes           0.883 → 0.980 mean IoU, 0 worsened; fallback 5/5 pages, 15/15 (no API)

evaluate.mjs
  100.0%  Question extraction — every question found         16/16, 0 spurious
  100.0%  Question extraction — printed order preserved      16/16 exact position
  100.0%  Question extraction — wording captured
  100.0%  Answer mapping — every answer on the right question 15/15
   98.6%  Highlighting — mean IoU 0.986, worst 0.956, 13/13 above 0.75
  100.0%  Edge cases handled                                 14/14
```

**What those numbers do and do not claim.** The deterministic parts — arithmetic, label matching,
summary consistency, box geometry — are exact and reproducible. The *model's* reading accuracy is
not something any harness can pin at 100%: it varies run to run, and the two marks-reading issues
above are live examples. That variance is the reason the marks are editable.

---

# 7. Project structure

```
app/
  page.js                orchestrates upload → extracting → mapping; owns teacher edits
  api/extract/route.js   three actions: questions | answers | map
components/
  Sidebar, TopBar        app shell, including the collapsed rail from the design
  UploadScreen           empty + filled states, drag/drop, 10MB guard
  ExtractingScreen       progress across the real stages
  QuestionPanel          question list, editable marks, AI feedback, grading summary
  AnswerSheetPanel       page viewer, zoom, colour-coded region highlighting
lib/
  files.js               PDF/image → page bitmaps, in the browser
  gemini.js              the three passes, the model fallback chain, response validation
  assemble.js            merge, deterministic safety net, grading summary
  refine.js              ink-mask box refinement + the band-derivation fallback
scripts/
  make-fixtures.mjs      the hostile test papers + ground truth
  verify-requirements.mjs / verify-scope.mjs / evaluate.mjs
  test-pipeline.mjs / test-mapping.mjs / test-boxes.mjs
```

## Highlights are colour-coded by marks

The green box the brief asks for is the *full marks* case. Two more states carry information a
teacher wants at a glance:

| Colour | Meaning |
|---|---|
| Green | Full marks |
| Amber | Partially correct |
| Red | Answered but earned nothing |

The tag shows the question label and score (`Q3 · 0/1`), with a legend in the panel header.
Because the colour derives from the *current* score, it updates the moment a teacher edits a mark.

## Deploying your own

Push to GitHub, import on Vercel, add `GEMINI_API_KEY` under **Settings → Environment Variables**.
No database, no auth — everything is in memory for the session.
