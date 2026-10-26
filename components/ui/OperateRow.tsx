"use client";

import { useRef, useState, type ReactNode } from "react";
import Modal from "@/components/ui/Modal";
import ConfirmAction, { type ConfirmActionResult } from "@/components/ui/ConfirmAction";

/**
 * One thing to DO in the War Room (WAR_ROOM_OPERATE_PLAN §3):
 *
 *   Badge package                                    Due 11 Jan
 *   Made 1 Sep; 21 people added since.     [Edit] [Preview] [Make it]
 *
 * - The state is one sentence from real data. Blocked reads as a sentence
 *   ("Waiting on: …"), never as a greyed button that explains nothing.
 * - Edit is the only control that leaves: to the Manage page this depends on.
 * - Preview opens the shared Modal with exactly what will happen.
 * - Do it happens here, armed then confirmed with its count (ConfirmAction).
 *
 * The row stays short; detail goes in the Preview, never down the page.
 */
export type OperateRowTone = "attention" | "blocked" | "done" | "neutral";

export default function OperateRow({
  title,
  state,
  tone = "neutral",
  due,
  edit,
  preview,
  action,
  extra,
}: {
  title: string;
  /** What is true right now, in one sentence. When blocked: what it waits on. */
  state?: string | null;
  tone?: OperateRowTone;
  /** A date, already formatted ("11 Jan"). */
  due?: string | null;
  /** The Manage page this depends on. */
  edit?: { href: string; label?: string } | null;
  /**
   * What will happen: a page to frame (`src`) or rendered content. `printable`:
   * the framed page is a print sheet, and Print prints exactly what is shown.
   */
  preview?: { title: string; src?: string; content?: ReactNode; printable?: boolean; size?: "lg" | "full" } | null;
  /** The thing itself. Absent when the row is blocked or only informs. */
  action?: {
    label: string;
    consequence: string;
    onConfirm: () => Promise<ConfirmActionResult>;
    tone?: "primary" | "danger";
  } | null;
  /** Anything else that belongs in the row (a tick, a list of buttons). */
  extra?: ReactNode;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const stateClass =
    tone === "attention"
      ? "text-amber-800"
      : tone === "blocked"
        ? "text-red-700"
        : tone === "done"
          ? "text-gray-400"
          : "text-gray-600";

  return (
    <div className={`flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 ${tone === "done" ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-sm font-medium ${tone === "done" ? "text-gray-500" : "text-gray-900"}`}>{title}</span>
          {due ? <span className="text-xs text-gray-500">{due}</span> : null}
        </div>
        {state ? <p className={`mt-0.5 text-xs ${stateClass}`}>{state}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-2">
        {edit ? (
          <a
            href={edit.href}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {edit.label ?? "Edit"}
          </a>
        ) : null}
        {preview ? (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {preview.printable ? "Preview & print" : "Preview"}
          </button>
        ) : null}
        {action ? (
          <ConfirmAction
            label={action.label}
            consequence={action.consequence}
            onConfirm={action.onConfirm}
            tone={action.tone}
          />
        ) : null}
        {extra}
      </div>
      {preview ? (
        <Modal
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={preview.title}
          size={preview.size ?? (preview.src ? "full" : "lg")}
          footer={
            preview.src && preview.printable ? (
              <button
                type="button"
                onClick={() => frameRef.current?.contentWindow?.print()}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
              >
                Print
              </button>
            ) : undefined
          }
        >
          {preview.src ? (
            <iframe ref={frameRef} src={preview.src} title={preview.title} className="h-[75vh] w-full border-0 sm:h-full" />
          ) : (
            <div className="p-5">{preview.content}</div>
          )}
        </Modal>
      ) : null}
    </div>
  );
}
