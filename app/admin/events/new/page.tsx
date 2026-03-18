import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/guards";
import EventFormClient from "@/components/admin/events/EventFormClient";

export const metadata: Metadata = {
  title: "New Event | Admin | Campus Stores Canada",
};

export default async function NewEventPage() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    return <div className="p-8 text-gray-500">Access denied.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
      <div className="mb-8">
        <Link
          href="/admin/events"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Events
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">New Event</h1>
        <p className="text-sm text-gray-500 mt-1">
          Admin-created events start as drafts. Publish when ready.
        </p>
      </div>

      <EventFormClient googleMapsApiKey={process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? null} />
    </div>
  );
}
