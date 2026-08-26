"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus, AlertTriangle } from "lucide-react";

const ZOOM_STEPS = [60, 80, 100, 125, 150, 200];

/**
 * Highlight colour follows the marks, so a teacher can see at a glance whether
 * the answer they are looking at earned everything, something, or nothing.
 * Class strings are written out in full because Tailwind only emits classes it
 * can see literally in the source.
 */
const TONES = {
  ok: { box: "border-ok bg-ok/12", tag: "bg-ok", dot: "bg-ok", label: "Full marks" },
  warn: { box: "border-warn bg-warn/12", tag: "bg-warn", dot: "bg-warn", label: "Partial" },
  bad: { box: "border-bad bg-bad/12", tag: "bg-bad", dot: "bg-bad", label: "No marks" },
};

function toneFor(q) {
  if (!q) return "warn";
  if (q.maxScore > 0 && q.score >= q.maxScore) return "ok";
  if (q.score <= 0) return "bad";
  return "warn";
}

export default function AnswerSheetPanel({
  pages,
  activeQuestion,
  unmatched,
  highlightsUnavailable,
  highlightsEstimated = 0,
}) {
  const scrollRef = useRef(null);
  const pageRefs = useRef([]);
  const regionRefs = useRef({});
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);

  const regions = activeQuestion?.regions || [];
  const tone = TONES[toneFor(activeQuestion)];

  // Bring the selected answer into view. Runs whenever the selection changes.
  useEffect(() => {
    const first = regions.find((r) => r.rect);
    if (!first) return;
    const el = regionRefs.current[first.blockId];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeQuestion?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the "Page n of m" counter honest as the teacher scrolls.
  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const mid = container.scrollTop + container.clientHeight / 2;
    let page = 1;
    pageRefs.current.forEach((el, i) => {
      if (el && el.offsetTop <= mid) page = i + 1;
    });
    setCurrentPage(page);
  }

  function step(direction) {
    const i = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, i + direction))];
    setZoom(next);
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-line bg-white">
      <div className="flex h-11.5 shrink-0 items-center gap-3 border-b border-line px-4">
        <h2 className="text-[14px] font-bold">Answer Sheet</h2>

        <div className="ml-1 flex items-center gap-2.5">
          {["ok", "warn", "bad"].map((key) => (
            <span key={key} className="flex items-center gap-1 text-[11px] font-medium text-muted">
              <span className={`h-2 w-2 rounded-full ${TONES[key].dot}`} />
              {TONES[key].label}
            </span>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-1 rounded-full border border-line px-1 py-0.5">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={zoom === ZOOM_STEPS[0]}
            className="grid h-5 w-5 place-items-center rounded-full text-[#6f6f6f] transition enabled:hover:bg-[#f4f4f4] disabled:text-[#d0d0d0]"
            aria-label="Zoom out"
          >
            <Minus size={12} />
          </button>
          <span className="min-w-8.5 text-center text-[12px] font-semibold tabular-nums">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            className="grid h-5 w-5 place-items-center rounded-full text-[#6f6f6f] transition enabled:hover:bg-[#f4f4f4] disabled:text-[#d0d0d0]"
            aria-label="Zoom in"
          >
            <Plus size={12} />
          </button>
        </div>

        <span className="rounded-full border border-line px-2.5 py-1 text-[12px] font-semibold text-[#5f5f5f]">
          Page {currentPage} of {pages.length}
        </span>
      </div>

      {(highlightsUnavailable || highlightsEstimated > 0) && (
        <div className="flex shrink-0 items-start gap-2 border-b border-[#f0ddc2] bg-[#fffaf1] px-4 py-2.5 text-[12.5px] leading-normal text-[#8a5c10]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            {highlightsUnavailable ? (
              <>
                The answers were read and graded, but their positions on the page could not be
                recovered this time, so nothing can be highlighted. Everything on the left is
                still accurate. Running it again usually fixes it.
              </>
            ) : (
              <>
                {highlightsEstimated} highlight{highlightsEstimated === 1 ? " was" : "s were"}{" "}
                placed by matching the writing on the page, because the model did not return
                {highlightsEstimated === 1 ? " its" : " their"} position. Those are drawn with a
                dashed border.
              </>
            )}
          </span>
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-thin flex-1 overflow-auto bg-[#f7f7f7] px-4 py-4"
      >
        <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `${zoom}%` }}>
          {pages.map((page, i) => {
            const pageNo = i + 1;
            // Answers the model could not locate have no rect and simply are not drawn.
            const onThisPage = regions.filter((r) => r.page === pageNo && r.rect);
            const strays = unmatched.filter((u) => u.page === pageNo && u.rect);

            return (
              <div
                key={pageNo}
                ref={(el) => (pageRefs.current[i] = el)}
                className="relative w-full overflow-hidden rounded-lg bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.dataUrl}
                  alt={`Answer sheet page ${pageNo}`}
                  className="block w-full select-none"
                  draggable={false}
                />

                {/* Answers that map to no question - faint, never competing with the selection */}
                {strays.map((u) => (
                  <div
                    key={u.blockId}
                    title={u.reason}
                    className="pointer-events-none absolute rounded-md border border-dashed border-[#c0c0c0] bg-[#9a9a9a]/5"
                    style={{
                      top: `${u.rect.top}%`,
                      left: `${u.rect.left}%`,
                      width: `${u.rect.width}%`,
                      height: `${u.rect.height}%`,
                    }}
                  />
                ))}

                {/* The selected question's answer region(s) */}
                {onThisPage.map((r) => (
                  <div
                    key={r.blockId}
                    ref={(el) => (regionRefs.current[r.blockId] = el)}
                    className={`pointer-events-none absolute rounded-md border-2 transition-all duration-300 ${tone.box} ${
                      r.derived ? "border-dashed" : ""
                    }`}
                    // The rect hugs the ink exactly; a fixed pixel outset keeps
                    // the border off the glyphs without distorting the geometry.
                    style={{
                      top: `calc(${r.rect.top}% - 4px)`,
                      left: `calc(${r.rect.left}% - 5px)`,
                      width: `calc(${r.rect.width}% + 10px)`,
                      height: `calc(${r.rect.height}% + 8px)`,
                    }}
                  >
                    <span
                      className={`absolute -top-2.25 left-1 rounded px-1.5 py-px text-[11px] font-bold leading-3.5 text-white ${tone.tag}`}
                    >
                      {shortLabel(activeQuestion.label)}
                      {r.isContinuation ? " cont." : ""}
                      {" · "}
                      {activeQuestion.score}/{activeQuestion.maxScore}
                    </span>
                  </div>
                ))}

                <span className="absolute bottom-1.5 right-2 rounded bg-black/35 px-1.5 py-px text-[11px] font-semibold text-white">
                  {pageNo}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function shortLabel(label) {
  if (!label) return "Q";
  const clean = String(label).replace(/^q\.?\s*/i, "").trim();
  return `Q${clean}`;
}
