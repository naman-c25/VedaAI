/**
 * Builds a deliberately hostile test pair: a 3-page question paper and a 5-page
 * handwritten answer sheet, written out as both JPEGs (fixtures/, for the
 * automated test) and PDFs (for uploading through the real UI).
 *
 *   node scripts/make-fixtures.mjs [outputDir]
 *
 * Edge cases baked in — see EDGE_CASES at the bottom for the full ledger.
 */
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const W = 1400;
const H = 1980;
const FIXTURES = join(process.cwd(), "fixtures");
const OUT_DIR = process.argv[2] || FIXTURES;

let HAND = "Georgia, serif";
for (const [file, family] of [
  ["C:/Windows/Fonts/segoesc.ttf", "Segoe Script"],
  ["C:/Windows/Fonts/Inkfree.ttf", "Ink Free"],
  ["C:/Windows/Fonts/comic.ttf", "Comic Sans MS"],
]) {
  if (existsSync(file)) {
    try {
      GlobalFonts.registerFromPath(file, family);
      HAND = family;
      break;
    } catch {}
  }
}

function wrap(c, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (c.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/* ============================== QUESTION PAPER ============================== */

function questionPage(blocks, { pageNo, total, header }) {
  const canvas = createCanvas(W, H);
  const c = canvas.getContext("2d");
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, H);
  c.fillStyle = "#000000";

  let y = 92;
  if (header) {
    c.textAlign = "center";
    c.font = "bold 40px Georgia, serif";
    c.fillText("Class 10 — Science Unit Test", W / 2, y);
    y += 44;
    c.font = "24px Georgia, serif";
    c.fillText("Time: 2 hours", W / 2, y);
    c.textAlign = "left";
    y += 26;
    c.lineWidth = 2;
    c.strokeStyle = "#000";
    c.beginPath();
    c.moveTo(90, y);
    c.lineTo(W - 90, y);
    c.stroke();
    y += 34;
    c.font = "italic 22px Georgia, serif";
    c.fillText("Answer all questions. Draw diagrams where asked.", 90, y);
    y += 52;
  }

  for (const b of blocks) {
    if (b.section) {
      // A section heading must never be extracted as a question.
      y += 8;
      c.font = "bold 27px Georgia, serif";
      c.fillText(b.section, 90, y);
      y += 44;
      continue;
    }

    c.font = "bold 26px Georgia, serif";
    const x = 90 + (b.depth || 0) * 46;
    c.fillText(b.label, x, y);

    c.font = "26px Georgia, serif";
    const textX = x + (b.depth ? 74 : 62);
    let ty = y;
    for (const line of wrap(c, b.text, W - textX - 150)) {
      c.fillText(line, textX, ty);
      ty += 36;
    }

    if (b.marks != null) {
      c.font = "bold 24px Georgia, serif";
      c.textAlign = "right";
      c.fillText(`[${b.marks}]`, W - 90, y);
      c.textAlign = "left";
    }
    y = ty + 22;
  }

  c.font = "22px Georgia, serif";
  c.fillStyle = "#555";
  c.textAlign = "center";
  c.fillText(`Page ${pageNo} of ${total}`, W / 2, H - 58);
  return canvas;
}

const PAPER = [
  [
    { section: "SECTION A — Very Short Answer" },
    { label: "1.", text: "Which blood vessel carries blood away from the heart?", marks: 1 },
    { label: "2.", text: "Name the green pigment found in chloroplasts.", marks: 1 },
    { label: "3.", text: "State the SI unit of electrical resistance.", marks: 1 },
    { section: "SECTION B — Short Answer" },
    {
      label: "4.",
      text: "Explain the role of chloroplasts in photosynthesis, naming the main pigment involved and outlining the two major stages of the process.",
      marks: 3,
    },
    {
      label: "5.",
      text: "Draw a labelled diagram of an alveolus showing the capillary network and the air space.",
      marks: 3,
    },
  ],
  [
    {
      label: "6.",
      text: "Describe the flow of blood through the human heart, starting from the right atrium and ending at the aorta. Name each valve crossed.",
      marks: 5,
    },
    {
      label: "7.",
      text: "A resting person has a tidal volume of 0.5 litres and breathes 12 times per minute.",
    },
    {
      label: "(a)",
      text: "Calculate the pulmonary ventilation rate per minute. Show your working.",
      marks: 2,
      depth: 1,
    },
    {
      label: "(b)",
      text: "Explain what happens to this rate during vigorous exercise, and why.",
      marks: 3,
      depth: 1,
    },
    {
      label: "8.",
      text: "Explain the structural differences between palisade mesophyll and spongy mesophyll, and state how each supports its function in the leaf.",
    },
  ],
  [
    { section: "SECTION C — Long Answer" },
    {
      label: "9.",
      text: "Two potted plants are compared. Plant A is kept in bright light and has broad green leaves. Plant B is kept in dim light and has pale, elongated leaves.",
    },
    {
      label: "(a)",
      text: "State which plant is photosynthesising more efficiently, and give one reason.",
      marks: 2,
      depth: 1,
    },
    {
      label: "(b)",
      text: "Suggest one practical measure that would help Plant B recover, and explain why it works.",
      marks: 3,
      depth: 1,
    },
    { label: "10.", text: "Answer the following about the human excretory system." },
    { label: "(i)", text: "Name the functional unit of the kidney.", marks: 1, depth: 1 },
    {
      label: "(ii)",
      text: "Describe how filtration occurs in the Bowman's capsule.",
      marks: 4,
      depth: 1,
    },
    {
      label: "(iii)",
      text: "State one substance that is reabsorbed in the proximal tubule.",
      marks: 1,
      depth: 1,
    },
    { label: "11.", text: "Define resistance and state Ohm's law.", marks: 3 },
    {
      label: "12.",
      text: "Describe two adaptations of a leaf that make it efficient at photosynthesis.",
      marks: 4,
    },
  ],
];

/* =============================== ANSWER SHEET =============================== */

/** The student's name/roll header, as it appears on a real answer sheet. */
const STUDENT = { name: "Aarav Mehta", roll: "17" };

function ruledPage({ header = false } = {}) {
  const canvas = createCanvas(W, H);
  const c = canvas.getContext("2d");
  c.fillStyle = "#fdfdf8";
  c.fillRect(0, 0, W, H);

  c.strokeStyle = "#c3d0e0";
  c.lineWidth = 1.6;
  for (let y = 150; y < H - 90; y += 54) {
    c.beginPath();
    c.moveTo(112, y + 8);
    c.lineTo(W - 70, y + 8);
    c.stroke();
  }
  c.strokeStyle = "#dba0a0";
  c.lineWidth = 2.5;
  c.beginPath();
  c.moveTo(112, 60);
  c.lineTo(112, H - 60);
  c.stroke();

  if (header) {
    // Sits well clear of the first answer, so the band-splitting in lib/refine.js
    // has to keep it out of that answer's box.
    c.fillStyle = "#1c3f8a";
    c.font = `28px ${HAND}`;
    c.fillText(`Name: ${STUDENT.name}`, 132, 110);
    c.fillText(`Roll No: ${STUDENT.roll}`, 800, 110);
  }

  return { canvas, c };
}

/**
 * Writes one answer block and records the exact pixel bounds of the glyphs it
 * drew. Those bounds are the ground truth the box-accuracy test measures against.
 * Returns the y to continue from, plus the block's true rect as percentages.
 */
function writeAnswer(c, { label, lines, strike }, y) {
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const track = (x, text, baseline) => {
    const m = c.measureText(text);
    b.minX = Math.min(b.minX, x);
    b.maxX = Math.max(b.maxX, x + m.width);
    b.minY = Math.min(b.minY, baseline - (m.actualBoundingBoxAscent ?? 24));
    b.maxY = Math.max(b.maxY, baseline + (m.actualBoundingBoxDescent ?? 8));
  };

  c.fillStyle = "#1c3f8a";
  if (label) {
    c.font = `34px ${HAND}`;
    c.fillText(label, 132, y);
    track(132, label, y);
    y += 52;
  }
  c.font = `30px ${HAND}`;
  for (const raw of lines) {
    for (const line of wrap(c, raw, W - 330)) {
      c.fillText(line, 168, y);
      track(168, line, y);
      if (strike) {
        const w = c.measureText(line).width;
        c.strokeStyle = "#1c3f8a";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(168, y - 10);
        c.lineTo(168 + w, y - 10);
        c.stroke();
      }
      y += 54;
    }
  }

  return {
    y: y + 42,
    rect: {
      top: (b.minY / H) * 100,
      left: (b.minX / W) * 100,
      height: ((b.maxY - b.minY) / H) * 100,
      width: ((b.maxX - b.minX) / W) * 100,
    },
  };
}

const SHEET = [
  // ---- page 1: starts at Q4 (out of order), then Q1, then a bare "2."
  [
    {
      label: "Q4.",
      lines: [
        "Chloroplasts are the site of photosynthesis in the plant cell.",
        "They contain the green pigment chlorophyll which absorbs",
        "light energy, mainly from the red and blue parts of the",
        "spectrum. Photosynthesis takes place in two main stages.",
        "The first is the light reaction, which happens in the",
      ],
    },
    {
      label: "Q1.",
      lines: [
        "Arteries carry blood away from the heart. The aorta is the",
        "largest artery and carries oxygenated blood to the body.",
      ],
    },
    {
      label: "2.",
      lines: ["The green pigment is chlorophyll."],
    },
  ],
  // ---- page 2: continuation with no label, a sub-part, a partially correct answer
  [
    {
      label: null,
      lines: [
        "thylakoid membranes. Light energy splits water and produces",
        "ATP and NADPH, and oxygen is given off as a waste product.",
        "The second stage is the Calvin cycle in the stroma, which",
        "uses ATP to fix carbon dioxide into glucose.",
      ],
    },
    {
      label: "Q9 (b)",
      lines: [
        "Move Plant B into bright sunlight. With more light energy",
        "available the rate of photosynthesis increases, so the plant",
        "produces more glucose and its leaves become green again.",
      ],
    },
    {
      label: "Ans 6.",
      lines: [
        "Blood enters the right atrium from the vena cava, then goes",
        "to the right ventricle and out to the lungs. It comes back",
        "to the left atrium, then the left ventricle, and leaves",
        "through the aorta to the body.",
      ],
    },
  ],
  // ---- page 3: roman sub-parts out of order, a calculation, crossed-out rough work
  [
    {
      label: "Q10 (ii)",
      lines: [
        "Blood at high pressure enters the glomerulus. The pressure",
        "forces water, glucose, salts and urea through the capillary",
        "wall into the Bowman's capsule. This is ultrafiltration.",
        "Large molecules like proteins and blood cells stay behind.",
      ],
    },
    {
      label: "Q10 (i)",
      lines: ["The functional unit of the kidney is the nephron."],
    },
    {
      label: "Q7(a)",
      lines: [
        "Pulmonary ventilation = tidal volume x breathing rate",
        "= 0.5 x 12",
        "= 6 litres per minute",
      ],
    },
    {
      label: null,
      strike: true,
      lines: ["12 x 5 = 60 no wait thats wrong", "0.5 x 12"],
    },
  ],
  // ---- page 4: wrong label, an unlabelled answer, a factually wrong answer
  [
    {
      label: "Q9.",
      lines: [
        "Resistance is the opposition offered by a conductor to the",
        "flow of electric current. Ohm's law states that the current",
        "through a conductor is directly proportional to the potential",
        "difference across it, provided temperature stays constant.",
        "V = IR",
      ],
    },
    {
      label: null,
      lines: [
        "An alveolus is a tiny air sac in the lung. It is surrounded",
        "by a dense network of capillaries. Oxygen diffuses from the",
        "air space into the blood and carbon dioxide diffuses out.",
        "The wall is only one cell thick to speed up diffusion.",
      ],
    },
    {
      label: "Q3.",
      lines: ["The SI unit of resistance is the Watt."],
    },
  ],
  // ---- page 5: an answer to a question that does not exist, and the unmarked question
  [
    {
      label: "Q13.",
      lines: [
        "Newton's second law states that force equals mass times",
        "acceleration, F = ma.",
      ],
    },
    {
      label: "Q8.",
      lines: [
        "Palisade mesophyll cells are long and packed tightly near the",
        "top of the leaf and they have many chloroplasts, so they",
        "absorb most of the light. Spongy mesophyll cells are round",
        "and loosely packed with big air spaces between them, which",
        "lets gases diffuse easily to and from the cells.",
      ],
    },
  ],
];

/* ================================== BUILD ================================== */

function renderAnswerPage(blocks, { header = false } = {}) {
  const { canvas, c } = ruledPage({ header });
  let y = 186;
  const truth = [];
  for (const b of blocks) {
    const { y: next, rect } = writeAnswer(c, b, y);
    truth.push({ label: b.label, isRoughWork: Boolean(b.strike), rect });
    y = next;
  }
  return { canvas, truth };
}

async function toPdf(canvases) {
  const pdf = await PDFDocument.create();
  for (const canvas of canvases) {
    const jpg = await pdf.embedJpg(canvas.toBuffer("image/jpeg", 0.86));
    const page = pdf.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
  }
  return Buffer.from(await pdf.save());
}

const qCanvases = PAPER.map((blocks, i) =>
  questionPage(blocks, { pageNo: i + 1, total: PAPER.length, header: i === 0 })
);
const rendered = SHEET.map((blocks, i) => renderAnswerPage(blocks, { header: i === 0 }));
const aCanvases = rendered.map((r) => r.canvas);
const groundTruth = rendered.map((r, i) => ({ page: i + 1, blocks: r.truth }));

mkdirSync(FIXTURES, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

// JPEGs for the automated test
qCanvases.forEach((cv, i) =>
  writeFileSync(join(FIXTURES, `question-p${i + 1}.jpg`), cv.toBuffer("image/jpeg", 0.86))
);
aCanvases.forEach((cv, i) =>
  writeFileSync(join(FIXTURES, `answer-p${i + 1}.jpg`), cv.toBuffer("image/jpeg", 0.86))
);

// True glyph bounds for every answer block, for the box-accuracy test
writeFileSync(
  join(FIXTURES, "ground-truth.json"),
  JSON.stringify({ width: W, height: H, pages: groundTruth }, null, 2)
);

// PDFs for uploading through the UI
writeFileSync(join(OUT_DIR, "Class10_Science_Question_Paper.pdf"), await toPdf(qCanvases));
writeFileSync(join(OUT_DIR, "Student_Answer_Sheet.pdf"), await toPdf(aCanvases));

console.log(`handwriting font : ${HAND}`);
console.log(`question paper   : ${qCanvases.length} pages`);
console.log(`answer sheet     : ${aCanvases.length} pages`);
console.log(`PDFs written to  : ${OUT_DIR}`);

export const STUDENT_ON_SHEET = STUDENT;

export const EDGE_CASES = [
  "a name/roll header that must be read as the student, not as an answer",
  "section headings that must not become questions",
  "letter sub-parts 7(a)/7(b) and 9(a)/9(b) as separate entries",
  "roman sub-parts 10(i)/(ii)/(iii) as separate entries",
  "a parent stem (7, 9, 10) that carries context but no answerable prompt",
  "a question with no printed marks (8) — must fall back to a default",
  "answers written out of order (sheet opens on Q4)",
  "an answer spanning a page break with no number rewritten",
  "varied label formats: 'Q4.', 'Q1.', bare '2.', 'Ans 6.', 'Q7(a)', 'Q10 (ii)'",
  "sub-parts answered out of order among themselves (10(ii) before 10(i))",
  "a sub-part answered while its sibling is left blank (9(b) without 9(a))",
  "an answer labelled with the WRONG number (written 'Q9', actually answers 11)",
  "an unlabelled answer that must be matched on content alone (the alveolus one)",
  "crossed-out rough work that should match nothing",
  "an answer to a question not on the paper (Q13)",
  "a factually wrong answer (3 — 'Watt') that should score 0 with corrective feedback",
  "a partially correct answer (6 — omits every valve name) for partial credit",
  "questions never attempted at all (7(b), 9(a), 10(iii), 12)",
];
