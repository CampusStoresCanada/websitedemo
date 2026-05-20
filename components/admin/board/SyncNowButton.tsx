"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SyncNowButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function handleSync() {
    setState("loading");
    setDetail(null);
    try {
      const res = await fetch("/api/admin/onedrive/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      const r = data.result as { added?: number; updated?: number; skipped?: number; errors?: string[] };
      setDetail(
        `${r.added ?? 0} added · ${r.updated ?? 0} updated · ${r.skipped ?? 0} skipped` +
        (r.errors?.length ? ` · ${r.errors.length} error(s)` : "")
      );
      setState("success");
      router.refresh();
    } catch (err) {
      setDetail(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  const label =
    state === "loading" ? "Syncing…" :
    state === "success" ? "Synced ✓" :
    state === "error"   ? "Failed — retry?" :
    "Sync OneDrive";

  const cls =
    state === "loading" ? "opacity-60 cursor-not-allowed" :
    state === "success" ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100" :
    state === "error"   ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100" :
    "border-gray-300 bg-white text-gray-700 hover:bg-gray-50";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleSync}
        disabled={state === "loading"}
        className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${cls}`}
      >
        {label}
      </button>
      {detail && (
        <span className={`text-xs ${state === "error" ? "text-red-500" : "text-gray-400"}`}>
          {detail}
        </span>
      )}
    </div>
  );
}
