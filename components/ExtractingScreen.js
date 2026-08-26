"use client";

/** Four-point sparkle, matching the mark used across the product. */
function Sparkle() {
  return (
    <svg viewBox="0 0 120 120" className="h-21.5 w-21.5">
      <defs>
        <linearGradient id="sp" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ff8a4c" />
          <stop offset="100%" stopColor="#f2540a" />
        </linearGradient>
      </defs>
      <path
        d="M66 16c1.6 18.6 8.4 25.4 27 27-18.6 1.6-25.4 8.4-27 27-1.6-18.6-8.4-25.4-27-27 18.6-1.6 25.4-8.4 27-27Z"
        fill="url(#sp)"
      />
      <path
        d="M36 66c1 11 5 15 16 16-11 1-15 5-16 16-1-11-5-15-16-16 11-1 15-5 16-16Z"
        fill="url(#sp)"
      />
      <circle cx="30" cy="34" r="4.5" fill="#ff8a4c" />
      <circle cx="86" cy="86" r="3.5" fill="#ff8a4c" />
    </svg>
  );
}

export default function ExtractingScreen({ stage, progress }) {
  return (
    <div className="canvas-wash flex flex-1 flex-col items-center justify-center px-6">
      <div className="animate-sparkle">
        <Sparkle />
      </div>

      <h2 className="mt-5 text-[24px] font-extrabold tracking-tight">Extracting...</h2>
      <p className="mt-1 text-[14px] text-[#6f6f6f]">This may take a while</p>

      <div className="mt-6 w-full max-w-70">
        <div className="h-1 w-full overflow-hidden rounded-full bg-[#ececec]">
          <div
            className="h-full rounded-full bg-brand transition-all duration-500 ease-out"
            style={{ width: `${Math.max(4, Math.min(100, progress))}%` }}
          />
        </div>
        <p className="mt-2.5 text-center text-[12px] font-medium text-[#9a9a9a]">{stage}</p>
      </div>
    </div>
  );
}
