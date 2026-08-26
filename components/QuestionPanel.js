"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  FileWarning,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

/**
 * A marks figure the teacher can correct in place. Used for both halves of the
 * score: the marks awarded and the maximum. The AI proposes; the teacher decides.
 * Click to edit, Enter to commit, Escape to revert.
 */
function NumberField({ value, max, edited, onCommit, title, muted, align = "left" }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  function commit() {
    const next = Number.parseFloat(draft);
    if (Number.isFinite(next) && next >= 0) onCommit(Math.min(next, max));
    else setDraft(String(value));
  }

  const tone = edited ? "text-brand" : muted ? "text-[#b0b0b0]" : "text-[#4a4a4a]";

  return (
    <input
      type="number"
      min="0"
      max={max}
      step="0.5"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(String(value));
          e.currentTarget.blur();
        }
      }}
      title={edited ? `${title} — you changed this` : title}
      className={`w-8 rounded border border-transparent bg-transparent text-[14px] font-bold tabular-nums outline-none transition [appearance:textfield] hover:border-[#d8d8d8] hover:bg-white focus:border-brand focus:bg-white focus:ring-1 focus:ring-brand/30 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${
        align === "right" ? "text-right" : "text-left"
      } ${tone}`}
    />
  );
}

function QuestionRow({ q, index, active, expanded, onSelect, onToggle, onMaxScoreChange, onScoreChange }) {
  const unanswered = q.status === "unanswered";
  const multiPage = q.pages.length > 1;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelect(q.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(q.id);
          }
        }}
        className={`cursor-pointer rounded-xl border px-3 py-2.5 transition ${
          active
            ? "border-brand bg-brand-tint shadow-[0_0_0_1px_rgba(255,107,53,0.25)]"
            : "border-line bg-white hover:border-[#dcdcdc] hover:bg-[#fcfcfc]"
        }`}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={`mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold ${
              active ? "bg-brand text-white" : "bg-[#f0f0f0] text-[#5f5f5f]"
            }`}
          >
            {q.number ?? index + 1}
          </span>

          {q.subpart && (
            <span className="mt-0.5 shrink-0 text-[13px] font-bold text-[#5f5f5f]">
              {q.subpart}.
            </span>
          )}

          <p className="min-w-0 flex-1 text-[13px] leading-normal text-[#3f3f3f]">{q.text}</p>

          <span className="mt-px flex shrink-0 items-center">
            <NumberField
              value={q.score}
              max={q.maxScore}
              edited={q.scoreEdited}
              muted={unanswered && !q.scoreEdited}
              align="right"
              title="Marks awarded"
              onCommit={(next) => onScoreChange(q.id, next)}
            />
            <span className="px-0.5 text-[14px] font-bold text-[#c4c4c4]">/</span>
            <NumberField
              value={q.maxScore}
              max={100}
              edited={q.maxEdited}
              title="Max marks"
              onCommit={(next) => onMaxScoreChange(q.id, next)}
            />
          </span>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(q.id);
            }}
            className="mt-px grid h-4.5 w-4.5 shrink-0 place-items-center rounded text-[#9a9a9a] transition hover:bg-black/5"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronDown
              size={14}
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {(unanswered || multiPage || q.confidence === "low") && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-8">
            {unanswered && (
              <span className="rounded-full bg-[#f3f3f3] px-2 py-0.5 text-[11px] font-semibold text-[#8b8b8b]">
                Unanswered
              </span>
            )}
            {multiPage && (
              <span className="rounded-full bg-[#eef6ff] px-2 py-0.5 text-[11px] font-semibold text-[#3b7bc4]">
                Spans pages {q.pages.join("–")}
              </span>
            )}
            {q.confidence === "low" && !unanswered && (
              <span className="rounded-full bg-[#fff5e6] px-2 py-0.5 text-[11px] font-semibold text-[#b07203]">
                Low-confidence match
              </span>
            )}
          </div>
        )}

        {expanded && (
          <div className="mt-2.5 rounded-lg bg-white/70 px-2.5 py-2">
            <p className="flex items-center gap-1 text-[12px] font-bold text-ink">
              <Sparkles size={12} className="text-brand" fill="currentColor" />
              AI Feedback
            </p>
            <p className="mt-1 text-[13px] leading-[1.6] text-[#5f5f5f]">{q.feedback}</p>

            {q.missing.length > 0 && (
              <div className="mt-2.5 rounded-md border border-[#f0ddc2] bg-[#fffaf1] px-2.5 py-2">
                <p className="text-[12px] font-bold text-[#9a6510]">
                  Why {round1(q.maxScore - q.score)} of {q.maxScore} marks were lost
                </p>
                <ul className="mt-1.5 space-y-1">
                  {q.missing.map((point, i) => (
                    <li key={i} className="flex gap-1.5 text-[12.5px] leading-[1.55] text-[#7d5c1c]">
                      <span aria-hidden className="text-[#caa25c]">•</span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * The grading summary answers three questions a teacher actually asks:
 * what did they score, where did the marks go, and what should I reteach.
 * Sections only render when the model produced them, so the card never shows
 * an empty heading.
 */
function GradingSummary({ summary }) {
  const { totalScore, maxScore, percentage, marksLost, lostMarks, strengths, gaps } = summary;
  const dropped = (lostMarks || []).filter((q) => q.lost > 0);

  return (
    <div className="rounded-xl border border-line bg-[#fcfcfc] p-3.5">
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
        <Sparkles size={13} className="text-brand" fill="currentColor" />
        Grading Summary
      </p>

      {summary.student?.name && (
        <p className="mt-1 text-[13px] font-semibold text-[#5f5f5f]">
          {summary.student.name}
          {summary.student.roll && (
            <span className="font-medium text-muted"> · Roll {summary.student.roll}</span>
          )}
        </p>
      )}

      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="text-[26px] font-extrabold leading-none tabular-nums">
          {totalScore}
          <span className="text-[15px] font-bold text-muted">/{maxScore}</span>
        </span>
        <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-bold text-brand">
          {percentage}%
        </span>
        {marksLost > 0 && (
          <span className="text-[12px] font-semibold text-[#9a6510]">
            {round1(marksLost)} marks lost
          </span>
        )}
      </div>

      {summary.overallFeedback && (
        <p className="mt-2.5 text-[13px] leading-[1.6] text-[#5f5f5f]">
          {summary.overallFeedback}
        </p>
      )}

      {strengths?.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#2f7d43]">
            <CheckCircle2 size={13} />
            Understands well
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {strengths.map((s, i) => (
              <span
                key={i}
                className="rounded-full bg-[#eaf6ec] px-2.5 py-1 text-[12px] font-medium text-[#2f7d43]"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {gaps?.length > 0 && (
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#9a6510]">
            <AlertTriangle size={13} />
            Needs reteaching
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {gaps.map((g, i) => (
              <span
                key={i}
                className="rounded-full bg-[#fdf3e3] px-2.5 py-1 text-[12px] font-medium text-[#9a6510]"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}

      {dropped.length > 0 && (
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="text-[12px] font-bold text-[#5f5f5f]">Where the marks went</p>
          <ul className="mt-1.5 space-y-1">
            {dropped.map((q) => (
              <li key={q.label} className="flex gap-2 text-[12.5px] leading-normal">
                <span className="w-14 shrink-0 font-bold text-[#4a4a4a]">Q{q.label}</span>
                <span className="w-10 shrink-0 font-semibold text-[#9a6510] tabular-nums">
                  −{q.lost}
                </span>
                <span className="min-w-0 flex-1 text-[#7a7a7a]">
                  {q.status === "unanswered"
                    ? "Not attempted"
                    : q.missing.length > 0
                      ? q.missing.join("; ")
                      : "Partially correct"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function QuestionPanel({
  questions,
  unmatched,
  summary,
  activeId,
  expandedIds,
  onSelect,
  onToggle,
  onExpandAll,
  onMaxScoreChange,
  onScoreChange,
  allExpanded,
}) {
  return (
    <section className="flex w-115 shrink-0 flex-col rounded-2xl border border-line bg-white">
      <div className="flex h-11.5 shrink-0 items-center gap-3 border-b border-line px-4">
        <h2 className="text-[13.5px] font-bold">
          Extracted Questions{" "}
          <span className="font-medium text-muted">(from question paper)</span>
        </h2>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onExpandAll}
          className="rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-[#5f5f5f] transition hover:bg-[#f6f6f6]"
        >
          {allExpanded ? "Collapse All" : "Expand All"}
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-line px-4 py-2.5">
        <span className="text-[18px] font-extrabold tabular-nums">
          {summary.totalScore}
          <span className="text-[13px] font-bold text-muted">/{summary.maxScore}</span>
        </span>
        <span className="h-4 w-px bg-line" />
        <span className="text-[12px] font-semibold text-[#5f5f5f]">
          {summary.answered} answered
        </span>
        {summary.unanswered > 0 && (
          <span className="text-[12px] font-semibold text-[#b0b0b0]">
            {summary.unanswered} unanswered
          </span>
        )}
        {summary.unmatched > 0 && (
          <span className="text-[12px] font-semibold text-[#b07203]">
            {summary.unmatched} unmatched
          </span>
        )}
        <span className="ml-auto text-[12px] font-bold text-brand">{summary.percentage}%</span>
      </div>

      <ul className="scroll-thin flex-1 space-y-1.5 overflow-y-auto p-3">
        {questions.map((q, i) => (
          <QuestionRow
            key={q.id}
            q={q}
            index={i}
            active={activeId === q.id}
            expanded={expandedIds.has(q.id)}
            onSelect={onSelect}
            onToggle={onToggle}
            onMaxScoreChange={onMaxScoreChange}
            onScoreChange={onScoreChange}
          />
        ))}

        {unmatched.length > 0 && (
          <li className="pt-3">
            <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12px] font-bold text-[#8b8b8b]">
              <FileWarning size={12} />
              Answers with no matching question ({unmatched.length})
            </p>
            <ul className="space-y-1.5">
              {unmatched.map((u) => (
                <li
                  key={u.blockId}
                  className="rounded-xl border border-dashed border-[#e0e0e0] bg-[#fafafa] px-3 py-2"
                >
                  <p className="text-[12px] font-semibold text-[#5f5f5f]">
                    {u.label ? `Labelled "${u.label}"` : "Unlabelled answer"} · page {u.page}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[12px] leading-normal text-[#8b8b8b]">
                    {u.text || u.reason}
                  </p>
                </li>
              ))}
            </ul>
          </li>
        )}

        <li className="pt-3">
          <GradingSummary summary={summary} />
        </li>
      </ul>
    </section>
  );
}
