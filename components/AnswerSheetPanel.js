"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";

const ZOOM_STEPS = [60, 80, 100, 125, 150, 200];

export default function AnswerSheetPanel({ pages, activeQuestion, unmatched }) {
  const scrollRef = useRef(null);
  const pageRefs = useRef([]);
  const regionRefs = useRef({});
  const [zoom, setZoom] = useState(100);
  const [currentPage, setCurrentPage] = useState(1);

  const regions = activeQuestion?.regions || [];

  // Bring the selected answer into view. Runs whenever the selection changes.
  useEffect(() => {
    if (regions.length === 0) return;
    const first = regions[0];
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

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="scroll-thin flex-1 overflow-auto bg-[#f7f7f7] px-4 py-4"
      >
        <div className="mx-auto flex flex-col items-center gap-4" style={{ width: `${zoom}%` }}>
          {pages.map((page, i) => {
            const pageNo = i + 1;
            const onThisPage = regions.filter((r) => r.page === pageNo);
            const strays = unmatched.filter((u) => u.page === pageNo);

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
                    className="pointer-events-none absolute rounded-md border-2 border-ok bg-ok/12 transition-all duration-300"
                    // The rect hugs the ink exactly; a fixed pixel outset keeps
                    // the border off the glyphs without distorting the geometry.
                    style={{
                      top: `calc(${r.rect.top}% - 4px)`,
                      left: `calc(${r.rect.left}% - 5px)`,
                      width: `calc(${r.rect.width}% + 10px)`,
                      height: `calc(${r.rect.height}% + 8px)`,
                    }}
                  >
                    <span className="absolute -top-2.25 left-1 rounded bg-ok px-1.5 py-px text-[11px] font-bold leading-3.5 text-white">
                      {shortLabel(activeQuestion.label)}
                      {r.isContinuation ? " cont." : ""}
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
