import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { getEvent } from "@/lib/actions/events";
import EventFormClient from "@/components/admin/events/EventFormClient";

export const metadata: Metadata = {
  title: "Edit Event | Admin | Campus Stores Canada",
};

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const fromReview = sp.from_review === "1";

  const auth = await requireAuthenticated();
  if (!auth.ok) return <div className="p-8 text-gray-500">Access denied.</div>;

  const result = await getEvent(id);
  // getEvent requires admin — if non-admin creator hits this, it returns an error
  // For member creators, we'd need a separate action; for now admin-only edit
  if (!result.success) notFound();

  const event = result.data;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <Link
          href={`/admin/events/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Event Details
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Edit Event</h1>
        <p className="text-sm text-gray-500 mt-1 font-mono">{event.slug}</p>
      </div>

      <EventFormClient
        event={event}
        isEdit
        fromReview={fromReview}
        googleMapsApiKey={process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null}
      />
    </div>
  );
}
