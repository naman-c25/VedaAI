"use client";

import {
  ArrowLeft,
  ClipboardList,
  HelpCircle,
  Bell,
  Sparkles,
  ChevronDown,
  Menu,
} from "lucide-react";

function Avatar() {
  return (
    <span className="grid h-7 w-7 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#ffb38a] to-[#ff6b35] text-[11px] font-bold text-white">
      MR
    </span>
  );
}

/**
 * The bar carries a breadcrumb and the full action set on desktop. On a phone
 * the brand replaces the breadcrumb and the secondary actions collapse into the
 * drawer, leaving only what a thumb needs — matching the mobile design.
 */
export default function TopBar({ onBack, canGoBack, onMenu }) {
  return (
    <header className="flex h-13 shrink-0 items-center gap-2 border-b border-line px-3 lg:gap-3 lg:px-4">
      <button
        type="button"
        onClick={onBack}
        disabled={!canGoBack}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#6f6f6f] transition enabled:hover:bg-[#f5f5f5] enabled:hover:text-ink disabled:cursor-default disabled:text-[#c9c9c9]"
        aria-label="Back"
      >
        <ArrowLeft size={17} />
      </button>

      {/* Phone: the brand. Desktop: the breadcrumb. */}
      <span className="text-[15px] font-extrabold tracking-tight lg:hidden">VedaAI</span>
      <div className="hidden items-center gap-1.5 text-[14px] font-medium text-[#5f5f5f] lg:flex">
        <ClipboardList size={15} className="text-[#8b8b8b]" />
        Exams
      </div>

      <div className="flex-1" />

      <button
        type="button"
        className="hidden h-8 w-8 place-items-center rounded-full text-[#7d7d7d] transition hover:bg-[#f5f5f5] lg:grid"
        aria-label="Help"
      >
        <HelpCircle size={17} />
      </button>

      <button
        type="button"
        className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#7d7d7d] transition hover:bg-[#f5f5f5]"
        aria-label="Notifications"
      >
        <Bell size={17} />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand ring-2 ring-white" />
      </button>

      <button
        type="button"
        className="hidden h-8 w-8 place-items-center rounded-full text-brand transition hover:bg-brand-tint lg:grid"
        aria-label="AI assistant"
      >
        <Sparkles size={17} fill="currentColor" />
      </button>

      <button
        type="button"
        className="flex shrink-0 items-center gap-2 rounded-full py-1 transition hover:bg-[#f5f5f5] lg:ml-1 lg:pl-1 lg:pr-2"
      >
        <Avatar />
        <span className="hidden text-[14px] font-semibold lg:inline">Madhur Rastogi</span>
        <ChevronDown size={14} className="hidden text-[#9a9a9a] lg:block" />
      </button>

      <button
        type="button"
        onClick={onMenu}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[#5f5f5f] transition hover:bg-[#f5f5f5] lg:hidden"
        aria-label="Open menu"
      >
        <Menu size={19} />
      </button>
    </header>
  );
}
