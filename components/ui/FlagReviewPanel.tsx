"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getFlagById, resolveFlag, type FlagRecord } from "@/lib/actions/flags";

export default function FlagReviewPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const flagId = searchParams.get("flag");

  const [flag, setFlag] = useState<FlagRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [resolved, setResolved] = useState(false);
  const highlightRef = useRef<HTMLElement | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Fetch flag data when ?flag= param is present
  useEffect(() => {
    if (!flagId) return;
    setLoading(true);
    getFlagById(flagId).then((data) => {
      setFlag(data);
      setLoading(false);
    });
  }, [flagId]);

  // Highlight the flagged element on the page
  useEffect(() => {
    if (!flag) return;

    // Inject highlight styles once
    if (!styleRef.current) {
      const style = document.createElement("style");
      style.textContent = `
        .csc-flag-highlight {
          outline: 3px solid #F59E0B !important;
          outline-offset: 3px !important;
          background-color: rgba(253, 230, 138, 0.35) !important;
          border-radius: 3px;
          position: relative;
        }
      `;
      document.head.appendChild(style);
      styleRef.current = style;
    }

    const tryHighlight = () => {
      let el: Element | null = null;

      if (flag.element_selector) {
        try {
          el = document.querySelector(flag.element_selector);
        } catch {
          try {
            const escaped = flag.element_selector.replace(
              /\[([^\]]*)\]/g,
              (_, inner) => `\\[${inner.replace(/[#.()\s]/g, (c: string) => `\\${c}`)}\\]`
            );
            el = document.querySelector(escaped);
          } catch { /* invalid selector, fall through to text search */ }
        }
      }

      // Fallback: search by text content
      if (!el && flag.element_content) {
        const raw = flag.element_content.replace(/\s+/g, " ").trim();
        const candidates = [
          raw.slice(0, 60),
          raw.match(/[A-Za-z][A-Za-z\s'"-]{4,}/)?.[0]?.trim() ?? "",
        ].filter(Boolean);

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const nodes: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) nodes.push(node as Text);

        for (const candidate of candidates) {
          const lower = candidate.toLowerCase();
          for (const n of nodes) {
            if (n.textContent?.toLowerCase().includes(lower)) {
              el = n.parentElement;
              break;
            }
          }
          if (el) break;
        }
      }

      if (el) {
        el.classList.add("csc-flag-highlight");
        highlightRef.current = el as HTMLElement;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      }
      return false;
    };

    // Try immediately, then retry once after a short delay for dynamic content
    if (!tryHighlight()) {
      const t = setTimeout(tryHighlight, 800);
      return () => clearTimeout(t);
    }
  }, [flag]);

  // Clean up highlight on unmount or dismiss
  const clearHighlight = () => {
    highlightRef.current?.classList.remove("csc-flag-highlight");
    highlightRef.current = null;
  };

  const dismiss = () => {
    clearHighlight();
    const params = new URLSearchParams(searchParams.toString());
    params.delete("flag");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    setFlag(null);
  };

  const handleResolve = async () => {
    if (!flag) return;
    setResolving(true);
    const result = await resolveFlag(flag.id);
    if (result.success) {
      setResolved(true);
      clearHighlight();
      setTimeout(dismiss, 1800);
    }
    setResolving(false);
  };

  if (!flagId || loading || !flag) return null;

  const priorityHigh = flag.priority === "high";
  const date = new Date(flag.created_at).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div
      role="region"
      aria-label="Flag review"
      className="fixed bottom-0 left-0 right-0 z-[9999] border-t shadow-2xl"
      style={{
        background: priorityHigh ? "#FEF2F2" : "#FFFBEB",
        borderColor: priorityHigh ? "#FCA5A5" : "#FCD34D",
      }}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-start gap-4">
        {/* Priority + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              priorityHigh
                ? "bg-red-100 text-red-700"
                : "bg-amber-100 text-amber-700"
            }`}>
              {priorityHigh ? "🔴 High priority" : "🟡 Normal priority"} flag
            </span>
            <span className="text-xs text-gray-500">
              {flag.flagger_name ?? flag.flagger_email} · {date}
            </span>
            {flag.status === "resolved" && (
              <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                Already resolved
              </span>
            )}
          </div>

          {flag.element_content && (
            <p className="text-sm text-gray-700 truncate mb-0.5">
              <span className="text-gray-400">Flagged: </span>
              &ldquo;{flag.element_content.slice(0, 120)}&rdquo;
            </p>
          )}

          {flag.note && (
            <p className="text-sm text-gray-800">
              <span className="text-gray-400">Note: </span>{flag.note}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {resolved ? (
            <span className="text-sm font-semibold text-green-700">✓ Resolved</span>
          ) : flag.status !== "resolved" ? (
            <button
              onClick={handleResolve}
              disabled={resolving}
              className="px-3 py-1.5 text-sm font-semibold rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {resolving ? "Resolving…" : "Mark resolved"}
            </button>
          ) : null}
          <button
            onClick={dismiss}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
