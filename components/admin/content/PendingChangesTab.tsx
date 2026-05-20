"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PendingChangeWithRequester } from "@/lib/actions/pending-content-changes";
import { approvePendingChange, rejectPendingChange, approveBatch, rejectBatch } from "@/lib/actions/pending-content-changes";
import { fieldDisplayLabel } from "@/lib/editable-fields";
import { wordDiff, shouldShowDiff, type DiffToken } from "@/lib/word-diff";

interface PendingChangesTabProps {
  changes: PendingChangeWithRequester[];
}

type ActionState = {
  loading: boolean;
  done?: "approved" | "rejected";
  error?: string;
  showReject?: boolean;
  note: string;
  counterProposal: string;
  useCounter: boolean;
};

function DiffView({ before, after }: { before: string; after: string }) {
  const tokens: DiffToken[] = wordDiff(before, after);
  return (
    <span className="whitespace-pre-wrap break-words leading-relaxed">
      {tokens.map((tok, i) => {
        if (tok.type === "equal") return <span key={i}>{tok.text}</span>;
        if (tok.type === "remove")
          return (
            <span key={i} className="bg-red-100 text-red-700 line-through rounded-sm px-0.5">
              {tok.text}
            </span>
          );
        return (
          <span key={i} className="bg-emerald-100 text-emerald-700 rounded-sm px-0.5">
            {tok.text}
          </span>
        );
      })}
    </span>
  );
}

