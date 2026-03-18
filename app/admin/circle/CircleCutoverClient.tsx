"use client";

import { useState } from "react";
import type { CircleCutoverStatus, BackfillResult, CutoverValidationResult } from "@/lib/circle/cutover";

interface LinkResult {
  checked: number;
  linked: number;
  notFound: number;
  errors: string[];
  dryRun: boolean;
}

interface Props {
  initialStatus: CircleCutoverStatus;
}

export default function CircleCutoverClient({ initialStatus }: Props) {
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState<string | null>(null);
  const [backfillResult, setBackfillResult] = useState<BackfillResult | null>(null);
  const [validationResult, setValidationResult] = useState<CutoverValidationResult | null>(null);
  const [linkResult, setLinkResult] = useState<LinkResult | null>(null);
  const [linkEmail, setLinkEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  // ---- helpers ----

  async function refreshStatus() {
    try {
      const res = await fetch("/api/admin/circle/validate");
      if (res.ok) {
        const validation = await res.json() as CutoverValidationResult;
        setValidationResult(validation);
      }
    } catch {
      // non-critical
    }
  }

  async function setFlag(key: string, value: unknown) {
    setLoading(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/circle/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Flag update failed");

      // Optimistic update
      if (key === "integration.circle_cutover_enabled") {
        setStatus((s) => ({ ...s, cutoverEnabled: Boolean(value) }));
      } else if (key === "integration.circle_legacy_fallback_enabled") {
        setStatus((s) => ({ ...s, legacyFallbackEnabled: Boolean(value) }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function runBackfill(dryRun: boolean) {
    setLoading(dryRun ? "dry-run" : "backfill");
    setError(null);
    setBackfillResult(null);
    try {
      const res = await fetch("/api/admin/circle/backfill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, limit: 500 }),
      });
      const data = await res.json() as BackfillResult;
      if (!res.ok) throw new Error(JSON.stringify(data));
      setBackfillResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function runLinkExisting(dryRun: boolean, email?: string) {
    const key = email ? "link-single" : dryRun ? "link-dry" : "link-batch";
    setLoading(key);
    setError(null);
    setLinkResult(null);
    try {
      const res = await fetch("/api/admin/circle/link-existing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dryRun, limit: 50, ...(email ? { email } : {}) }),
      });
      const data = await res.json() as LinkResult;
      if (!res.ok) throw new Error(JSON.stringify(data));
      setLinkResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  async function runValidation() {
    setLoading("validate");
    setError(null);
    try {
      const res = await fetch("/api/admin/circle/validate");
      const data = await res.json() as CutoverValidationResult;
      if (!res.ok) throw new Error(JSON.stringify(data));
      setValidationResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }

  const { stats } = status;
  const linkedPct = stats.totalContacts > 0
    ? Math.round((stats.linkedContacts / stats.totalContacts) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Error banner */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Status cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard label="Total contacts" value={stats.totalContacts} />
        <StatCard label="Linked to Circle" value={`${stats.linkedContacts} (${linkedPct}%)`} />
        <StatCard label="Mapping entries" value={stats.mappingEntries} />
        <StatCard label="Verified mappings" value={stats.verifiedMappings} />
        <StatCard label="Pending queue" value={stats.pendingQueueItems} />
        <StatCard
          label="Sync failures (24h)"
          value={stats.recentSyncFailures}
          highlight={stats.recentSyncFailures > 5 ? "red" : stats.recentSyncFailures > 0 ? "yellow" : "green"}
        />
      </div>

      {/* Feature flags — kill switches */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Feature Flags (Kill Switches)</h2>
        <p className="text-xs text-gray-500">
          These write directly to the active policy set, bypassing the draft workflow.
          Changes take effect immediately on next request.
        </p>

        <FlagToggle
          label="Circle Cutover Enabled"
          description="Enables Supabase-driven Circle auth and sync write paths."
          checked={status.cutoverEnabled}
          disabled={loading !== null}
          onChange={(v) => setFlag("integration.circle_cutover_enabled", v)}
        />

        <FlagToggle
          label="Legacy Circle Fallback"
          description="Keep native Circle login active during rollout grace window. Disable after full cutover."
          checked={status.legacyFallbackEnabled}
          disabled={loading !== null}
          onChange={(v) => setFlag("integration.circle_legacy_fallback_enabled", v)}
        />

        {/* Canary org IDs */}
        <div>
          <p className="text-sm font-medium text-gray-700">Canary Org IDs</p>
          <p className="text-xs text-gray-500 mt-0.5">
            When non-empty, sync write paths only run for these orgs. Clear to enable globally.
          </p>
          <p className="mt-2 text-sm font-mono text-gray-800 break-all">
            {status.canaryOrgIds.length > 0
              ? status.canaryOrgIds.join(", ")
              : <span className="text-gray-400 italic">Empty — global</span>}
          </p>
        </div>
      </section>

      {/* Link Existing Users */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Link Existing Users to Circle</h2>
        <p className="text-sm text-gray-600">
          Searches Circle by email for each unlinked contact and sets{" "}
          <code className="text-xs">contacts.circle_id</code>. Run this once to bootstrap
          the integration for all existing users. Requires Circle API credentials.
        </p>

        {/* Single user */}
        <div>
          <p className="text-xs font-medium text-gray-700 mb-1">Link one user by email</p>
          <div className="flex gap-2">
            <input
              type="email"
              placeholder="user@example.com"
              value={linkEmail}
              onChange={(e) => setLinkEmail(e.target.value)}
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <ActionButton
              label="Link"
              loading={loading === "link-single"}
              onClick={() => runLinkExisting(false, linkEmail)}
              variant="primary"
            />
          </div>
        </div>

        {/* Batch */}
        <div>
          <p className="text-xs font-medium text-gray-700 mb-1">Batch link (up to 50 contacts per run)</p>
          <div className="flex gap-3">
            <ActionButton
              label="Dry Run"
              loading={loading === "link-dry"}
              onClick={() => runLinkExisting(true)}
              variant="secondary"
            />
            <ActionButton
              label="Link Batch"
              loading={loading === "link-batch"}
              onClick={() => runLinkExisting(false)}
              variant="primary"
            />
          </div>
        </div>

        {linkResult && (
          <div className="rounded bg-gray-50 border border-gray-200 p-4 text-sm font-mono space-y-1">
            <p>dry_run: {String(linkResult.dryRun)}</p>
            <p>checked: {linkResult.checked}</p>
            <p className="text-green-700">linked: {linkResult.linked}</p>
            <p className="text-yellow-700">not_found_in_circle: {linkResult.notFound}</p>
            {linkResult.errors.length > 0 && (
              <div className="mt-2 text-red-700">
                <p className="font-semibold">Errors ({linkResult.errors.length}):</p>
                {linkResult.errors.slice(0, 10).map((e, i) => (
                  <p key={i} className="text-xs">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Backfill */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">Member Mapping Backfill</h2>
        <p className="text-sm text-gray-600">
          Matches contacts (by email via their stored <code className="text-xs">circle_id</code>) to the{" "}
          <code className="text-xs">circle_member_mapping</code> table. Idempotent — safe to re-run.
        </p>

        <div className="flex gap-3">
          <ActionButton
            label="Dry Run"
            loading={loading === "dry-run"}
            onClick={() => runBackfill(true)}
            variant="secondary"
          />
          <ActionButton
            label="Run Backfill"
            loading={loading === "backfill"}
            onClick={() => runBackfill(false)}
            variant="primary"
          />
        </div>

        {backfillResult && (
          <div className="rounded bg-gray-50 border border-gray-200 p-4 text-sm font-mono space-y-1">
            <p>dry_run: {String(backfillResult.dryRun)}</p>
            <p>checked: {backfillResult.checked}</p>
            <p>matched: {backfillResult.matched}</p>
            <p>created: {backfillResult.created}</p>
            <p>skipped: {backfillResult.skipped}</p>
            {backfillResult.errors.length > 0 && (
              <div className="mt-2 text-red-700">
                <p className="font-semibold">Errors ({backfillResult.errors.length}):</p>
                {backfillResult.errors.slice(0, 10).map((e, i) => (
                  <p key={i} className="text-xs">{e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Pre-flight validation */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Pre-Flight Validation</h2>
          <ActionButton
            label="Run Checks"
            loading={loading === "validate"}
            onClick={runValidation}
            variant="secondary"
          />
        </div>

        {validationResult && (
          <div className="space-y-2">
            <div className={`text-sm font-semibold ${validationResult.ok ? "text-green-700" : "text-red-700"}`}>
              {validationResult.ok ? "All checks passed — ready for cutover" : "Issues found — resolve before cutover"}
            </div>
            {validationResult.checks.map((check) => (
              <div key={check.name} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 flex-shrink-0 ${check.passed ? "text-green-500" : "text-red-500"}`}>
                  {check.passed ? "✓" : "✗"}
                </span>
                <div>
                  <span className="font-medium text-gray-800">{check.name}</span>
                  <span className="ml-2 text-gray-500">{check.message}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Readiness issues from initial load */}
        {!validationResult && !status.readiness.ok && (
          <div className="space-y-1">
            {status.readiness.issues.map((issue, i) => (
              <div key={i} className="flex items-start gap-2 text-sm text-red-700">
                <span className="mt-0.5 flex-shrink-0">✗</span>
                <span>{issue}</span>
              </div>
            ))}
          </div>
        )}

        {!validationResult && status.readiness.ok && (
          <p className="text-sm text-green-700">No issues detected at last load. Run full validation to confirm.</p>
        )}
      </section>

      {/* Cutover plan reference */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-2">
        <h2 className="font-semibold text-gray-900">Cutover Sequence</h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
          <li>Run dry-run backfill — confirm matched count looks right</li>
          <li>Run backfill — populate <code className="text-xs">circle_member_mapping</code></li>
          <li>Run pre-flight validation — all checks must pass</li>
          <li>Set canary org IDs → enable cutover → verify with canary cohort</li>
          <li>Clear canary org IDs → cutover applies globally</li>
          <li>Monitor ops dashboard for sync failures (target: 0 in first 30 min)</li>
          <li>Once stable: disable Legacy Fallback flag</li>
          <li>
            <strong>Rollback:</strong> disable Circle Cutover Enabled — legacy path reactivates
            immediately (no deploy required)
          </li>
        </ol>
      </section>
    </div>
  );
}

// ---- Sub-components --------------------------------------------------------

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string | number;
  highlight?: "red" | "yellow" | "green";
}) {
  const valueClass =
    highlight === "red"
      ? "text-red-600"
      : highlight === "yellow"
      ? "text-yellow-600"
      : highlight === "green"
      ? "text-green-600"
      : "text-gray-900";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

function FlagToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        <p className="text-xs text-gray-500">{description}</p>
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors
          ${checked ? "bg-green-500" : "bg-gray-300"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
        aria-pressed={checked}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform
            ${checked ? "translate-x-5" : "translate-x-0"}
          `}
        />
      </button>
    </div>
  );
}

function ActionButton({
  label,
  loading,
  onClick,
  variant,
}: {
  label: string;
  loading: boolean;
  onClick: () => void;
  variant: "primary" | "secondary";
}) {
  const base = "px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50";
  const styles =
    variant === "primary"
      ? `${base} bg-blue-600 text-white hover:bg-blue-700`
      : `${base} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50`;

  return (
    <button type="button" disabled={loading} onClick={onClick} className={styles}>
      {loading ? "Working…" : label}
    </button>
  );
}
