"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getExplainRequestById, type ExplainRequestRecord } from "@/lib/actions/explain-requests";

export default function ExplainContextPanel() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestId = searchParams.get("explain");

  const [request, setRequest] = useState<ExplainRequestRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const highlightRef = useRef<HTMLElement | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  // Fetch request data when ?explain= param is present
  useEffect(() => {
    if (!requestId) return;
    setLoading(true);
    getExplainRequestById(requestId).then((data) => {
      setRequest(data);
      setLoading(false);
    });
  }, [requestId]);

  // Highlight the element in question
  useEffect(() => {
    if (!request) return;

    if (!styleRef.current) {
      const style = document.createElement("style");
      style.textContent = `
        .csc-explain-highlight {
          outline: 3px solid #3B82F6 !important;
          outline-offset: 3px !important;
          background-color: rgba(219, 234, 254, 0.45) !important;
          border-radius: 3px;
          position: relative;
        }
      `;
      document.head.appendChild(style);
      styleRef.current = style;
    }

    const tryHighlight = () => {
      let el: Element | null = null;

      if (request.element_selector) {
        // First try raw selector, then try with Tailwind arbitrary-value brackets escaped
        try {
          el = document.querySelector(request.element_selector);
        } catch {
          try {
            const escaped = request.element_selector.replace(
              /\[([^\]]*)\]/g,
              (_, inner) => `\\[${inner.replace(/[#.()\s]/g, (c: string) => `\\${c}`)}\\]`
            );
            el = document.querySelector(escaped);
          } catch { /* invalid selector, fall through to text search */ }
        }
      }

      if (!el && request.element_text) {
        // Extract the first meaningful word sequence (stops before concatenated numbers)
        const raw = request.element_text.replace(/\s+/g, " ").trim();
        // Try progressively — full text first, then first clean alpha phrase
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
        el.classList.add("csc-explain-highlight");
        highlightRef.current = el as HTMLElement;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        return true;
      }
      return false;
    };

    if (!tryHighlight()) {
      const t = setTimeout(tryHighlight, 800);
      return () => clearTimeout(t);
    }
  }, [request]);

  const clearHighlight = () => {
    highlightRef.current?.classList.remove("csc-explain-highlight");
    highlightRef.current = null;
  };

  const dismiss = () => {
    clearHighlight();
    const params = new URLSearchParams(searchParams.toString());
    params.delete("explain");
    const qs = params.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
    setRequest(null);
  };

  if (!requestId || loading || !request) return null;

  const date = new Date(request.created_at).toLocaleDateString("en-CA", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div
      role="region"
      aria-label="Explain request context"
      className="fixed bottom-0 left-0 right-0 z-[9999] border-t shadow-2xl"
      style={{ background: "#EFF6FF", borderColor: "#93C5FD" }}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-start gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
              💬 Explain request
            </span>
            <span className="text-xs text-gray-500">{date}</span>
          </div>

          {request.element_text && (
            <p className="text-sm text-gray-700 truncate mb-0.5">
              <span className="text-gray-400">About: </span>
              &ldquo;{request.element_text.slice(0, 120)}&rdquo;
            </p>
          )}

          {request.note && (
            <p className="text-sm text-gray-800">
              <span className="text-gray-400">Question: </span>{request.note}
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
  );
}
