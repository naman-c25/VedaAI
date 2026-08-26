"use client";

/** The concentric-ring teacher mark that anchors the upload screen. */
export default function TeacherMark() {
  return (
    <div className="relative grid h-33 w-33 place-items-center">
      <span className="absolute inset-0 rounded-full bg-brand/7" />
      <span className="absolute inset-3.25 rounded-full bg-brand/11" />
      <span className="absolute inset-0 animate-ring rounded-full ring-1 ring-brand/25" />

      {/* dots riding the middle ring */}
      {[
        { top: "10%", left: "20%" },
        { top: "6%", right: "24%" },
        { bottom: "16%", left: "10%" },
        { bottom: "10%", right: "16%" },
      ].map((pos, i) => (
        <span
          key={i}
          className="absolute h-1.5 w-1.5 rounded-full bg-brand"
          style={pos}
        />
      ))}

      <svg viewBox="0 0 100 100" className="relative h-19 w-19">
        <defs>
          <clipPath id="tm-clip">
            <circle cx="50" cy="50" r="50" />
          </clipPath>
        </defs>
        <g clipPath="url(#tm-clip)">
          <circle cx="50" cy="50" r="50" fill="#fdece4" />
          {/* hair */}
          <path d="M28 44c0-14 10-23 22-23s22 9 22 23v6c0 4-3 5-4 3l-2-8c-9 3-25 3-32-2l-2 10c-1 3-4 2-4-2v-7Z" fill="#2f2a28" />
          {/* face */}
          <path d="M35 40h30v16a15 15 0 0 1-30 0V40Z" fill="#f3c39c" />
          {/* neck + shoulders */}
          <path d="M43 66h14v8H43z" fill="#e5ab82" />
          <path d="M20 100c0-14 11-24 30-24s30 10 30 24H20Z" fill="#3f4a63" />
          <path d="M45 76h10l-5 11-5-11Z" fill="#ffffff" />
          {/* eyes + smile */}
          <circle cx="43" cy="50" r="1.8" fill="#2f2a28" />
          <circle cx="57" cy="50" r="1.8" fill="#2f2a28" />
          <path d="M45 57c2 2.2 8 2.2 10 0" stroke="#2f2a28" strokeWidth="1.6" strokeLinecap="round" fill="none" />
        </g>
      </svg>
    </div>
  );
}
