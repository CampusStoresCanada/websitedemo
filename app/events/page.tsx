import type { Metadata } from "next";
import { Suspense } from "react";
import { listPublishedEventsWithOrgContext } from "@/lib/actions/events";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { deriveUserTags } from "@/lib/events/tags";
import { canSeeEvent } from "@/lib/events/visibility";
import EventTabs from "@/components/events/EventTabs";
import EventsFilteredList from "@/components/events/EventsFilteredList";

export const metadata: Metadata = {
  title: "Events | Campus Stores Canada",
  description: "Upcoming webinars, member sessions, and partner showcases from Campus Stores Canada.",
};

export const revalidate = 60;

async function getUserTags(userId: string): Promise<string[]> {
  try {
    const db = createAdminClient();

    // Prefer "Member" org — same logic as resources page to avoid wrong org for multi-org users
    const { data: memberships } = await db
      .from("user_organizations")
      .select("organization_id, organizations(type)")
      .eq("user_id", userId)
      .eq("status", "active");

    type Row = { organization_id: string; organizations: { type: string } | null };
    const rows = (memberships ?? []) as Row[];
    const preferred =
      rows.find((r) => r.organizations?.type === "Member") ??
      rows.find((r) => r.organizations?.type === "Vendor Partner") ??
      rows[0] ?? null;

    if (!preferred?.organization_id) return [];

    const { data: org } = await db
      .from("organizations")
      .select("province, nacs_department, nacs_classes, is_cancoll_member")
      .eq("id", preferred.organization_id)
      .maybeSingle();

    if (!org) return [];

    return deriveUserTags({
      province:          org.province ?? null,
      nacs_department:   org.nacs_department ?? null,
      nacs_classes:      (org.nacs_classes as string[] | null) ?? null,
      is_cancoll_member: org.is_cancoll_member ?? null,
    });
  } catch {
    return [];
  }
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ tab }, authCtx] = await Promise.all([
    searchParams,
    getOptionalAuthContext(),
  ]);

  const userId    = authCtx?.userId ?? null;
  const activeTab = tab === "past" ? "past" : "upcoming";

  // Fetch events + user tags in parallel
  const [eventsResult, userTags] = await Promise.all([
    listPublishedEventsWithOrgContext(userId ?? undefined),
    userId ? getUserTags(userId) : Promise.resolve([]),
  ]);

  const events = eventsResult.success ? eventsResult.data : [];

  const globalRole = (authCtx as any)?.globalRole ?? null;

  const visibleEvents = events.filter((e) =>
    canSeeEvent(e.audience_mode as any, globalRole)
  );

  const now      = new Date().toISOString();
  const upcoming = visibleEvents.filter((e) => e.starts_at >= now);
  const past     = visibleEvents.filter((e) => e.starts_at < now).reverse();

  const displayed = activeTab === "upcoming" ? upcoming : past;

  return (
    <div>
      {/* ------------------------------------------------------------------ */}
      {/* Hero header                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-[#163D6D]">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-10 pb-0">
          <div className="mb-6">
            <p className="text-xs font-semibold text-white/50 uppercase tracking-widest mb-2">
              Campus Stores Canada
            </p>
            <h1 className="text-3xl font-bold text-white">Events</h1>
            <p className="text-white/60 mt-2 text-sm">
              Webinars, member sessions, and partner showcases.
            </p>
          </div>

          <Suspense
            fallback={
              <div className="flex gap-1 border-b border-white/20">
                {["Upcoming", "Past"].map((label) => (
                  <div key={label} className="px-5 py-3 text-sm font-semibold text-white/60">
                    {label}
                  </div>
                ))}
              </div>
            }
          >
            <EventTabs
              upcomingCount={upcoming.length}
              pastCount={past.length}
              activeTab={activeTab}
            />
          </Suspense>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Body                                                                 */}
      {/* ------------------------------------------------------------------ */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">

        <EventsFilteredList
          events={displayed}
          isAuthenticated={!!userId}
          userTags={userTags}
          activeTab={activeTab}
        />
      </div>
    </div>
  );
}
