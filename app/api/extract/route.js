import { NextResponse } from "next/server";
import {
  extractQuestions,
  extractAnswers,
  mapAndGrade,
  describeQuotaError,
} from "@/lib/gemini";
import { assemble } from "@/lib/assemble";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * One endpoint, three actions. The client drives them in sequence so each
 * request carries only one document - that keeps every payload well under the
 * serverless body limit and gives the UI a genuine three-stage progress signal.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const { action } = body || {};

  try {
    if (action === "questions") {
      const pages = validPages(body.pages, "question paper");
      const questions = await extractQuestions(pages);
      if (questions.length === 0) {
        return NextResponse.json(
          { error: "No questions could be read from that question paper. Try a clearer scan." },
          { status: 422 }
        );
      }
      return NextResponse.json({ questions });
    }

    if (action === "answers") {
      const pages = validPages(body.pages, "answer sheet");
      const { blocks, student, highlightsUnavailable } = await extractAnswers(pages);
      // Zero blocks is a legitimate outcome - a blank sheet. The mapping stage
      // will report every question as unanswered.
      return NextResponse.json({ blocks, student, highlightsUnavailable });
    }

    if (action === "map") {
      const questions = Array.isArray(body.questions) ? body.questions : [];
      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      if (questions.length === 0) {
        return NextResponse.json({ error: "No questions to map against." }, { status: 400 });
      }
      const student = body.student || {};
      const mapping =
        blocks.length > 0
          ? await mapAndGrade(questions, blocks, student)
          : { results: [], unmatchedBlocks: [], overallFeedback: "" };
      return NextResponse.json(
        assemble(questions, blocks, mapping, student, Boolean(body.highlightsUnavailable))
      );
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    const message = error?.message || "Something went wrong while processing the upload.";
    const status = error?.status ?? error?.code;
    const quota = status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(message);

    if (quota) {
      // Every fallback model was exhausted too, so say what actually ran out.
      // A per-day cap is not something waiting a minute will fix.
      const q = describeQuotaError(error);
      const detail = q?.limit
        ? q.perDay
          ? `The Gemini free tier allows ${q.limit} requests per day for ${q.model || "this model"}, and today's are used up. It resets at midnight Pacific time.`
          : `The Gemini free-tier rate limit (${q.limit} requests) was hit. Wait a minute and try again.`
        : "The Gemini free-tier quota is exhausted for every available model.";
      return NextResponse.json(
        { error: `${detail} You can also add billing to the Google Cloud project, or use a key from a different project.` },
        { status: 429 }
      );
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function validPages(pages, what) {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`No ${what} pages were received.`);
  }
  for (const p of pages) {
    if (!p?.dataUrl || typeof p.dataUrl !== "string" || !p.dataUrl.startsWith("data:")) {
      throw new Error(`A ${what} page could not be read.`);
    }
  }
  return pages;
}
