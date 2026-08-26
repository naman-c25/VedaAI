"use client";

import { useRef, useState } from "react";
import { Upload, X, ArrowRight, AlertCircle } from "lucide-react";
import TeacherMark from "./TeacherMark";

const MAX_BYTES = 10 * 1024 * 1024;

function PdfBadge() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#fdecec]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M6 2h8l4 4v16H6V2Z" fill="#e5484d" />
        <path d="M14 2l4 4h-4V2Z" fill="#ffb3b5" />
        <text x="12" y="17" textAnchor="middle" fontSize="6" fontWeight="700" fill="#fff">
          PDF
        </text>
      </svg>
    </span>
  );
}

function ImageBadge() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#eaf1fd]">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="5" width="18" height="14" rx="2" fill="#3b82f6" />
        <circle cx="8.5" cy="10" r="1.6" fill="#fff" />
        <path d="M5 17l4.5-5 3 3.2L16 11l3 6H5Z" fill="#bfdbfe" />
      </svg>
    </span>
  );
}

function DropCard({ title, accentWord, meta, onPick, onClear, disabled }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(list) {
    if (!list || list.length === 0) return;
    onPick(list);
  }

  if (meta) {
    return (
      <div className="relative flex min-h-26 w-full items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
        {meta.isPdf ? <PdfBadge /> : <ImageBadge />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{meta.name}</p>
          <p className="mt-0.5 text-[12px] text-muted">
            {meta.size} &nbsp;•&nbsp; {meta.pages} {meta.pages === 1 ? "Page" : "Pages"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-[#4a4a4a] text-white shadow-sm transition hover:bg-ink disabled:opacity-40"
          aria-label={`Remove ${meta.name}`}
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      disabled={disabled}
      className={`flex min-h-26 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-7 transition ${
        dragging
          ? "border-brand bg-brand-tint"
          : "border-[#d8d8d8] bg-white/70 hover:border-[#bdbdbd] hover:bg-white"
      } disabled:opacity-50`}
    >
      <span className="grid h-9 w-9 place-items-center rounded-lg bg-[#f4f4f4]">
        <Upload size={16} className="text-[#6f6f6f]" />
      </span>
      <span className="text-[14px] font-semibold">
        {title} <span className="text-brand">{accentWord}</span>
      </span>
      <span className="text-[12px] text-muted">Max 10MB</span>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </button>
  );
}

export default function UploadScreen({
  question,
  answer,
  onPickQuestion,
  onPickAnswer,
  onClearQuestion,
  onClearAnswer,
  onStart,
  busy,
  error,
}) {
  const [localError, setLocalError] = useState("");
  const ready = Boolean(question && answer) && !busy;
  const shownError = error || localError;

  function guard(handler) {
    return (list) => {
      const files = Array.from(list);
      const total = files.reduce((s, f) => s + f.size, 0);
      if (total > MAX_BYTES) {
        setLocalError("That upload is over the 10MB limit. Try a smaller scan.");
        return;
      }
      setLocalError("");
      handler(files);
    };
  }

  return (
    <div className="canvas-wash flex flex-1 items-center justify-center overflow-y-auto px-6 py-8">
      <div className="w-full max-w-160">
        <h1 className="text-center text-[32px] font-extrabold leading-tight tracking-tight">
          Upload{" "}
          <span className="rounded-md bg-brand-soft px-2 py-0.5 text-brand">
            Question Paper &amp; Answer Sheets
          </span>
        </h1>
        <p className="mt-2 text-center text-[14px] text-[#6f6f6f]">
          Upload both files to get started
        </p>

        <div className="mt-6 flex justify-center">
          <TeacherMark />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DropCard
            title="Upload"
            accentWord="Question Paper"
            meta={question}
            onPick={guard(onPickQuestion)}
            onClear={onClearQuestion}
            disabled={busy}
          />
          <DropCard
            title="Upload"
            accentWord="Answer Sheet"
            meta={answer}
            onPick={guard(onPickAnswer)}
            onClear={onClearAnswer}
            disabled={busy}
          />
        </div>

        {shownError && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-[#f5d0d0] bg-[#fdf4f4] px-3 py-2.5 text-[13px] text-[#a13030]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span>{shownError}</span>
          </div>
        )}

        <div className="mt-7 flex justify-center">
          <button
            type="button"
            onClick={onStart}
            disabled={!ready}
            className={`flex items-center gap-2 rounded-full px-6 py-2.5 text-[14px] font-semibold transition ${
              ready
                ? "bg-ink text-white hover:bg-black"
                : "cursor-not-allowed bg-[#dcdcdc] text-white"
            }`}
          >
            {busy ? "Preparing…" : "Start Mapping"}
            <ArrowRight size={15} />
          </button>
        </div>

        <p className="mt-3 text-center text-[12px] text-[#9a9a9a]">
          Once both files are uploaded, you&apos;ll able to map answers with questions
        </p>
      </div>
    </div>
  );
}
