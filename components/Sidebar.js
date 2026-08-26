"use client";

import {
  LayoutGrid,
  MonitorPlay,
  FileText,
  ClipboardList,
  Clock,
  Settings,
  Sparkles,
  PanelLeft,
  ChevronsRight,
} from "lucide-react";

const NAV = [
  { label: "Home", icon: LayoutGrid },
  { label: "My Classroom", icon: MonitorPlay },
  { label: "Assignments", icon: FileText },
  { label: "Exams", icon: ClipboardList, active: true },
  { label: "My Library", icon: Clock },
];

function SchoolCrest({ size = 28 }) {
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[#e8f2e4] ring-1 ring-[#cfe3c8]"
      style={{ width: size, height: size }}
    >
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 2.5 4.5 6v6.2c0 4.5 3.2 8 7.5 9.3 4.3-1.3 7.5-4.8 7.5-9.3V6L12 2.5Z"
          fill="#2f6b3a"
        />
        <path d="M12 7.5v8M8.5 11h7" stroke="#e8f2e4" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function Logo() {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-ink">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <path
          d="M4 5h4l4 11 4-11h4l-6.2 15h-3.6L4 5Z"
          fill="#fff"
        />
      </svg>
    </span>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  if (collapsed) {
    return (
      <aside className="flex w-14.5 shrink-0 flex-col items-center gap-1 rounded-2xl border border-line bg-white py-4">
        <Logo />

        <button
          type="button"
          className="mt-4 grid h-9 w-9 place-items-center rounded-full bg-ink ring-2 ring-brand/70 ring-offset-2 ring-offset-white transition hover:bg-black"
          aria-label="AI Teacher's Toolkit"
        >
          <Sparkles size={15} className="text-white" fill="currentColor" />
        </button>

        <nav className="mt-5 flex flex-col items-center gap-1">
          {NAV.map(({ label, icon: Icon, active }) => (
            <button
              key={label}
              type="button"
              title={label}
              className={`grid h-8 w-8 place-items-center rounded-lg transition ${
                active ? "bg-[#f2f2f2] text-ink" : "text-[#9a9a9a] hover:bg-[#f7f7f7]"
              }`}
            >
              <Icon size={16} />
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        <SchoolCrest size={26} />
        <button
          type="button"
          onClick={onToggle}
          className="mt-3 grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-[#f5f5f5] hover:text-ink"
          aria-label="Expand sidebar"
        >
          <ChevronsRight size={15} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col rounded-2xl border border-line bg-white p-3">
      <div className="flex items-center gap-2 px-1 py-1">
        <Logo />
        <span className="text-[16px] font-extrabold tracking-tight">VedaAI</span>
        <button
          type="button"
          onClick={onToggle}
          className="ml-auto grid h-7 w-7 place-items-center rounded-md text-[#b0b0b0] transition hover:bg-[#f5f5f5] hover:text-ink"
          aria-label="Collapse sidebar"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      <button
        type="button"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-ink py-2.5 text-[14px] font-semibold text-white ring-2 ring-brand/70 ring-offset-2 ring-offset-white transition hover:bg-black"
      >
        <Sparkles size={14} className="text-white" fill="currentColor" />
        AI Teacher&apos;s Toolkit
      </button>

      <nav className="mt-5 flex flex-col gap-0.5">
        {NAV.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] transition ${
              active
                ? "bg-[#f2f2f2] font-semibold text-ink"
                : "font-medium text-[#7d7d7d] hover:bg-[#f7f7f7] hover:text-ink"
            }`}
          >
            <Icon size={16} className={active ? "text-ink" : "text-[#9a9a9a]"} />
            {label}
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        className="mb-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium text-[#7d7d7d] transition hover:bg-[#f7f7f7] hover:text-ink"
      >
        <Settings size={16} className="text-[#9a9a9a]" />
        Settings
      </button>

      <div className="flex items-center gap-2.5 rounded-xl border border-line bg-[#fcfcfc] p-2.5">
        <SchoolCrest />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-[13px] font-bold">Delhi Public School</p>
          <p className="truncate text-[12px] text-muted">Bokaro Steel City</p>
        </div>
      </div>
    </aside>
  );
}
