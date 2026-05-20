"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getInternalShareById, type InternalShareRecord } from "@/lib/actions/internal-shares";
import { findElementBySelector, findElementByText, computeUnionRect } from "@/lib/utils/dom-highlight";

export default function InternalSharePanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const shareId = searchParams.get("ishare");

  const [share, setShare] = useState<InternalShareRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlightRect, setHighlightRect] = useState<{
    top: number; left: number; width: number; height: number;
  } | null>(null);

  const didScrollRef = useRef(false);

  useEffect(() => {
    if (!shareId) return;
    setLoading(true);
    getInternalShareById(shareId).then((data) => {
      setShare(data);
      setLoading(false);
    });
  }, [shareId]);

  const computeHighlight = useCallback((share: InternalShareRecord, scroll = false) => {
    let firstEl: Element | null = null;
    if (share.element_selector) firstEl = findElementBySelector(share.element_selector);
    if (!firstEl && share.element_text) firstEl = findElementByText(share.element_text);
    if (!firstEl) return false;

    let lastEl: Element | null = null;
    if (share.element_end_selector) lastEl = findElementBySelector(share.element_end_selector);

    setHighlightRect(computeUnionRect(firstEl, lastEl));

    if (scroll && !didScrollRef.current) {
      didScrollRef.current = true;
      firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return true;
  }, []);

  useEffect(() => {
    if (!share) return;
    didScrollRef.current = false;
    const tryCompute = () => computeHighlight(share, true);
    if (!tryCompute()) {
      const t = setTimeout(tryCompute, 800);
      return () => clearTimeout(t);
    }
  }, [share, computeHighlight]);

  useEffect(() => {
    if (!share) return;
    const refresh = () => computeHighlight(share, false);
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [share, computeHighlight]);

  const dismiss = () => {
    setHighlightRect(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("ishare");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    setShare(null);
  };

  if (!shareId || loading || !share) return null;

  const date = new Date(share.created_at).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <>
      {highlightRect && (
        <div
          className="fixed pointer-events-none z-[9998]"
          style={{
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height,
            border: "3px solid #8B5CF6",
            borderRadius: "4px",
            backgroundColor: "rgba(237, 233, 254, 0.3)",
          }}
        />
      )}

      <div
        role="region"
        aria-label="Shared content"
        className="fixed bottom-0 left-0 right-0 z-[9999] border-t shadow-2xl"
        style={{ background: "#F5F3FF", borderColor: "#C4B5FD" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">
                ↗ Shared with you
              </span>
              <span className="text-xs text-gray-500">{date}</span>
            </div>
            {share.element_text && (
              <p className="text-sm text-gray-700 truncate mb-0.5">
                <span className="text-gray-400">About: </span>
                &ldquo;{share.element_text.slice(0, 120)}&rdquo;
              </p>
            )}
            {share.note && (
              <p className="text-sm text-gray-800">
                <span className="text-gray-400">Note: </span>{share.note}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={dismiss}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
