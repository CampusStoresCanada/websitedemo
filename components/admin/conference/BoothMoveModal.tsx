"use client";

import { useEffect, useState } from "react";
import { previewBoothMove, moveBooths, type BoothMovePreview } from "@/lib/actions/conference-booth-moves";
import type { FloorPlanBooth } from "@/lib/actions/conference-entities";

const centsToStr = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function BoothMoveModal({
  conferenceId,
  organizationId,
  orgName,
  oldBooths,
  allBooths,
  onClose,
  onSuccess,
}: {
  conferenceId: string;
  organizationId: string;
  orgName: string;
  oldBooths: Array<{ id: string; name: string }>;
  allBooths: FloorPlanBooth[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const oldIds = oldBooths.map(b => b.id);
  const candidates = allBooths
    .filter(b => b.status !== "sold" || oldIds.includes(b.id))
    .filter(b => !oldIds.includes(b.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));

  const [newIds, setNewIds]         = useState<Set<string>>(new Set());
  const [reason, setReason]         = useState("");
  const [preview, setPreview]       = useState<BoothMovePreview | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ checkoutUrl: string | null; minted: boolean } | null>(null);
  const [confirmErr, setConfirmErr] = useState<string | null>(null);

  const newIdsKey = [...newIds].sort().join(",");

  useEffect(() => {
    if (newIds.size === 0) { setPreview(null); setPreviewErr(null); return; }
    let cancelled = false;
    setLoadingPreview(true);
    previewBoothMove(organizationId, conferenceId, oldIds, [...newIds]).then(res => {
      if (cancelled) return;
      setLoadingPreview(false);
      if (res.success) { setPreview(res.data); setPreviewErr(null); }
      else { setPreview(null); setPreviewErr(res.error); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newIdsKey]);

  const toggleNew = (id: string) => {
    setNewIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const confirm = async () => {
    if (!preview || newIds.size === 0) return;
    setConfirming(true);
    setConfirmErr(null);
    const res = await moveBooths({
      organizationId,
      conferenceId,
      oldBoothEntityIds: oldIds,
      newBoothEntityIds: [...newIds],
      reason: reason.trim(),
    });
    setConfirming(false);
    if (!res.success) { setConfirmErr(res.error); return; }
    setResult({ checkoutUrl: res.data.checkoutUrl, minted: res.data.minted });
  };

  if (result) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
          <h2 className="text-base font-semibold text-gray-900">Booth move complete</h2>
          {result.minted ? (
            <p className="mt-2 text-sm text-gray-600">
              New booth(s) minted immediately — the refund covered the difference.
            </p>
          ) : (
            <div className="mt-2 space-y-2 text-sm text-gray-600">
              <p>The new booths cost more. A Stripe Checkout link was created for the difference — send this to {orgName} to complete the move:</p>
              <div className="break-all rounded border border-gray-200 bg-gray-50 p-2 text-xs font-mono">
                {result.checkoutUrl}
              </div>
              <p className="text-[11px] text-gray-400">The new booths are reserved but won&apos;t appear as sold until that session is paid.</p>
            </div>
          )}
          <button type="button" onClick={onSuccess}
            className="mt-4 w-full rounded-md bg-gray-900 py-2 text-sm font-medium text-white hover:bg-gray-800">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">Move booth(s)</h2>
        <p className="mt-1 text-sm text-gray-500">
          {orgName} — moving {oldBooths.map(b => b.name).join(", ")}
        </p>

        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Select new booth(s)</h3>
          <div className="mt-1.5 max-h-56 overflow-y-auto rounded border border-gray-200">
            {candidates.map(b => (
              <label key={b.id}
                className={`flex cursor-pointer items-center justify-between gap-2 border-b border-gray-100 px-2.5 py-1.5 text-sm last:border-b-0 ${
                  newIds.has(b.id) ? "bg-[#fff1f1]" : "hover:bg-gray-50"
                }`}>
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={newIds.has(b.id)} onChange={() => toggleNew(b.id)} />
                  {b.number ? `${b.number} · ` : ""}{b.name}
                  {b.status === "reserved" ? <span className="text-[10px] text-amber-600">in cart</span> : null}
                </span>
                <span className="text-gray-400">{b.priceCents != null ? centsToStr(b.priceCents) : "—"}</span>
              </label>
            ))}
            {candidates.length === 0 ? (
              <p className="px-2.5 py-2 text-xs text-gray-400">No other booths available at this conference.</p>
            ) : null}
          </div>
        </div>

        <div className="mt-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Reason (optional)</label>
          <input type="text" value={reason} onChange={e => setReason(e.target.value)}
            placeholder="e.g. requested larger footprint"
            className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-[#EE2A2E]" />
        </div>

        {loadingPreview ? <p className="mt-3 text-xs text-gray-400">Pricing…</p> : null}
        {previewErr ? <p className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{previewErr}</p> : null}

        {preview ? (
          <div className="mt-3 rounded border border-gray-200 bg-gray-50 p-2.5 text-sm">
            <div className="flex justify-between text-[11px] text-gray-400">
              <span>Old subtotal + {preview.taxRatePct}% tax</span>
              <span>{centsToStr(preview.oldSubtotalCents)} + {centsToStr(preview.oldTaxCents)}</span>
            </div>
            <div className="flex justify-between"><span className="text-gray-500">Old total (tax incl.)</span><span>{centsToStr(preview.oldTotalCents)}</span></div>
            <div className="mt-1.5 flex justify-between text-[11px] text-gray-400">
              <span>New subtotal + {preview.taxRatePct}% tax</span>
              <span>{centsToStr(preview.newSubtotalCents)} + {centsToStr(preview.newTaxCents)}</span>
            </div>
            <div className="flex justify-between"><span className="text-gray-500">New total (tax incl.)</span><span>{centsToStr(preview.newTotalCents)}</span></div>
            <div className="mt-1 flex justify-between border-t border-gray-200 pt-1 font-medium">
              <span>{preview.deltaCents > 0 ? "Additional owed" : preview.deltaCents < 0 ? "Refund (tax incl.)" : "No difference"}</span>
              <span className={preview.deltaCents > 0 ? "text-amber-600" : preview.deltaCents < 0 ? "text-green-600" : ""}>
                {centsToStr(Math.abs(preview.deltaCents))}
              </span>
            </div>
            {preview.deltaCents > 0 ? (
              <p className="mt-1.5 text-[11px] text-amber-600">
                A Stripe Checkout link for the difference will be generated on confirm — the new booth(s) stay pending until it&apos;s paid.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-gray-400">
                The refund covers this fully — new booth(s) mint immediately on confirm.
              </p>
            )}
          </div>
        ) : null}

        {confirmErr ? <p className="mt-3 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{confirmErr}</p> : null}

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} disabled={confirming}
            className="flex-1 rounded-md border border-gray-300 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={confirm} disabled={!preview || confirming || newIds.size === 0}
            className="flex-1 rounded-md bg-[#EE2A2E] py-2 text-sm font-medium text-white hover:bg-[#d62327] disabled:opacity-50">
            {confirming ? "Processing…" : "Confirm move"}
          </button>
        </div>
      </div>
    </div>
  );
}
