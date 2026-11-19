/**
 * /admin/elections/[slug]/proxies — kept as a redirect only.
 *
 * The proxy register moved to the meeting it belongs to:
 * `/admin/members-meetings/[id]/proxies`. A proxy is appointed for a meeting,
 * not for an election — `meeting_proxies` is keyed on `meeting_id` and always
 * was. This route stays because links to it exist in older board material and
 * in anyone's bookmarks, and a 404 would read as "the register is gone".
 */

import { notFound, redirect } from "next/navigation";
import { getScheduledElection } from "@/lib/elections/service";
import { createAdminClient } from "@/lib/supabase/admin";
import { MEMBERS_MEETING_TYPES } from "@/lib/governance/members-meetings";

export const dynamic = "force-dynamic";

export default async function LegacyProxyRegisterRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const election = await getScheduledElection(slug);
  if (!election) notFound();

  const db = createAdminClient();
  const { data: meeting } = await db
    .from("board_meetings")
    .select("id")
    .in("meeting_type", MEMBERS_MEETING_TYPES as readonly string[])
    .eq("meeting_date", election.schedule.agmDate)
    .maybeSingle();

  if (meeting?.id) redirect(`/admin/members-meetings/${meeting.id}/proxies`);
  redirect("/admin/members-meetings");
}
