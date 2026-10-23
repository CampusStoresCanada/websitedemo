"use client";

/**
 * The toolkit's floating + button and its round tool buttons.
 *
 * ⛔ One look, two users: the site-wide Toolkit and the check-in desk's own +
 * menu. They used to be private to Toolkit.tsx; the desk needed the same
 * control, and a copy would drift the first time either changed.
 *
 * `size="lg"` and `showLabel` exist for the desk: an iPad has no hover, so a
 * hover-only label is no label, and a 40px circle is too small for a finger.
 */

import type { ReactNode } from "react";

type FabSize = "md" | "lg";

export function ToolButton({
  icon,
  label,
  onClick,
  disabled = false,
  highlighted = false,
  size = "md",
  showLabel = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  highlighted?: boolean;
  size?: FabSize;
  /** Always show the label beside the button, not only on hover. */
  showLabel?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`${size === "lg" ? "w-14 h-14" : "w-10 h-10"} rounded-full shadow-lg flex items-center justify-center transition-all group relative ${
        disabled
          ? "bg-gray-200 text-gray-400 cursor-not-allowed"
          : "bg-white hover:bg-gray-50 text-gray-600 hover:scale-105"
      } ${highlighted ? "ring-2 ring-[#EE2A2E] ring-offset-2 animate-pulse" : ""}`}
      title={label}
    >
      {icon}
      <span
        className={`absolute right-full mr-3 px-2 py-1 bg-gray-900 text-white rounded whitespace-nowrap pointer-events-none transition-opacity ${
          size === "lg" ? "text-sm" : "text-xs"
        } ${showLabel ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        {label}
        {disabled && " (Coming soon)"}
      </span>
    </button>
  );
}

/** The + that opens the tools. Rotates to an × while they are open. */
export function ToolkitFabButton({
  expanded,
  onClick,
  title,
  size = "md",
}: {
  expanded: boolean;
  onClick: () => void;
  title: string;
  size?: FabSize;
}) {
  return (
    <button
      type="button"
      data-toolkit-fab
      onClick={onClick}
      aria-label={title}
      aria-expanded={expanded}
      className={`${size === "lg" ? "w-16 h-16" : "w-12 h-12"} rounded-full shadow-lg flex items-center justify-center transition-all hover:scale-105 ${
        expanded ? "bg-gray-600 hover:bg-gray-700 text-white" : "bg-gray-700 hover:bg-gray-800 text-white"
      }`}
      title={title}
    >
      <div className={`transition-transform duration-200 ${expanded ? "rotate-45" : ""}`}>
        <PlusIcon />
      </div>
    </button>
  );
}

export function PlusIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
