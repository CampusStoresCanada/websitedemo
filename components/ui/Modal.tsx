"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * The site's one modal.
 *
 * ⛔ Every Preview in the War Room opens in this, and nothing else should roll
 * its own `fixed inset-0` again — EmailPreviewModal and BoothMoveModal each did,
 * which is three slightly different ways to close a box. The behaviour is
 * theirs: Escape closes, the backdrop closes, the page underneath does not
 * scroll. Full screen on a phone, a centred panel at a desk.
 *
 * Detail lives in here, not stacked down the page (WAR_ROOM_OPERATE_PLAN §3):
 * a row stays short because its preview has somewhere to go.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Actions along the bottom — typically the row's Do it. */
  footer?: ReactNode;
  /** `full` is for previews of a printed page or a PDF. */
  size?: "md" | "lg" | "full";
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const width = size === "md" ? "sm:max-w-lg" : size === "lg" ? "sm:max-w-3xl" : "sm:max-w-6xl";
  const height = size === "full" ? "sm:h-[90vh]" : "sm:max-h-[90vh]";

  return (
    <div className="fixed inset-0 z-[100] flex items-stretch justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div className={`relative flex w-full flex-col overflow-hidden bg-white shadow-2xl sm:rounded-2xl ${width} ${height}`}>
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
          <h2 className="truncate text-base font-semibold text-gray-900">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">{children}</div>
        {footer ? <div className="border-t border-gray-200 px-5 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