export default function PendingChangesTab({ changes }: PendingChangesTabProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});

  function stateFor(id: string): ActionState {
    return actionState[id] ?? { loading: false, note: "", counterProposal: "", useCounter: false };
  }

  function patchState(id: string, patch: Partial<ActionState>) {
    setActionState((prev) => ({ ...prev, [id]: { ...stateFor(id), ...patch } }));
  }

  // key = change.id for singles, batchId for batches
  async function handleApprove(key: string, isBatch: boolean) {
    patchState(key, { loading: true });
    const result = isBatch ? await approveBatch(key) : await approvePendingChange(key);
    if (result.success) {
      patchState(key, { loading: false, done: "approved" });
      startTransition(() => router.refresh());
    } else {
      patchState(key, { loading: false, error: result.error });
    }
  }

  async function handleReject(key: string, isBatch: boolean) {
    const { note, counterProposal, useCounter } = stateFor(key);
    patchState(key, { loading: true });
    const result = isBatch
      ? await rejectBatch(key, { note: note || undefined })
      : await rejectPendingChange(key, {
          note: note || undefined,
          counterProposalValue: useCounter && counterProposal.trim() ? counterProposal.trim() : undefined,
        });
    if (result.success) {
      patchState(key, { loading: false, done: "rejected" });
      startTransition(() => router.refresh());
    } else {
      patchState(key, { loading: false, error: result.error });
    }
  }

  // Group changes: batched ones together, singles stand alone
  type CardGroup = { key: string; isBatch: boolean; items: PendingChangeWithRequester[] };
  const groups: CardGroup[] = [];
  const seenBatches = new Set<string>();
  for (const change of changes) {
    if (change.batch_id) {
      if (!seenBatches.has(change.batch_id)) {
        seenBatches.add(change.batch_id);
        groups.push({
          key: change.batch_id,
          isBatch: true,
          items: changes.filter((c) => c.batch_id === change.batch_id),
        });
      }
    } else {
      groups.push({ key: change.id, isBatch: false, items: [change] });
    }
  }

  if (changes.length === 0) {
    return (
      <div className="py-16 text-center text-[#6B6B6B]">
        <p className="text-lg font-medium mb-1">No pending changes</p>
        <p className="text-sm">All content changes have been reviewed.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isPending && <div className="text-sm text-[#6B6B6B]">Refreshing…</div>}

      {groups.map(({ key, isBatch, items }) => {
        const state = stateFor(key);
        const first = items[0];

        if (state.done === "approved") {
          return (
            <div key={key} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-700">
              ✓ {isBatch ? `${items.length} changes` : "Change"} approved and published.
            </div>
          );
        }

        if (state.done === "rejected") {
          return (
            <div key={key} className="bg-slate-100 border border-slate-200 rounded-xl p-4 text-sm text-slate-500">
              ✗ {isBatch ? `${items.length} changes` : "Change"} rejected.
            </div>
          );
        }

        const expiresAt = first.expires_at
          ? new Date(first.expires_at.includes("T") || first.expires_at.endsWith("Z")
              ? first.expires_at
              : first.expires_at.replace(" ", "T") + "Z")
          : null;
        const isExpiringSoon = expiresAt && expiresAt.getTime() - Date.now() < 6 * 60 * 60 * 1000;

        return (
          <div key={key} className="bg-white border border-[#E5E5E5] rounded-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#E5E5E5] bg-slate-50">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-medium text-[#4A4A4A] bg-slate-200 px-2 py-0.5 rounded">
                  {first.target_table}
                </span>
                {isBatch ? (
                  <span className="text-sm font-semibold text-[#1A1A1A]">
                    {items.length} fields — {first.entity_display_name ?? ""}
                  </span>
                ) : (
                  <>
                    <span className="text-sm font-semibold text-[#1A1A1A]">
                      {fieldDisplayLabel(first.target_column)}
                    </span>
                    {first.entity_display_name && (
                      <span className="text-sm text-[#6B6B6B]">— {first.entity_display_name}</span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs text-[#9B9B9B] flex-shrink-0">
                {isExpiringSoon && <span className="text-amber-600 font-medium">Expiring soon</span>}
                <span>
                  {first.requester_display_name ?? "Unknown"}
                  {" · "}
                  {new Date(
                    first.requested_at.includes("T") || first.requested_at.endsWith("Z")
                      ? first.requested_at
                      : first.requested_at.replace(" ", "T") + "Z"
                  ).toLocaleDateString("en-CA", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>

            {/* Field diffs — one per item in the group */}
            {items.map((change, i) => {
              const prev = change.previous_value !== null && change.previous_value !== undefined ? String(change.previous_value) : null;
              const next = change.proposed_value !== null && change.proposed_value !== undefined ? String(change.proposed_value) : null;
              const showDiff = shouldShowDiff(prev, next);
              return (
                <div key={change.id} className={i > 0 ? "border-t border-[#E5E5E5]" : ""}>
                  {isBatch && (
                    <div className="px-5 pt-3 text-xs font-semibold text-[#6B6B6B] uppercase tracking-wide">
                      {fieldDisplayLabel(change.target_column)}
                    </div>
                  )}
                  {showDiff && prev && next ? (
                    <div className="px-5 py-4 text-sm">
                      <div className="text-xs font-medium text-[#9B9B9B] mb-2">Changes</div>
                      <div className="text-[#1A1A1A]"><DiffView before={prev} after={next} /></div>
                      <div className="mt-3 grid grid-cols-2 gap-4 text-xs text-[#9B9B9B]">
                        <div>
                          <span className="font-medium">Before</span>
                          <div className="mt-0.5 text-[#6B6B6B] whitespace-pre-wrap">{prev}</div>
                        </div>
                        <div>
                          <span className="font-medium text-emerald-700">After</span>
                          <div className="mt-0.5 text-[#1A1A1A] whitespace-pre-wrap">{next}</div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 divide-x divide-[#E5E5E5] text-sm">
                      <div className="px-5 py-4">
                        <div className="text-xs font-medium text-[#9B9B9B] mb-1.5">Current value</div>
                        <div className="text-[#4A4A4A] whitespace-pre-wrap break-words">
                          {prev ?? <span className="italic text-[#9B9B9B]">empty</span>}
                        </div>
                      </div>
                      <div className="px-5 py-4">
                        <div className="text-xs font-medium text-emerald-700 mb-1.5">Proposed value</div>
                        <div className="text-[#1A1A1A] font-medium whitespace-pre-wrap break-words">
                          {next ?? <span className="italic text-[#9B9B9B]">empty</span>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Error */}
            {state.error && (
              <div className="px-5 py-2 bg-red-50 text-sm text-red-600 border-t border-red-100">
                {state.error}
              </div>
            )}

            {/* Reject panel — counter-proposal only available for single-field changes */}
            {state.showReject && (
              <div className="px-5 py-3 border-t border-[#E5E5E5] space-y-3">
                <textarea
                  value={state.note}
                  onChange={(e) => patchState(key, { note: e.target.value })}
                  placeholder="Reason for rejection (optional)"
                  rows={2}
                  className="w-full text-sm border border-[#D5D5D5] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-accent resize-none"
                />
                {!isBatch && (
                  <>
                    <label className="flex items-center gap-2 text-sm text-[#4A4A4A] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={state.useCounter}
                        onChange={(e) => patchState(key, { useCounter: e.target.checked })}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                      Suggest an alternative value instead
                    </label>
                    {state.useCounter && (
                      <div>
                        <label className="text-xs font-medium text-[#4A4A4A] mb-1 block">Alternative value</label>
                        <textarea
                          value={state.counterProposal}
                          onChange={(e) => patchState(key, { counterProposal: e.target.value })}
                          placeholder={`e.g. ${first.proposed_value ? String(first.proposed_value).slice(0, 40) : "your suggested value"}`}
                          rows={2}
                          className="w-full text-sm border border-amber-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none bg-amber-50"
                        />
                        <p className="mt-1 text-xs text-[#9B9B9B]">
                          Queues a new change for the requester to review before it goes live.
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-[#E5E5E5] bg-slate-50">
              {first.page_href && (
                <a href={first.page_href} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[#6B6B6B] hover:text-[#1A1A1A] underline underline-offset-2">
                  View in context ↗
                </a>
              )}
              <div className="flex gap-2 ml-auto">
                {state.showReject ? (
                  <>
                    <button onClick={() => patchState(key, { showReject: false, note: "" })}
                      className="px-3 py-1.5 text-xs font-medium text-[#4A4A4A] bg-slate-100 rounded-md hover:bg-slate-200 transition-colors">
                      Cancel
                    </button>
                    <button onClick={() => handleReject(key, isBatch)} disabled={state.loading}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50">
                      {state.loading ? "Rejecting…" : "Confirm Reject"}
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => patchState(key, { showReject: true })} disabled={state.loading}
                      className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100 transition-colors disabled:opacity-50">
                      Reject
                    </button>
                    <button onClick={() => handleApprove(key, isBatch)} disabled={state.loading}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 rounded-md hover:bg-emerald-700 transition-colors disabled:opacity-50">
                      {state.loading ? "Approving…" : isBatch ? `Approve all ${items.length}` : "Approve"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
