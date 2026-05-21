import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import EditEventForm from "@/components/toolkit/EditEventForm";

export const metadata = {
  title: "Edit Event | Campus Stores Canada",
};

export default async function MemberEditEventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const auth = await requireAuthenticated();
  if (!auth.ok) redirect("/login");

  const { id } = await params;
  const db = createAdminClient();

  const { data: event } = await db
    .from("events")
    .select("id, title, description, starts_at, ends_at, is_virtual, location, virtual_link, audience_mode, metadata, status, created_by")
    .eq("id", id)
    .single();

  if (!event) notFound();

  // Only the creator can edit their own event
  if (event.created_by !== auth.ctx.userId) notFound();

  // Only editable while not yet published
  const editableStatuses = ["pending_review", "draft"];
  if (!editableStatuses.includes(event.status)) {
    redirect("/me/events");
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-10">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-sm text-gray-500">
        <Link href="/me" className="hover:text-gray-700">My Account</Link>
        <span className="text-gray-300">/</span>
        <Link href="/me/events" className="hover:text-gray-700">My Events</Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-900 font-medium">Edit</span>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Edit Event</h1>
        {event.status === "pending_review" && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
            This event is awaiting review. Your changes will be saved and visible to admins.
          </p>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <EditEventForm
          event={{
            ...event,
            starts_at: event.starts_at ?? "",
            metadata: (event.metadata as Record<string, unknown>) ?? {},
          }}
        />
      </div>
    </main>
  );
}
