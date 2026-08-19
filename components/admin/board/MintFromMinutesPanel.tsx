"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FLAG_LABELS, type QualityFlag } from "@/lib/board/action-mint";

/**
 * Mint action items from the saved minutes.
 *
 * Proposals are graded server-side; the reviewer can fix an owner or a date
 * in place and watch a row flip from intention to action. Nothing is written
 * until Confirm, and historical meetings are stamped silent on insert — see
 * docs/BOARD_ACTION_ITEM_MINT.md.
 */

interface Proposal {
  sourceExcerpt: string;
  ownerText: string;
  title: string;
  ownerIds: string[];
  ownerNames: string[];
  unresolvedOwners: string[];
  dueDateText: string | null;
  flags: QualityFlag[];
  isAction: boolean;
}

interface DirectoryEntry {
  id: string;
  displayName: string;
}

interface Row extends Proposal {
  include: boolean;
  assignees: string[];
  dueDate: string;
  minted: boolean;
}

const NAVY = "#163D6D";

/** Mirrors the server rubric so the row re-grades as the reviewer edits. */
function regrade(row: Row): { flags: QualityFlag[]; isAction: boolean } {
  // Annotated because filtering on literal comparisons narrows the element
  // type to whatever survives, and we push the other flags back in below.
  const flags: QualityFlag[] = row.flags.filter(
    (f) => f !== "no_owner" && f !== "owner_unresolved" && f !== "no_finish_line"
  );
  if (row.assignees.length === 0) flags.push("no_owner");

  // A date supplied by hand satisfies the finish-line test; without one, the
  // server's original verdict on that test stands.
  const hadNoFinishLine = row.flags.includes("no_finish_line");
  if (hadNoFinishLine && !row.dueDate) flags.push("no_finish_line");

  return { flags, isAction: flags.length === 0 };
}

export default function MintFromMinutesPanel({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [hasMinutes, setHasMinutes] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/board/meetings/${meetingId}/mint`);
    const data = await res.json();
    setHasMinutes(data.hasMinutes !== false);
    setDirectory(data.directory ?? []);
    const alreadyMinted: string[] = data.alreadyMinted ?? [];
    setRows(
      (data.proposals ?? []).map((p: Proposal) => ({
        ...p,
        include: true,
        assignees: p.ownerIds,
        dueDate: "",
        minted: alreadyMinted.includes(p.sourceExcerpt),
      }))
    );
  }, [meetingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const graded = useMemo(
    () => (rows ?? []).map((row) => ({ row, ...regrade(row) })),
    [rows]
  );

  const pending = graded.filter((g) => !g.row.minted);
  const actionCount = pending.filter((g) => g.isAction && g.row.include).length;
  const intentionCount = pending.filter((g) => !g.isAction && g.row.include).length;

  function update(index: number, patch: Partial<Row>) {
    setRows((current) =>
      (current ?? []).map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    const payload = graded
      .filter((g) => g.row.include && !g.row.minted)
      .map((g) => ({
        title: g.row.title,
        description: "",
        assignees: g.row.assignees,
        dueDate: g.row.dueDate || null,
        sourceExcerpt: g.row.sourceExcerpt,
        flags: g.flags,
        isAction: g.isAction,
      }));

    const res = await fetch(`/api/admin/board/meetings/${meetingId}/mint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: payload }),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error ?? "Could not create the items.");
      return;
    }
    setResult(
      `Created ${data.actions} action item${data.actions === 1 ? "" : "s"} and ${data.intentions} intention${data.intentions === 1 ? "" : "s"}. ${data.notified} notification${data.notified === 1 ? "" : "s"} sent.`
    );
    await load();
    router.refresh();
  }

  if (rows === null) {
    return <p className="py-8 text-sm text-gray-400">Reading the minutes…</p>;
  }

  if (!hasMinutes) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
        <p className="text-sm font-medium text-gray-700">No minutes saved yet</p>
        <p className="mt-1 text-xs text-gray-500">
          Action items are minted from the minutes. Save them first.
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-white py-12 text-center">
        <p className="text-sm font-medium text-gray-700">
          No ACTION lines found in these minutes
        </p>
        <p className="mt-1 text-xs text-gray-500">
          The parser looks for lines beginning <code>ACTION:</code>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          <strong className="text-gray-900">{actionCount}</strong> action item
          {actionCount === 1 ? "" : "s"} ·{" "}
          <strong className="text-gray-900">{intentionCount}</strong> intention
          {intentionCount === 1 ? "" : "s"}
          {pending.length !== graded.length && (
            <span className="text-gray-400">
              {" "}
              · {graded.length - pending.length} already minted
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={confirm}
          disabled={saving || pending.every((g) => !g.row.include)}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-white transition-colors disabled:opacity-50"
          style={{ background: NAVY }}
        >
          {saving ? "Creating…" : `Create ${actionCount + intentionCount} item${actionCount + intentionCount === 1 ? "" : "s"}`}
        </button>
      </div>

      {result && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2.5 text-sm text-green-800">
          {result}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {graded.map(({ row, flags, isAction }, i) => (
          <div
            key={row.sourceExcerpt + i}
            className={`rounded-xl border bg-white p-3.5 transition-colors ${
              row.minted
                ? "border-gray-200 opacity-60"
                : isAction
                  ? "border-green-200"
                  : "border-amber-200"
            }`}
          >
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={row.include && !row.minted}
                disabled={row.minted}
                onChange={(e) => update(i, { include: e.target.checked })}
                className="mt-1 h-4 w-4 rounded border-gray-300"
                aria-label={`Include: ${row.title}`}
              />

              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
                      row.minted
                        ? "bg-gray-100 text-gray-500"
                        : isAction
                          ? "bg-green-100 text-green-700"
                          : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {row.minted ? "Already minted" : isAction ? "Action" : "Intention"}
                  </span>
                  {!row.minted &&
                    flags.map((f) => (
                      <span key={f} className="text-[11px] text-amber-700">
                        {FLAG_LABELS[f]}
                      </span>
                    ))}
                </div>

                <input
                  type="text"
                  value={row.title}
                  disabled={row.minted}
                  onChange={(e) => update(i, { title: e.target.value })}
                  className="w-full rounded-md border border-gray-200 px-2.5 py-1.5 text-sm focus:border-[#163D6D] focus:outline-none disabled:bg-gray-50"
                />

                <p className="mt-1.5 truncate text-[11px] text-gray-400" title={row.sourceExcerpt}>
                  From minutes: “{row.sourceExcerpt}”
                </p>

                {!row.minted && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      Owner
                      <select
                        multiple
                        value={row.assignees}
                        onChange={(e) =>
                          update(i, {
                            assignees: Array.from(e.target.selectedOptions).map((o) => o.value),
                          })
                        }
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                        size={1}
                      >
                        {directory.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.displayName}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs text-gray-600">
                      Due
                      <input
                        type="date"
                        value={row.dueDate}
                        onChange={(e) => update(i, { dueDate: e.target.value })}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      />
                    </label>

                    {row.dueDateText && !row.dueDate && (
                      <span className="text-[11px] text-gray-500">
                        minutes say “{row.dueDateText}”
                      </span>
                    )}
                    {row.unresolvedOwners.length > 0 && (
                      <span className="text-[11px] text-amber-700">
                        unrecognised: {row.unresolvedOwners.join(", ")}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
