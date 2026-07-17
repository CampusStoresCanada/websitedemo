"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { transitionConferenceStatus } from "@/lib/actions/conference";
import type {
  LaunchReadiness,
  ReadinessStageKey,
  ReadinessStatus,
} from "@/lib/conference/launch-readiness";

interface LaunchChecklistProps {
  conferenceId: string;
  status: string;
  readiness: LaunchReadiness;
}

/** Fallback: the primary page for each stage. */
const STAGE_FIX_SEGMENT: Record<ReadinessStageKey, string> = {
  describe: "details",
  package: "products",
  sell: "legal",
};

/**
 * Per-check routing — a "Fix" link lands on the exact editor for that check,
 * not just the stage's primary page (dates live in Edit, days/parameters in
 * Catalog, grants in Package, etc.). Falls back to the stage default.
 */
const CHECK_FIX_SEGMENT: Record<string, string> = {
  dates: "details",
  "registration-window": "details",
  "registration-after-start": "details",
  tax: "details",
  days: "describe",
  parameters: "describe",
  products: "products",
  "products-without-grants": "package",
  "offsite-without-product": "package",
  "legacy-options": "package",
  legal: "legal",
};

const STATUS_STYLE: Record<ReadinessStatus, { dot: string; text: string; label: string }> = {
  ok: { dot: "bg-emerald-500", text: "text-gray-700", label: "Done" },
  blocked: { dot: "bg-red-500", text: "text-red-700", label: "Blocked" },
  warning: { dot: "bg-amber-500", text: "text-amber-700", label: "Warning" },
  info: { dot: "bg-blue-400", text: "text-blue-700", label: "Note" },
};

const STAGE_BADGE: Record<ReadinessStatus, string> = {
  ok: "bg-emerald-100 text-emerald-700",
  blocked: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
  info: "bg-blue-100 text-blue-700",
};

export default function LaunchChecklist({ conferenceId, status, readiness }: LaunchChecklistProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const basePath = `/admin/conference/${conferenceId}`;
  const isDraft = status === "draft";

  const handleGoOnSale = async () => {
    setIsLoading(true);
    setError(null);
    const result = await transitionConferenceStatus(conferenceId, "registration_open");
    setIsLoading(false);
    setConfirming(false);
    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? "Could not open registration.");
    }
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Launch checklist</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Describe → Package → Sell. Clear every blocker to put this conference on sale.
          </p>
        </div>
        <div
          className={`rounded-md border px-3 py-1.5 text-sm font-medium ${
            readiness.canGoOnSale
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {readiness.canGoOnSale ? "Ready to open registration" : `${readiness.blockingCount} blocker(s) remaining`}
          {readiness.warningCount > 0 && (
            <span className="ml-1 text-xs font-normal text-amber-700">
              · {readiness.warningCount} warning(s)
            </span>
          )}
        </div>
      </div>

      <ol className="mt-4 space-y-4">
        {readiness.stages.map((stage, index) => (
          <li key={stage.key} className="rounded-md border border-gray-200">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                  {index + 1}
                </span>
                <span className="text-sm font-semibold text-gray-900">{stage.label}</span>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_BADGE[stage.status]}`}
              >
                {STATUS_STYLE[stage.status].label}
              </span>
            </div>
            <ul className="divide-y divide-gray-50">
              {stage.checks.map((check) => {
                const style = STATUS_STYLE[check.status];
                return (
                  <li key={check.id} className="flex items-start gap-3 px-4 py-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm font-medium ${style.text}`}>{check.label}</p>
                      <p className="text-xs text-gray-500">{check.detail}</p>
                    </div>
                    {check.status !== "ok" && check.fixStage && (
                      <Link
                        href={`${basePath}/${
                          CHECK_FIX_SEGMENT[check.id] ?? STAGE_FIX_SEGMENT[check.fixStage]
                        }`}
                        className="shrink-0 text-xs font-medium text-accent hover:underline"
                      >
                        Fix →
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isDraft && (
        <div className="mt-5 flex items-center gap-3">
          {confirming ? (
            <>
              <span className="text-sm text-gray-700">Open registration to the public?</span>
              <button
                onClick={handleGoOnSale}
                disabled={isLoading}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isLoading ? "Opening…" : "Confirm — go on sale"}
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              disabled={!readiness.canGoOnSale}
              title={
                readiness.canGoOnSale
                  ? undefined
                  : "Clear all blockers above before opening registration."
              }
              className="rounded-md bg-accent px-5 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              Go on sale
            </button>
          )}
          {!readiness.canGoOnSale && !confirming && (
            <span className="text-xs text-gray-500">Resolve the blockers above to enable.</span>
          )}
        </div>
      )}
    </div>
  );
}
