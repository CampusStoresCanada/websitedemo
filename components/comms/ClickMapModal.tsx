"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface ClickMapModalProps {
  bodyHtml: string;
  subject: string;
  variableKeys: string[];
  variableValues: Record<string, string>;
  clicksByUrl: Record<string, number>;
  totalClicks: number;
  isTransactional?: boolean;
  onClose: () => void;
}

function heatColor(intensity: number): string {
  const alpha = 0.14 + intensity * 0.5;
  return `rgba(238, 42, 46, ${alpha.toFixed(2)})`;
}

/**
 * Renders the campaign's actual sent HTML in an iframe, then overlays each
 * link with a heat color and a click-count badge — the email equivalent of
 * a click heatmap. True pixel-position heatmaps aren't possible for email
 * (clients block the JS that would track cursor/tap position), so this
 * matches what ESPs like Mailchimp call a "click map": per-link intensity,
 * not a continuous density overlay.
 */
export default function ClickMapModal({
  bodyHtml,
  subject,
  variableKeys,
  variableValues,
  clicksByUrl,
  totalClicks,
  isTransactional = false,
  onClose,
}: ClickMapModalProps) {
  const [previewHtml, setPreviewHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const vars = Object.fromEntries(variableKeys.map((k) => [k, variableValues[k] ?? ""]));
    let cancelled = false;
    fetch("/api/admin/comms/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body_html: bodyHtml, subject, variables: vars, is_transactional: isTransactional }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setPreviewHtml(data.html);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const linkCount = Object.keys(clicksByUrl).length;
  const maxCount = Math.max(1, ...Object.values(clicksByUrl));

  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc?.body) return;

    iframe!.style.height = Math.max(600, doc.body.scrollHeight) + "px";

    doc.querySelectorAll("a[href]").forEach((el) => {
      const a = el as HTMLAnchorElement;
      const href = a.getAttribute("href")?.trim() ?? "";
      const count = clicksByUrl[href] ?? 0;

      if (count > 0) {
        const intensity = count / maxCount;
        a.style.backgroundColor = heatColor(intensity);
        a.style.outline = "2px solid rgba(238, 42, 46, 0.65)";
      } else {
        a.style.outline = "1px dashed rgba(107, 114, 128, 0.45)";
      }
      a.style.outlineOffset = "2px";
      a.style.borderRadius = "4px";

      const badge = doc.createElement("span");
      badge.textContent = count > 0 ? `${count} click${count === 1 ? "" : "s"}` : "0 clicks";
      badge.style.cssText = [
        "display:inline-block",
        "margin-left:6px",
        "padding:1px 6px",
        "border-radius:9999px",
        "font:600 10px/1.6 sans-serif",
        "color:#fff",
        `background:${count > 0 ? "#EE2A2E" : "#9CA3AF"}`,
        "vertical-align:middle",
        "white-space:nowrap",
      ].join(";");
      a.insertAdjacentElement("afterend", badge);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative z-10 flex flex-col bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Click Map</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {totalClicks} total click{totalClicks === 1 ? "" : "s"} across {linkCount} link
              {linkCount === 1 ? "" : "s"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-gray-100">
          <div className="flex justify-center py-6 px-4">
            <div className="relative" style={{ width: 620 }}>
              {loading && (
                <div
                  className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-lg z-10"
                  style={{ minHeight: 200 }}
                >
                  <div className="h-6 w-6 rounded-full border-2 border-[#163D6D] border-t-transparent animate-spin" />
                </div>
              )}
              {previewHtml && (
                <iframe
                  ref={iframeRef}
                  srcDoc={previewHtml}
                  onLoad={handleIframeLoad}
                  title="Click Map"
                  style={{
                    width: "100%",
                    minHeight: 600,
                    border: "none",
                    borderRadius: 8,
                    boxShadow: "0 4px 24px rgba(0,0,0,0.14)",
                    display: "block",
                  }}
                />
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-2 border-t border-gray-100 bg-gray-50 shrink-0">
          <p className="text-[10px] text-gray-400">
            Solid outline + red fill = link had tracked clicks (darker = more, relative to this
            campaign&apos;s busiest link). Dashed outline = no clicks recorded on that link.
            Requires click tracking enabled on the sending domain in Resend.
          </p>
        </div>
      </div>
    </div>
  );
}
