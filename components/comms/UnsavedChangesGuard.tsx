"use client";

import { useEffect, useRef } from "react";

/**
 * Wraps a template/campaign edit form and warns before it's possible to lose
 * work silently — the exact failure mode that ate a real image upload once:
 * the upload itself succeeds (it's a separate request to storage), but the
 * new src only lives in the visual editor's local state until "Save" is
 * clicked. Navigating away (Cancel, the back link, closing the tab) before
 * that discards it with no warning.
 *
 * Delegates input/change listening to the whole subtree via the container
 * ref, so it catches both native fields and the block editor's programmatic
 * dispatchEvent("input") on its hidden body_blocks_json field (see
 * BlockTemplateEditor) — no prop-drilling a dirty flag through every layer.
 */
export default function UnsavedChangesGuard({ children }: { children: React.ReactNode }) {
  const dirty = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const markDirty = () => {
      dirty.current = true;
    };
    container.addEventListener("input", markDirty);
    container.addEventListener("change", markDirty);

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    // Next.js client-side <Link> navigation doesn't trigger beforeunload
    // (no real document unload), so internal links need their own guard.
    const handleClickCapture = (e: MouseEvent) => {
      if (!dirty.current) return;
      const link = (e.target as HTMLElement)?.closest("a[href]");
      if (!link) return;
      const proceed = window.confirm(
        "You have unsaved changes — including anything you just uploaded. Leave without saving?"
      );
      if (!proceed) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    container.addEventListener("click", handleClickCapture, true);

    const handleSubmit = () => {
      dirty.current = false;
    };
    container.addEventListener("submit", handleSubmit);

    return () => {
      container.removeEventListener("input", markDirty);
      container.removeEventListener("change", markDirty);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      container.removeEventListener("click", handleClickCapture, true);
      container.removeEventListener("submit", handleSubmit);
    };
  }, []);

  return <div ref={containerRef}>{children}</div>;
}
