"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { parseUTC } from "@/lib/utils";
import type { PolicySet } from "@/lib/policy/types";
import type { PolicyDiff } from "@/lib/actions/policy-types";
import {
  getPolicyVersionHistory,
  getPolicyDiff,
  rollbackToVersion,
} from "@/lib/actions/policy";

interface Props {
  isSuperAdmin: boolean;
}

export default function PolicyVersionHistory({ isSuperAdmin }: Props) {
  const router = useRouter();
  const [versions, setVersions] = useState<PolicySet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDiff, setExpandedDiff] = useState<PolicyDiff[] | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState<PolicySet | null>(null);
  const [rollbackReason, setRollbackReason] = useState("");
  const [rollbackConfirm, setRollbackConfirm] = useState("");
  const [rollbackLoading, setRollbackLoading] = useState(false);

  useEffect(() => {
    loadHistory();
  }, []);

  async function loadHistory() {
    const result = await getPolicyVersionHistory();
    setLoading(false);
    if (result.success && result.data) {
      setVersions(result.data);
    } else {
      setError(result.error ?? "Failed to load history");
    }
  }

  async function toggleExpand(version: PolicySet, index: number) {
    if (expandedId === version.id) {
      setExpandedId(null);
      setExpandedDiff(null);
      return;
    }

    setExpandedId(version.id);
    setExpandedDiff(null);

    // Diff against the next (older) version
    const olderVersion = versions[index + 1];
    if (!olderVersion) {
      setExpandedDiff([]);
      return;
    }

    setDiffLoading(true);
    const result = await getPolicyDiff(olderVersion.id, version.id);
    setDiffLoading(false);
    if (result.success && result.data) {
      setExpandedDiff(result.data);
    }
  }

  async function handleRollback() {
    if (!rollbackTarget) return;
    setError(null);
    setRollbackLoading(true);
    const result = await rollbackToVersion(rollbackTarget.id, rollbackReason);
    setRollbackLoading(false);
    if (!result.success) {
      setError(result.error ?? "Rollback failed");
      return;
    }
    setRollbackTarget(null);
    setRollbackReason("");
    setRollbackConfirm("");
    router.refresh();
  }

  if (loading) {
    return (
      <div className="text-center py-12 text-[var(--text-secondary)] text-sm">
        Loading version history...
      </div>
    );
  }

  // Rollback dialog
  if (rollbackTarget) {
    return (
      <div className="space-y-6">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          Rollback to: {rollbackTarget.name}
        </h2>
        <p className="text-sm text-[var(--text-secondary)]">
          This will create a new published policy set based on the selected
          version and activate it immediately.
        </p>

        <div>
          <label className="text-sm font-medium text-[var(--text-primary)] block mb-1">
            Reason for rollback
          </label>
          <textarea
            value={rollbackReason}
            onChange={(e) => setRollbackReason(e.target.value)}
            rows={3}
            placeholder="Why are you rolling back?"
            className="w-full border border-[var(--border-default)] rounded-[var(--radius-md)] px-3 py-2 text-sm"
          />
        </div>

        <div className="p-4 bg-red-50 border border-red-200 rounded-[var(--radius-md)]">
          <p className="text-sm text-red-800 mb-2">
            Type &quot;CONFIRM&quot; to proceed with the rollback.
          </p>
          <input
            type="text"
            value={rollbackConfirm}
            onChange={(e) => setRollbackConfirm(e.target.value)}
            placeholder='Type "CONFIRM"'
            className="w-48 border border-red-300 rounded px-2 py-1 text-sm"
          />
        </div>

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={handleRollback}
            disabled={
              rollbackLoading ||
              rollbackConfirm !== "CONFIRM" ||
              !rollbackReason.trim()
            }
            className="px-6 py-2 text-sm bg-red-600 text-white rounded-[var(--radius-md)] hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {rollbackLoading ? "Rolling back..." : "Rollback"}
          </button>
          <button
            onClick={() => {
              setRollbackTarget(null);
              setRollbackReason("");
              setRollbackConfirm("");
            }}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        Version History
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-[var(--radius-md)] text-sm text-red-700">
          {error}
        </div>
      )}

      {versions.length === 0 ? (
        <div className="text-center py-12 text-[var(--text-tertiary)] text-sm">
          No published versions yet.
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((version, index) => (
            <div
              key={version.id}
              className="border border-[var(--border-subtle)] rounded-[var(--radius-md)] bg-white"
            >
              <button
                onClick={() => toggleExpand(version, index)}
                className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {version.name}
                    </span>
                    {version.is_active && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    Published{" "}
                    {version.published_at
                      ? parseUTC(version.published_at).toLocaleString("en-CA")
                      : "—"}
                  </span>
                </div>
                <span className="text-xs text-[var(--text-tertiary)]">
                  {expandedId === version.id ? "▲" : "▼"}
                </span>
              </button>

              {expandedId === version.id && (
                <div className="px-4 pb-4 border-t border-[var(--border-subtle)]">
                  {version.notes && (
                    <p className="text-xs text-[var(--text-secondary)] mt-3 mb-2">
                      {version.notes}
                    </p>
                  )}

                  {diffLoading ? (
                    <p className="text-xs text-[var(--text-tertiary)] py-4">
                      Loading diff...
                    </p>
                  ) : expandedDiff && expandedDiff.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      <p className="text-xs font-medium text-[var(--text-secondary)] mb-2">
                        Changes from previous version:
                      </p>
                      {expandedDiff.map((d) => (
                        <div
                          key={d.key}
                          className="text-xs px-3 py-2 bg-gray-50 rounded"
                        >
                          <span className="font-medium">{d.label}</span>:{" "}
                          <span className="text-red-600 line-through">
                            {formatShort(d.oldValue)}
                          </span>{" "}
                          &rarr;{" "}
                          <span className="text-green-700">
                            {formatShort(d.newValue)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)] py-4">
                      {index === versions.length - 1
                        ? "Initial version — no previous version to compare."
                        : "No changes from previous version."}
                    </p>
                  )}

                  {isSuperAdmin && !version.is_active && (
                    <button
                      onClick={() => setRollbackTarget(version)}
                      className="mt-3 px-3 py-1.5 text-xs border border-red-300 text-red-700 rounded-[var(--radius-md)] hover:bg-red-50 transition-colors"
                    >
                      Rollback to this version
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
