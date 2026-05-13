"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { findElementBySelector, findElementByText, computeUnionRect } from "@/lib/utils/dom-highlight";

export default function PublicHighlightHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const hs = searchParams.get("hs");
  const he = searchParams.get("he");
  const ht = searchParams.get("ht");

  const [highlightRect, setHighlightRect] = useState<{
    top: number; left: number; width: number; height: number;
  } | null>(null);

  const didScrollRef = useRef(false);

  const computeHighlight = useCallback((scroll = false) => {
    let firstEl: Element | null = null;
    if (hs) firstEl = findElementBySelector(hs);
    if (!firstEl && ht) firstEl = findElementByText(ht);
    if (!firstEl) return false;

    let lastEl: Element | null = null;
    if (he) lastEl = findElementBySelector(he);

    setHighlightRect(computeUnionRect(firstEl, lastEl));

    if (scroll && !didScrollRef.current) {
      didScrollRef.current = true;
      firstEl.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return true;
  }, [hs, he, ht]);

  useEffect(() => {
    if (!hs && !ht) return;
    didScrollRef.current = false;
    if (!computeHighlight(true)) {
      const t = setTimeout(() => computeHighlight(true), 800);
      return () => clearTimeout(t);
    }
  }, [hs, he, ht, computeHighlight]);

  useEffect(() => {
    if (!hs && !ht) return;
    const refresh = () => computeHighlight(false);
    window.addEventListener("scroll", refresh, { passive: true });
    window.addEventListener("resize", refresh, { passive: true });
    return () => {
      window.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [hs, ht, computeHighlight]);

  const dismiss = () => {
    setHighlightRect(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("hs");
    params.delete("he");
    params.delete("ht");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : pathname, { scroll: false });
  };

  if (!hs && !ht) return null;

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
        className="fixed bottom-0 left-0 right-0 z-[9999] border-t shadow-2xl"
        style={{ background: "#F5F3FF", borderColor: "#C4B5FD" }}
      >
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex-1 min-w-0 flex items-center gap-2">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
              ↗ Shared with you
            </span>
            {ht && (
              <p className="text-sm text-gray-600 truncate">
                <span className="text-gray-400">About: </span>
                &ldquo;{decodeURIComponent(ht).slice(0, 120)}&rdquo;
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
