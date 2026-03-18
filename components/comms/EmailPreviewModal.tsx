"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Monitor, Smartphone, RefreshCw } from "lucide-react";

interface EmailPreviewModalProps {
  bodyHtml: string;
  subject: string;
  variableKeys: string[];
  /** Pre-filled values (e.g. from campaign.variable_values) */
  initialVariables?: Record<string, string>;
  onClose: () => void;
}

export default function EmailPreviewModal({
  bodyHtml,
  subject,
  variableKeys,
  initialVariables = {},
  onClose,
}: EmailPreviewModalProps) {
  const [variables, setVariables] = useState<Record<string, string>>(
    Object.fromEntries(variableKeys.map((k) => [k, initialVariables[k] ?? ""]))
  );
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewSubject, setPreviewSubject] = useState(subject);
  const [viewWidth, setViewWidth] = useState<"desktop" | "mobile">("desktop");
  const [loading, setLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const fetchPreview = useCallback(
    async (vars: Record<string, string>) => {
      setLoading(true);
      try {
        const res = await fetch("/api/admin/comms/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body_html: bodyHtml, subject, variables: vars }),
        });
        const data = await res.json();
        setPreviewHtml(data.html);
        setPreviewSubject(data.subject);
      } finally {
        setLoading(false);
      }
    },
    [bodyHtml, subject]
  );

  // Load preview on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchPreview(variables); }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // Resize iframe to content height after srcdoc loads
  const handleIframeLoad = () => {
    const iframe = iframeRef.current;
    if (iframe?.contentDocument?.body) {
      iframe.style.height =
        Math.max(600, iframe.contentDocument.body.scrollHeight) + "px";
    }
  };

  const iframeWidth = viewWidth === "desktop" ? 620 : 390;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 flex flex-col bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 shrink-0">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-sm font-semibold text-gray-900">Email Preview</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Subject:{" "}
              <span className="text-gray-800 font-medium">
                {previewSubject || "(no subject)"}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewWidth("desktop")}
              title="Desktop (600px)"
              className={`p-1.5 rounded-md transition-colors ${
                viewWidth === "desktop"
                  ? "bg-[#EE2A2E]/10 text-[#EE2A2E]"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Monitor size={15} />
            </button>
            <button
              type="button"
              onClick={() => setViewWidth("mobile")}
              title="Mobile (375px)"
              className={`p-1.5 rounded-md transition-colors ${
                viewWidth === "mobile"
                  ? "bg-[#EE2A2E]/10 text-[#EE2A2E]"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              }`}
            >
              <Smartphone size={15} />
            </button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button
              type="button"
              onClick={onClose}
              title="Close (Esc)"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0">

          {/* Variable panel (only shown if template has variables) */}
          {variableKeys.length > 0 && (
            <div className="w-52 shrink-0 border-r border-gray-200 flex flex-col overflow-hidden">
              <div className="px-3 py-2.5 border-b border-gray-100 bg-gray-50">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                  Sample Values
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Fill in to preview with real data
                </p>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {variableKeys.map((key) => (
                  <div key={key}>
                    <label className="block text-[11px] font-mono text-[#D92327] mb-1">
                      {`{{${key}}}`}
                    </label>
                    <input
                      type="text"
                      value={variables[key] ?? ""}
                      onChange={(e) =>
                        setVariables((v) => ({ ...v, [key]: e.target.value }))
                      }
                      placeholder={`[${key}]`}
                      className="block w-full rounded-md border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </div>
              <div className="p-3 border-t border-gray-100 bg-gray-50 shrink-0">
                <button
                  type="button"
                  onClick={() => fetchPreview(variables)}
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#EE2A2E] px-3 py-2 text-xs font-medium text-white hover:bg-[#D92327] disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
                  Refresh Preview
                </button>
              </div>
            </div>
          )}

          {/* iframe container */}
          <div className="flex-1 overflow-auto bg-gray-100">
            <div className="flex justify-center py-6 px-4">
              <div className="relative" style={{ width: iframeWidth, transition: "width 0.2s ease" }}>
                {loading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/70 rounded-lg z-10" style={{ minHeight: 200 }}>
                    <div className="h-6 w-6 rounded-full border-2 border-[#163D6D] border-t-transparent animate-spin" />
                  </div>
                )}
                {previewHtml && (
                  <iframe
                    ref={iframeRef}
                    srcDoc={previewHtml}
                    onLoad={handleIframeLoad}
                    title="Email Preview"
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
        </div>

        {/* ── Footer note ── */}
        <div className="px-5 py-2 border-t border-gray-100 bg-gray-50 shrink-0">
          <p className="text-[10px] text-gray-400">
            Rendered using the branded email layout. Actual appearance varies by email client — this is an HTML approximation.
          </p>
        </div>
      </div>
    </div>
  );
}
