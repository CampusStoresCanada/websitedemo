"use client";

import { useId, useState } from "react";

/**
 * A hover explanation that actually appears.
 *
 * The `title` attribute was doing this job and failing at it: it waits about a
 * second, renders in the operating system's chrome rather than the page, never
 * appears on touch, and gives no sign it is there at all — so an explanation
 * written for the reader was one nobody found. This shows on hover and on
 * keyboard focus, immediately, with a visible marker that there is something
 * to read.
 */
export default function Explain({
  children,
  text,
  /** Nudge the bubble left when the trigger sits near the right edge. */
  align = "left",
}: {
  children: React.ReactNode;
  text: string;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  return (
    <span className="relative inline-flex items-center gap-1">
      <span
        tabIndex={0}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="cursor-help border-b border-dotted border-gray-400 outline-none focus:border-solid focus:border-[#163D6D]"
      >
        {children}
      </span>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute bottom-full z-30 mb-1.5 w-72 rounded-md bg-gray-900 px-3 py-2 text-xs font-normal normal-case leading-snug text-white shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
