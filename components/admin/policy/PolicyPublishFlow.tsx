"use client";

import { useState, useEffect } from "react";

function localInputNow(offsetMs = 0): string {
  const d = new Date(Date.now() + offsetMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
import type { PolicySet } from "@/lib/policy/types";
import type { PolicyDiff, ImpactPreview } from "@/lib/actions/policy";
import {
  getImpactPreview,
  publishDraft,
} from "@/lib/actions/policy";

interface Props {
  draft: PolicySet;
  activeSetId: string;
  onPublished: () => void;
  onCancel: () => void;
}

export default function PolicyPublishFlow({
  draft,
  activeSetId,
  onPublished,
  onCancel,
}: Props) {
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [effectiveAt, setEffectiveAt] = useState<string>("");
  const [confirmations, setConfirmations] = useState<Record<string, string>>({});

  useEffect(() => {
    loadPreview();
  }, [draft.id]);

  async function loadPreview() {
    setLoading(true);
    const result = await getImpactPreview(draft.id);
    setLoading(false);
    if (result.success && result.data) {
      setPreview(result.data);
    } else {
      setError(result.error ?? "Failed to load preview");
    }
  }

  const highRiskChanges =
    preview?.changes.filter((c) => c.isHighRisk) ?? [];
  const allConfirmed = highRiskChanges.every(
    (c) => confirmations[c.key] === "CONFIRM"
  );

  async function handlePublish() {
    setError(null);
    setPublishing(true);
    const result = await publishDraft(
      draft.id,
      effectiveAt || null,
      confirmations
    );
    setPublishing(false);
    if (!result.success) {
      setError(result.error ?? "Publish failed");
      return;
    }
    onPublished();
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-[var(--text-secondary)] text-sm">
        Loading impact preview...
      </div>
    );
  }

  if (!preview || preview.changes.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Review & Publish
        </h2>
        <div className="p-8 text-center border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
          <p className="text-[var(--text-secondary)] text-sm">
            No changes detected between draft and active policy set.
          </p>
        </div>
        <button
          onClick={onCancel}
          className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">
        Review & Publish: {draft.name}
      </h2>

      {/* Changes Diff */}
      <section>
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
          Changes ({preview.changes.length})
        </h3>
        <div className="space-y-2">
          {preview.changes.map((change) => (
            <DiffRow key={change.key} change={change} />
          ))}
        </div>
      </section>

      {/* Impact Preview */}
      {preview.impacts.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-[var(--text-primary)] mb-3">
            Impact Assessment
          </h3>
          <div className="space-y-2">
            {preview.impacts.map((impact, i) => (
              <div
                key={i}
                className="p-3 bg-blue-50 border border-blue-200 rounded-[var(--radius-md)] text-sm text-blue-800"
              >
                <span className="text-xs font-medium uppercase text-[#EE2A2E] mr-2">
                  {impact.category}
                </span>
                {impact.description}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Effective Date */}
      <section>
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-2">
          Effective Date
        </h3>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!effectiveAt}
              onChange={() => setEffectiveAt("")}
              className="accent-[var(--accent-primary)]"
            />
            Immediate
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              checked={!!effectiveAt}
              onChange={() =>
                setEffectiveAt(localInputNow(86400000))
              }
              className="accent-[var(--accent-primary)]"
            />
            Scheduled
          </label>
          {effectiveAt && (
            <input
              type="datetime-local"
              value={effectiveAt}
              onChange={(e) => setEffectiveAt(e.target.value)}
              min={localInputNow()}
              className="border border-[var(--border-default)] rounded px-2 py-1 text-sm"
            />
          )}
        </div>
      </section>

      {/* High-Risk Confirmations */}
      {highRiskChanges.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-red-700 mb-3">
            High-Risk Confirmations Required
          </h3>
          <div className="space-y-3">
            {highRiskChanges.map((change) => (
              <div
                key={change.key}
                className="p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)]"
              >
                <p className="text-sm text-red-800 mb-2">
                  <span className="font-medium">{change.label}</span>:{" "}
                  {JSON.stringify(change.oldValue)} &rarr;{" "}
                  {JSON.stringify(change.newValue)}
                </p>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder='Type "CONFIRM" to proceed'
                    value={confirmations[change.key] ?? ""}
                    onChange={(e) =>
                      setConfirmations((prev) => ({
                        ...prev,
                        [change.key]: e.target.value,
                      }))
                    }
                    className="flex-1 border border-red-300 rounded px-2 py-1 text-sm"
                  />
                  {confirmations[change.key] === "CONFIRM" && (
                    <span className="text-green-600 text-xs font-medium">
                      Confirmed
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-[var(--border-subtle)]">
        <button
          onClick={handlePublish}
          disabled={
            publishing ||
            (highRiskChanges.length > 0 && !allConfirmed)
          }
          className="px-6 py-2 text-sm bg-green-600 text-white rounded-[var(--radius-md)] hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {publishing
            ? "Publishing..."
            : effectiveAt
              ? "Schedule Publish"
              : "Publish Now"}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Diff Row ─────────────────────────────────────────────────

function DiffRow({ change }: { change: PolicyDiff }) {
  return (
    <div
      className={`p-3 border rounded-[var(--radius-md)] ${
        change.isHighRisk
          ? "border-red-200 bg-red-50/50"
          : "border-[var(--border-subtle)] bg-white"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm font-medium text-[var(--text-primary)]">
          {change.label}
        </span>
        {change.isHighRisk && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-100 text-red-700 rounded">
            HIGH RISK
          </span>
        )}
        <span className="text-[10px] text-[var(--text-tertiary)]">
          {change.key}
        </span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-red-600 line-through">
          {formatShort(change.oldValue)}
        </span>
        <span className="text-[var(--text-tertiary)]">&rarr;</span>
        <span className="text-green-700 font-medium">
          {formatShort(change.newValue)}
        </span>
      </div>
    </div>
  );
}

function formatShort(val: unknown): string {
  if (val === null || val === undefined) return "—";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (Array.isArray(val)) {
    if (val.length <= 3) return JSON.stringify(val);
    return `[${val.length} items]`;
  }
  if (typeof val === "object") return JSON.stringify(val);
  return String(val);
}
