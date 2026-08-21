"use client";

/**
 * The human gate for Helpful Ghost's announcements.
 *
 * Reviewers edit the title and the prose; the markup is regenerated server-side
 * from those, so nothing here can produce a post structure Circle won't render.
 * Approving does not publish — it marks a draft ready, and the paced release
 * sends at most one per business day.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  draftPendingAnnouncements,
  saveAnnouncementDraft,
  approveAnnouncement,
  unapproveAnnouncement,
  skipAnnouncement,
  type AnnouncementRow,
} from "@/lib/actions/ghost-announcements";

const STATUS_STYLE: Record<AnnouncementRow["status"], { label: string; className: string }> = {
  draft: { label: "Needs review", className: "bg-amber-50 text-amber-900 border-amber-200" },
  approved: { label: "Approved — awaiting release", className: "bg-blue-50 text-blue-800 border-blue-200" },
  published: { label: "Published", className: "bg-green-50 text-green-800 border-green-200" },
  skipped: { label: "Skipped", className: "bg-gray-100 text-gray-700 border-gray-300" },
};

function formatJoined(iso: string | null): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function AnnouncementReview({ initial }: { initial: AnnouncementRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSummary, setDraftSummary] = useState("");
  const [skippingId, setSkippingId] = useState<string | null>(null);
  const [skipReason, setSkipReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ success?: boolean; error?: string }>) => {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      router.refresh();
    });
  };

  const checkNow = () => {
    setError(null);
    startTransition(async () => {
      const result = await draftPendingAnnouncements();
      if (result.error) setError(result.error);
      else
        setNotice(
          result.drafted === 0 && result.skipped === 0
            ? "No new partners to announce."
            : `Drafted ${result.drafted}${result.skipped ? `, skipped ${result.skipped}` : ""}.`
        );
      router.refresh();
    });
  };

  const startEdit = (row: AnnouncementRow) => {
    setEditingId(row.id);
    setDraftTitle(row.title);
    setDraftSummary(row.summaryText);
  };

  const pendingCount = initial.filter((r) => r.status === "draft").length;
  const approvedCount = initial.filter((r) => r.status === "approved").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="text-sm text-gray-700">
          <strong>{pendingCount}</strong> awaiting review
          {approvedCount > 0 && (
            <>
              {" · "}
              <strong>{approvedCount}</strong> approved, releasing one per business day
            </>
          )}
        </div>
        <button
          onClick={checkNow}
          disabled={pending}
          className="rounded-md bg-[#B92026] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9c1b20] disabled:opacity-50"
        >
          {pending ? "Checking…" : "Check for new partners"}
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      {initial.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
          Nothing drafted yet. Helpful Ghost writes an announcement when a partner completes
          onboarding and pays — press <strong>Check for new partners</strong> to look now.
        </div>
      )}

      {initial.map((row) => {
        const style = STATUS_STYLE[row.status];
        const isEditing = editingId === row.id;

        return (
          <article key={row.id} className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">{row.organizationName}</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Joined {formatJoined(row.joinedOn)}
                  {row.category ? ` · ${row.category}` : ""}
                  {row.location ? ` · ${row.location}` : ""}
                </p>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-medium ${style.className}`}>
                {style.label}
              </span>
            </div>

            {row.status === "skipped" && row.skipReason && (
              <p className="mt-3 rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
                <strong>Not being announced:</strong> {row.skipReason}
              </p>
            )}

            {row.status !== "skipped" && (
              <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <label className="block">
                      <span className="text-xs font-medium text-gray-600">Title</span>
                      <input
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-gray-600">
                        What members should know about them
                      </span>
                      <textarea
                        value={draftSummary}
                        onChange={(e) => setDraftSummary(e.target.value)}
                        rows={4}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      />
                      <span className="mt-1 block text-xs text-gray-500">
                        Written in the third person — Helpful Ghost is introducing them, not
                        speaking as them. Category, location, website and the profile button are
                        added automatically.
                      </span>
                    </label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          run(() => saveAnnouncementDraft(row.id, draftTitle, draftSummary));
                          setEditingId(null);
                        }}
                        disabled={pending}
                        className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-base font-semibold text-gray-900">{row.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-gray-800">
                      {row.summaryText || (
                        <em className="text-gray-500">
                          No description — nothing is known about this partner&apos;s business yet.
                        </em>
                      )}
                    </p>
                    <dl className="mt-3 space-y-1 text-sm text-gray-700">
                      {row.category && (
                        <div>
                          {(() => {
                            // Mirrors the post exactly: bold parent, then the
                            // subcategories that actually tell a member something.
                            const [primary, ...rest] = row.category
                              .split(",")
                              .map((c) => c.trim())
                              .filter(Boolean);
                            return (
                              <>
                                <dt className="inline font-semibold">{primary}</dt>
                                {rest.length > 0 && <dd className="inline">: {rest.join(", ")}</dd>}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      {row.location && (
                        <div>
                          <dt className="inline font-semibold">Based in: </dt>
                          <dd className="inline">{row.location}</dd>
                        </div>
                      )}
                      {row.website && (
                        <div>
                          <dt className="inline font-semibold">Website: </dt>
                          <dd className="inline">
                            <a
                              href={row.websiteHref ?? undefined}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#B92026] underline"
                            >
                              {row.website}
                            </a>
                          </dd>
                        </div>
                      )}
                    </dl>
                    <div className="mt-4 text-center">
                      <span className="inline-block rounded-md bg-[#B92026] px-5 py-2 text-sm font-semibold text-white">
                        View {row.organizationName}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            {skippingId === row.id ? (
              <div className="mt-4 space-y-2 rounded-lg border border-gray-200 p-3">
                <label className="block text-xs font-medium text-gray-600">
                  Why is this one not being announced?
                </label>
                <input
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  placeholder="e.g. being introduced by hand, with context"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      run(() => skipAnnouncement(row.id, skipReason));
                      setSkippingId(null);
                      setSkipReason("");
                    }}
                    disabled={pending || !skipReason.trim()}
                    className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Skip it
                  </button>
                  <button
                    onClick={() => setSkippingId(null)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-wrap gap-2">
                {row.status === "draft" && (
                  <>
                    <button
                      onClick={() => run(() => approveAnnouncement(row.id))}
                      disabled={pending || isEditing}
                      className="rounded-md bg-[#B92026] px-4 py-2 text-sm font-semibold text-white hover:bg-[#9c1b20] disabled:opacity-50"
                    >
                      Approve
                    </button>
                    {!isEditing && (
                      <button
                        onClick={() => startEdit(row)}
                        className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      onClick={() => setSkippingId(row.id)}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600"
                    >
                      Don&apos;t announce
                    </button>
                  </>
                )}
                {row.status === "approved" && (
                  <button
                    onClick={() => run(() => unapproveAnnouncement(row.id))}
                    disabled={pending}
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Pull back to draft
                  </button>
                )}
                {row.status === "published" && row.circlePostUrl && (
                  <a
                    href={row.circlePostUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium"
                  >
                    View in Circle →
                  </a>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
