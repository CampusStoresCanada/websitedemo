"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { findElementBySelector, findElementByText, computeUnionRect } from "@/lib/utils/dom-highlight";

export default function BookmarkJumpHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const bmhs = searchParams.get("bmhs");
  const bmhe = searchParams.get("bmhe");
  const bmt  = searchParams.get("bmt");

  const [highlightRect, setHighlightRect] = useState<{
    top: number; left: number; width: number; height: number;
  } | null>(null);

  const didScrollRef = useRef(false);

  const computeHighlight = useCallback((scroll = false) => {
    let firstEl: Element | null = null;
    if (bmhs) firstEl = findElementBySelector(bmhs);
    if (!firstEl && bmt) firstEl = findElementByText(bmt);
    if (!firstEl) return false;

    let lastEl: Element | null = null;
    if (bmhe) lastEl = findElementBySelector(bmhe);

    setHighlightRect(computeUnionRect(firstEl, lastEl));

    if (scroll && !didScrollRef.current) {
      didScrollRef.current = true;
      firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return true;
  }, [bmhs, bmhe, bmt]);

  useEffect(() => {
    if (!bmhs && !bmt) return;
    didScrollRef.current = false;
    if (!computeHighlight(true)) {
      const t = setTimeout(() => computeHighlight(true), 800);
      return () => clearTimeout(t);
    }
  }, [bmhs, bmhe, bmt, computeHighlight]);

  useEffect(() => {
    if (!bmhs && !bmt) return;
    const refresh = () => computeHighlight(false);
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [bmhs, bmt, computeHighlight]);

  const dismiss = () => {
    setHighlightRect(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("bmhs");
    params.delete("bmhe");
    params.delete("bmt");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : pathname, { scroll: false });
  };

  if (!bmhs && !bmt) return null;

  return (
    <>
      {highlightRect && (
        <div
          className="fixed pointer-events-none z-[9997]"
          style={{
            top: highlightRect.top,
            left: highlightRect.left,
            width: highlightRect.width,
            height: highlightRect.height,
            border: "3px solid #CA8A04",
            borderRadius: "4px",
            backgroundColor: "rgba(254, 243, 199, 0.35)",
          }}
        />
      )}

      <div
        className="fixed bottom-0 left-0 right-0 z-[9997] border-t shadow-2xl"
        style={{ background: "#FEFCE8", borderColor: "#FDE68A" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 shrink-0">
              📌 Your bookmark
            </span>
            {bmt && (
              <p className="text-sm text-gray-600 truncate">
                <span className="text-gray-400">Section: </span>
                &ldquo;{decodeURIComponent(bmt).slice(0, 120)}&rdquo;
              </p>
            )}
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </>
  );
}
