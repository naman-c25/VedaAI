"use client";

import { useCallback, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import UploadScreen from "@/components/UploadScreen";
import ExtractingScreen from "@/components/ExtractingScreen";
import QuestionPanel from "@/components/QuestionPanel";
import AnswerSheetPanel from "@/components/AnswerSheetPanel";
import { filesToPages, describeUpload } from "@/lib/files";
import { summarise } from "@/lib/assemble";
import { refineResult } from "@/lib/refine";

async function callApi(payload) {
  const res = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export default function Home() {
  const [stage, setStage] = useState("upload"); // upload | extracting | mapping
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [question, setQuestion] = useState(null); // { meta, pages }
  const [answer, setAnswer] = useState(null);

  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("");

  const [result, setResult] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const [expandedIds, setExpandedIds] = useState(new Set());

  const pick = useCallback(async (files, setter) => {
    setError("");
    setBusy(true);
    try {
      const pages = await filesToPages(files);
      setter({ meta: describeUpload(files, pages.length), pages });
    } catch (e) {
      setError(e.message || "That file could not be read.");
    } finally {
      setBusy(false);
    }
  }, []);

  async function start() {
    if (!question || !answer) return;
    setError("");
    setStage("extracting");
    setCollapsed(true);
    setProgress(8);
    setProgressStage("Reading the question paper…");

    try {
      const { questions } = await callApi({ action: "questions", pages: question.pages });

      setProgress(42);
      setProgressStage(`Found ${questions.length} questions · reading the answer sheet…`);
      const { blocks, student, highlightsUnavailable } = await callApi({
        action: "answers",
        pages: answer.pages,
      });

      setProgress(76);
      setProgressStage(`Found ${blocks.length} answers · mapping and grading…`);
      const assembled = await callApi({
        action: "map",
        questions,
        blocks,
        student,
        highlightsUnavailable,
      });

      setProgress(94);
      setProgressStage("Aligning highlights to the handwriting…");
      const refined = await refineResult(answer.pages, assembled);

      setProgress(100);
      setResult(refined);
      setActiveId(refined.questions[0]?.id ?? null);
      setExpandedIds(new Set(refined.questions[0] ? [refined.questions[0].id] : []));
      setStage("mapping");
    } catch (e) {
      setError(e.message || "Processing failed. Please try again.");
      setStage("upload");
      setCollapsed(false);
    }
  }

  function reset() {
    setStage("upload");
    setResult(null);
    setActiveId(null);
    setExpandedIds(new Set());
    setProgress(0);
    setError("");
    setCollapsed(false);
  }

  const allExpanded = useMemo(
    () => Boolean(result) && expandedIds.size === result.questions.length,
    [expandedIds, result]
  );

  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectQuestion(id) {
    setActiveId(id);
    setExpandedIds((prev) => new Set(prev).add(id));
  }

  /**
   * The teacher overrides the marks the AI awarded. Status is deliberately left
   * alone: it records whether an answer was *found* on the sheet, which stays
   * true even when the teacher decides the marks should differ.
   */
  function changeScore(id, nextScore) {
    setResult((prev) => {
      if (!prev) return prev;
      const questions = prev.questions.map((q) =>
        q.id === id
          ? { ...q, score: Math.min(Math.max(0, nextScore), q.maxScore), scoreEdited: true }
          : q
      );
      return {
        ...prev,
        questions,
        summary: summarise(questions, prev.unmatched, prev.summary),
      };
    });
  }

  /**
   * The teacher corrects a question's max marks. The earned score is clamped to
   * the new ceiling, and the whole grading summary is recomputed from it.
   */
  function changeMaxScore(id, nextMax) {
    setResult((prev) => {
      if (!prev) return prev;
      const questions = prev.questions.map((q) =>
        q.id === id
          ? { ...q, maxScore: nextMax, score: Math.min(q.score, nextMax), maxEdited: true }
          : q
      );
      return {
        ...prev,
        questions,
        summary: summarise(questions, prev.unmatched, prev.summary),
      };
    });
  }

  function expandAll() {
    if (!result) return;
    setExpandedIds(allExpanded ? new Set() : new Set(result.questions.map((q) => q.id)));
  }

  const activeQuestion = result?.questions.find((q) => q.id === activeId) ?? null;

  return (
    <div className="flex h-screen gap-3 p-3">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-white">
        <TopBar onBack={reset} canGoBack={stage !== "upload"} />

        {stage === "upload" && (
          <UploadScreen
            question={question?.meta ?? null}
            answer={answer?.meta ?? null}
            onPickQuestion={(files) => pick(files, setQuestion)}
            onPickAnswer={(files) => pick(files, setAnswer)}
            onClearQuestion={() => setQuestion(null)}
            onClearAnswer={() => setAnswer(null)}
            onStart={start}
            busy={busy}
            error={error}
          />
        )}

        {stage === "extracting" && (
          <ExtractingScreen stage={progressStage} progress={progress} />
        )}

        {stage === "mapping" && result && (
          <div className="canvas-wash flex min-h-0 flex-1 gap-3 p-3">
            <QuestionPanel
              questions={result.questions}
              unmatched={result.unmatched}
              summary={result.summary}
              activeId={activeId}
              expandedIds={expandedIds}
              onSelect={selectQuestion}
              onToggle={toggleExpand}
              onExpandAll={expandAll}
              onMaxScoreChange={changeMaxScore}
              onScoreChange={changeScore}
              allExpanded={allExpanded}
            />
            <AnswerSheetPanel
              pages={answer.pages}
              activeQuestion={activeQuestion}
              unmatched={result.unmatched}
              highlightsUnavailable={result.summary.highlightsUnavailable}
            />
          </div>
        )}
      </main>
    </div>
  );
}
