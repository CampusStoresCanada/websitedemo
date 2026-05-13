import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { resolveShareLink } from "@/lib/actions/share-links";
import { resolveSnapshot } from "@/lib/actions/snapshots";
import { SnapshotRenderer } from "@/lib/snapshots/render";

export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;

  // Try snapshot first
  const snap = await resolveSnapshot(id);
  if (snap.valid && snap.record) {
    return {
      title: `${snap.record.page_title} | Campus Stores Canada`,
      description: snap.record.note ?? `Shared snapshot of ${snap.record.page_title}`,
      robots: { index: false },
    };
  }

  // Fall back to legacy share link
  const result = await resolveShareLink(id);
  if (!result.valid || !result.link) {
    return { title: "Shared Link | Campus Stores Canada" };
  }
  return {
    title: `${result.link.page_title} | Campus Stores Canada`,
    description: result.link.note ?? `You've been invited to view ${result.link.page_title} on the CSC site.`,
    robots: { index: false },
  };
}

export default async function ShareLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  // Element highlight params — passed through to the redirect target when present
  const hs = typeof sp.hs === "string" ? sp.hs : null;
  const he = typeof sp.he === "string" ? sp.he : null;
  const ht = typeof sp.ht === "string" ? sp.ht : null;

  // ── Snapshot path ─────────────────────────────────────────────────────────
  const snap = await resolveSnapshot(id);

  if (snap.valid && snap.record) {
    const { record } = snap;

    // Pages without a rich renderer (resources, partners, generic) have no useful
    // snapshot content — redirect straight to the live page instead of showing
    // an empty card. The /s/ link acts as a short-lived redirect in these cases.
    if (record.snapshot.type === "resources" || record.snapshot.type === "partners") {
      // Pass element highlight params through so the live page can draw the rect
      const highlightParams = new URLSearchParams();
      if (hs) highlightParams.set("hs", hs);
      if (he) highlightParams.set("he", he);
      if (ht) highlightParams.set("ht", ht);
      const qs = highlightParams.toString();
      const sep = record.page_url.includes("?") ? "&" : "?";
      redirect(qs ? `${record.page_url}${sep}${qs}` : record.page_url);
    }

    const expiresLabel = formatDate(record.expires_at);

    return (
      <div className="min-h-screen bg-gray-50 py-10 px-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Header card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#EE2A2E] flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xs">CSC</span>
              </div>
              <div>
                <p className="text-xs text-gray-400">Shared snapshot · expires {expiresLabel}</p>
                <p className="text-sm font-semibold text-gray-800">{record.page_title}</p>
              </div>
            </div>

            {ht && (
              <div className="mt-3 bg-violet-50 border border-violet-100 rounded-lg px-4 py-2.5 text-sm text-violet-800">
                <span className="font-medium">In reference to: </span>
                &ldquo;{decodeURIComponent(ht).slice(0, 120)}&rdquo;
              </div>
            )}
            {record.note && (
              <div className="mt-3 bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-sm text-blue-800">
                <span className="font-medium">Note: </span>{record.note}
              </div>
            )}
          </div>

          {/* Snapshot content */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-6">
            <SnapshotRenderer snapshot={record.snapshot} />
          </div>

          {/* Footer — subtle, for members who do have access */}
          <p className="text-center text-xs text-gray-400">
            Point-in-time snapshot captured at share time.
          </p>
        </div>
      </div>
    );
  }

  // Snapshot expired or not found — check if it's a snapshot ID with expiry info
  if (snap.reason === "expired" && snap.record) {
    return <ExpiredPage reason="expired" label={snap.record.page_title} />;
  }

  // ── Legacy share link path ─────────────────────────────────────────────────
  const result = await resolveShareLink(id);

  if (!result.valid) {
    return <ExpiredPage reason={result.reason} link={result.link} />;
  }

  const { link } = result;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 max-w-md w-full p-8">
        {/* CSC logo mark */}
        <div className="flex justify-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-[#EE2A2E] flex items-center justify-center">
            <span className="text-white font-bold text-lg">CSC</span>
          </div>
        </div>

        <h1 className="text-xl font-semibold text-center text-[#1A1A1A] mb-2">
          You've been invited to view
        </h1>
        <p className="text-center text-gray-500 text-sm mb-6">on the Campus Stores Canada site</p>

        {/* Page being shared */}
        <div className="bg-gray-50 rounded-xl px-5 py-4 mb-5 text-center">
          <p className="font-semibold text-[#1A1A1A] text-lg">{link!.page_title}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">{link!.page_url}</p>
        </div>

        {/* Optional note from sharer */}
        {link!.note && (
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 mb-5 text-sm text-blue-800">
            <span className="font-medium">Note: </span>{link!.note}
          </div>
        )}

        {/* Expiry info */}
        <p className="text-xs text-center text-gray-400 mb-6">
          This link expires on {formatDate(link!.expires_at)} ·{" "}
          {link!.max_uses - link!.use_count} views remaining
        </p>

        {/* CTA */}
        <Link
          href={link!.page_url}
          className="block w-full text-center bg-[#EE2A2E] hover:bg-[#D92327] text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          View Page →
        </Link>

        <p className="text-xs text-center text-gray-400 mt-4">
          You may be asked to sign in to view some content.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared sub-components
// ---------------------------------------------------------------------------

function ExpiredPage({
  reason,
  link,
  label,
}: {
  reason?: "not_found" | "expired" | "max_uses";
  link?: { page_url: string; page_title: string } | null;
  label?: string;
}) {
  const messages: Record<string, string> = {
    not_found: "This share link doesn't exist.",
    expired: "This snapshot has expired.",
    max_uses: "This share link has reached its maximum number of views.",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 max-w-md w-full p-8 text-center">
        <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-6">
          <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-[#1A1A1A] mb-2">Link Unavailable</h1>
        <p className="text-gray-500 text-sm mb-6">
          {messages[reason ?? "not_found"]}
        </p>
        {(link?.page_title || label) && (
          <p className="text-xs text-gray-400 mb-6">
            The page was: <span className="font-medium">{link?.page_title ?? label}</span>
          </p>
        )}
        <Link
          href="/"
          className="inline-block bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2 px-5 rounded-xl transition-colors text-sm"
        >
          Go to Homepage
        </Link>
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const s = iso.endsWith("Z") || iso.includes("+") ? iso : iso.replace(" ", "T") + "Z";
  return new Date(s).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
