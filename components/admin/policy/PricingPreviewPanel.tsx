"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  applyPricingOverrideAction,
  getPricingPreviewAction,
  listMemberOrganizationsAction,
} from "@/lib/actions/policy-pricing";

interface Props {
  draftSetId: string;
  isSuperAdmin: boolean;
}

interface PreviewRow {
  organizationId: string;
  organizationName: string;
  currentAmountCents: number;
  draftAmountCents: number;
  diffCents: number;
  currentStatus: "computed" | "fallback_used" | "manual_required" | "manual_override";
  draftStatus: "computed" | "fallback_used" | "manual_required" | "manual_override";
}

interface OrgOption {
  id: string;
  name: string;
}

interface PricingModelSummary {
  policySetId: string;
  pricingMode: string;
  metricKey: string;
  fallbackBehavior: string;
  roundingRule: string;
  manualOverrideAllowed: boolean;
  overridePersistence: string;
  partnershipRate: number;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function statusBadge(status: PreviewRow["draftStatus"]): string {
  if (status === "computed") return "bg-green-100 text-green-700";
  if (status === "fallback_used") return "bg-amber-100 text-amber-700";
  if (status === "manual_required") return "bg-red-100 text-red-700";
  return "bg-blue-100 text-[#D92327]";
}

export default function PricingPreviewPanel({ draftSetId, isSuperAdmin }: Props) {
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [orgOptions, setOrgOptions] = useState<OrgOption[]>([]);
  const [sampleSize, setSampleSize] = useState(10);
  const [previewScope, setPreviewScope] = useState<"sample" | "all">("sample");
  const [previewOrgCount, setPreviewOrgCount] = useState(0);
  const [modelSummary, setModelSummary] = useState<{
    current: PricingModelSummary;
    draft: PricingModelSummary;
  } | null>(null);
  const [impactSummary, setImpactSummary] = useState<{
    increased: number;
    decreased: number;
    unchanged: number;
    draftStatusCounts: {
      computed: number;
      fallback_used: number;
      manual_required: number;
      manual_override: number;
    };
  } | null>(null);
  const [partnershipImpact, setPartnershipImpact] = useState<{
    partnerCount: number;
    currentTotalCents: number;
    draftTotalCents: number;
    diffCents: number;
  } | null>(null);
  const [lastComputedAt, setLastComputedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string>("");
  const [billingCycleYear, setBillingCycleYear] = useState<number>(new Date().getUTCFullYear());
  const [amountDollars, setAmountDollars] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.current += row.currentAmountCents;
        acc.next += row.draftAmountCents;
        acc.diff += row.diffCents;
        return acc;
      },
      { current: 0, next: 0, diff: 0 }
    );
  }, [rows]);

  const loadPreview = (
    requestedSampleSize = sampleSize,
    mode: "sample" | "all" = previewScope
  ) => {
    startTransition(async () => {
      setError(null);
      const result = await getPricingPreviewAction(
        draftSetId,
        requestedSampleSize,
        mode
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.rows);
      setPreviewScope(result.scope);
      setPreviewOrgCount(result.orgCount);
      setModelSummary(result.models);
      setImpactSummary(result.impact);
      setPartnershipImpact(result.partnershipImpact);
      setLastComputedAt(new Date().toLocaleTimeString());
    });
  };

  useEffect(() => {
    loadPreview(10, "sample");
    startTransition(async () => {
      const orgsResult = await listMemberOrganizationsAction();
      if (!orgsResult.success) {
        setError(orgsResult.error);
        return;
      }
      setOrgOptions(orgsResult.organizations);
      if (!orgId && orgsResult.organizations.length > 0) {
        setOrgId(orgsResult.organizations[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftSetId]);

  const applyOverride = () => {
    if (!isSuperAdmin) return;
    startTransition(async () => {
      setError(null);
      const parsedAmount = Number(amountDollars);
      const result = await applyPricingOverrideAction({
        organizationId: orgId,
        policySetId: draftSetId,
        billingCycleYear,
        amountDollars: parsedAmount,
        reason,
      });

      if (!result.success) {
        setError(result.error);
        return;
      }

      setReason("");
      setAmountDollars("");
      loadPreview(sampleSize);
    });
  };

  return (
    <section className="mb-6 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Pricing Preview</h3>
          <p className="text-xs text-[var(--text-secondary)]">
            Compare draft vs current membership pricing for member organizations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--text-secondary)]">Sample size</label>
          <select
            value={sampleSize}
            onChange={(event) => {
              const size = Number(event.target.value);
              setSampleSize(size);
              loadPreview(size);
            }}
            className="rounded border border-[var(--border-default)] px-2 py-1 text-xs"
          >
            {[5, 10, 20, 30].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => loadPreview(sampleSize, "sample")}
            className="rounded border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-gray-50"
            disabled={isPending}
          >
            {isPending ? "Computing..." : "Refresh Sample"}
          </button>
          <button
            type="button"
            onClick={() => loadPreview(sampleSize, "all")}
            className="rounded border border-[var(--border-default)] px-2 py-1 text-xs text-[var(--text-primary)] hover:bg-gray-50"
            disabled={isPending}
          >
            {isPending ? "Computing..." : "Compute All Members"}
          </button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-[var(--text-tertiary)]">
        Showing {previewScope === "all" ? "all member organizations" : "sample"} ({previewOrgCount} orgs).
        {lastComputedAt ? ` Last computed at ${lastComputedAt}.` : ""}
      </p>
      <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">
        Note: partnership pricing is modeled separately below.
      </p>
      {error ? (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      ) : null}

      {modelSummary ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <div className="rounded border border-[var(--border-subtle)] bg-gray-50 p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">Current Model</p>
            <p className="mt-1 text-[var(--text-secondary)]">
              {modelSummary.current.pricingMode} on {modelSummary.current.metricKey}
            </p>
            <p className="text-[var(--text-tertiary)]">
              fallback: {modelSummary.current.fallbackBehavior} | rounding: {modelSummary.current.roundingRule}
            </p>
            <p className="text-[var(--text-tertiary)]">
              partnership rate: {formatCents(Math.round(modelSummary.current.partnershipRate * 100))}
            </p>
          </div>
          <div className="rounded border border-[var(--border-subtle)] bg-gray-50 p-3 text-xs">
            <p className="font-semibold text-[var(--text-primary)]">Draft Model</p>
            <p className="mt-1 text-[var(--text-secondary)]">
              {modelSummary.draft.pricingMode} on {modelSummary.draft.metricKey}
            </p>
            <p className="text-[var(--text-tertiary)]">
              fallback: {modelSummary.draft.fallbackBehavior} | rounding: {modelSummary.draft.roundingRule}
            </p>
            <p className="text-[var(--text-tertiary)]">
              partnership rate: {formatCents(Math.round(modelSummary.draft.partnershipRate * 100))}
            </p>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div className="rounded border border-[var(--border-subtle)] bg-gray-50 px-3 py-2 text-xs">
          <p className="text-[var(--text-secondary)]">Current total</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{formatCents(totals.current)}</p>
        </div>
        <div className="rounded border border-[var(--border-subtle)] bg-gray-50 px-3 py-2 text-xs">
          <p className="text-[var(--text-secondary)]">Draft total</p>
          <p className="text-sm font-semibold text-[var(--text-primary)]">{formatCents(totals.next)}</p>
        </div>
        <div className="rounded border border-[var(--border-subtle)] bg-gray-50 px-3 py-2 text-xs">
          <p className="text-[var(--text-secondary)]">Revenue delta</p>
          <p className={`text-sm font-semibold ${totals.diff >= 0 ? "text-green-700" : "text-red-700"}`}>
            {totals.diff >= 0 ? "+" : ""}
            {formatCents(totals.diff)}
          </p>
        </div>
      </div>

      {impactSummary ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <div className="rounded border border-[var(--border-subtle)] px-3 py-2 text-xs">
            <p className="text-[var(--text-secondary)]">Price impact mix</p>
            <p className="text-[var(--text-primary)]">
              +{impactSummary.increased} / -{impactSummary.decreased} / ={impactSummary.unchanged}
            </p>
          </div>
          <div className="rounded border border-[var(--border-subtle)] px-3 py-2 text-xs">
            <p className="text-[var(--text-secondary)]">Draft computed</p>
            <p className="text-[var(--text-primary)]">{impactSummary.draftStatusCounts.computed}</p>
          </div>
          <div className="rounded border border-[var(--border-subtle)] px-3 py-2 text-xs">
            <p className="text-[var(--text-secondary)]">Draft fallback/manual</p>
            <p className="text-[var(--text-primary)]">
              {impactSummary.draftStatusCounts.fallback_used} fallback,{" "}
              {impactSummary.draftStatusCounts.manual_required} manual required
            </p>
          </div>
        </div>
      ) : null}

      {partnershipImpact ? (
        <div className="mt-2 rounded border border-[var(--border-subtle)] px-3 py-2 text-xs">
          <p className="text-[var(--text-secondary)]">Vendor partner impact (flat-rate)</p>
          <p className="text-[var(--text-primary)]">
            {partnershipImpact.partnerCount} partners: {formatCents(partnershipImpact.currentTotalCents)}{" -> "}
            {formatCents(partnershipImpact.draftTotalCents)}{" "}
            <span className={partnershipImpact.diffCents >= 0 ? "text-green-700" : "text-red-700"}>
              ({partnershipImpact.diffCents >= 0 ? "+" : ""}
              {formatCents(partnershipImpact.diffCents)})
            </span>
          </p>
        </div>
      ) : null}

      <div className="mt-4 overflow-x-auto rounded border border-[var(--border-subtle)]">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-left text-[var(--text-secondary)]">
            <tr>
              <th className="px-3 py-2 font-medium">Organization</th>
              <th className="px-3 py-2 font-medium">Current</th>
              <th className="px-3 py-2 font-medium">Draft</th>
              <th className="px-3 py-2 font-medium">Delta</th>
              <th className="px-3 py-2 font-medium">Draft Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.organizationId} className="border-t border-[var(--border-subtle)]">
                <td className="px-3 py-2 text-[var(--text-primary)]">{row.organizationName}</td>
                <td className="px-3 py-2">{formatCents(row.currentAmountCents)}</td>
                <td className="px-3 py-2">{formatCents(row.draftAmountCents)}</td>
                <td className={`px-3 py-2 ${row.diffCents >= 0 ? "text-green-700" : "text-red-700"}`}>
                  {row.diffCents >= 0 ? "+" : ""}
                  {formatCents(row.diffCents)}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${statusBadge(row.draftStatus)}`}>
                    {row.draftStatus}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td className="px-3 py-3 text-[var(--text-tertiary)]" colSpan={5}>
                  No member organizations matched the pricing preview filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {isSuperAdmin ? (
        <div className="mt-4 rounded border border-[var(--border-subtle)] p-3">
          <h4 className="text-xs font-semibold text-[var(--text-primary)]">Manual override</h4>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            Set a specific price for one org in this draft policy set with a required reason.
          </p>
          <div className="mt-3 grid gap-2 md:grid-cols-4">
            <select
              value={orgId}
              onChange={(event) => setOrgId(event.target.value)}
              className="rounded border border-[var(--border-default)] px-2 py-1.5 text-xs"
            >
              {orgOptions.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
            <input
              type="number"
              step="0.01"
              min="0"
              value={amountDollars}
              onChange={(event) => setAmountDollars(event.target.value)}
              placeholder="Amount (CAD)"
              className="rounded border border-[var(--border-default)] px-2 py-1.5 text-xs"
            />
            <input
              type="number"
              min="2020"
              max="2100"
              value={billingCycleYear}
              onChange={(event) => setBillingCycleYear(Number(event.target.value) || new Date().getUTCFullYear())}
              className="rounded border border-[var(--border-default)] px-2 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={isPending || !orgId || amountDollars.trim().length === 0 || reason.trim().length === 0}
              onClick={applyOverride}
              className="rounded bg-[var(--text-primary)] px-2 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Apply Override
            </button>
          </div>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            placeholder="Required reason"
            className="mt-2 w-full rounded border border-[var(--border-default)] px-2 py-1.5 text-xs"
          />
        </div>
      ) : null}

    </section>
  );
}
