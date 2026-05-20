"use client";

import { useState } from "react";

interface Props {
  docId: string;
  fileName: string;
}

/**
 * Fetches a short-lived signed URL then opens it for download.
 * Avoids holding a permanent public URL client-side.
 */
export default function DocumentDownloadLink({ docId, fileName }: Props) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function handleDownload() {
    setState("loading");
    try {
      const res  = await fetch(`/api/admin/board/documents/${docId}/download`);
      const data = await res.json() as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error ?? "Download failed");
      // Open in new tab — browser will handle the file
      window.open(data.url, "_blank", "noopener,noreferrer");
      setState("idle");
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  return (
    <button
      onClick={handleDownload}
      disabled={state === "loading"}
      title={`Download ${fileName}`}
      className={`shrink-0 rounded-md border px-3 py-1 text-xs font-medium transition-colors ${
        state === "loading"
          ? "border-gray-200 bg-gray-50 text-gray-400 cursor-wait"
          : state === "error"
          ? "border-red-200 bg-red-50 text-red-600"
          : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
      }`}
    >
      {state === "loading" ? "…" : state === "error" ? "Error" : "Download"}
    </button>
  );
}
