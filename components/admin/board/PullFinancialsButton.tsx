"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  meetingId?: string;
  /** YYYY-MM-DD — if provided, report is frozen to last day of prior month */
  endDate?: string;
}

export default function PullFinancialsButton({ meetingId, endDate }: Props) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [detail, setDetail] = useState<string | null>(null);

  async function handlePull() {
    setState("loading");
    setDetail(null);
    try {
      const res = await fetch("/api/admin/board/qbo/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, endDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Pull failed");
      const s = data.summary as { periodStart?: string; periodEnd?: string };
      setDetail(`Pulled · ${s.periodStart} → ${s.periodEnd}`);
      setState("success");
      router.refresh();
    } catch (err) {
      setDetail(err instanceof Error ? err.message : "Unknown error");
      setState("error");
    }
  }

  const baseLabel = meetingId ? "Pull Meeting Financials" : "Pull QBO Reports";
  const label =
    state === "loading" ? "Pulling…" :
    state === "success" ? "Pulled ✓" :
    state === "error"   ? "Failed — retry?" :
    baseLabel;

  const cls =
    state === "loading" ? "opacity-60 cursor-not-allowed" :
    state === "success" ? "border-green-300 bg-green-50 text-green-700 hover:bg-green-100" :
    state === "error"   ? "border-red-300 bg-red-50 text-red-700 hover:bg-red-100" :
    "border-accent bg-accent text-white hover:bg-accent-hover";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handlePull}
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
