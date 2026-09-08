import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyMeetingPreferences } from "@/lib/actions/conference-meeting-preferences";
import MyTopChoicesEditor from "@/components/me/MyTopChoicesEditor";
import MyBlackoutEditor from "@/components/me/MyBlackoutEditor";

/**
 * A delegate's own meeting preferences, on their own page — who they want to
 * meet, and who they would not.
 *
 * ⛔ NOT behind org-admin rights. "If I am going to the conference I should be
 * given the choices." An attendee picks for themselves; the org page's version
 * of this is the exhibitor's, where the company has one list because the suite
 * meets whoever walks in.
 *
 * ⛔ TWO SECTIONS, ONE QUESTION EACH — the same split as the org page. Merging
 * them into one screen with two controls per row turns a two-minute job into two
 * jobs, and is how the first one stops getting done.
 *
 * Sits with the rest of this person's conference to-dos (#conference_checklist
 * above it) rather than on a route of its own, the same way /me/conference and
 * /org/[slug]/conference were folded back in.
 *
 * Returns null unless the viewer is actually registered — an empty "who do you
 * want to meet" block on the profile of someone who is not going is noise, and
 * invites preferences that can never be honoured.
 */
export default async function MyMeetingPreferencesSection() {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const db = createAdminClient();
  const { data: people } = await db
    .from("conference_people")
    .select("conference_id")
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1);

  const conferenceId = (people ?? [])[0]?.conference_id as string | undefined;
  if (!conferenceId) return null;

  const result = await getMyMeetingPreferences(conferenceId);
  if (!result.success || !result.data) return null;

  const { present, chosenOrgIds, refusedOrgIds, limit } = result.data;
  if (present.length === 0) return null;

  return (
    <>
      <section id="my_top_choices" className="scroll-mt-20 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Who you want to meet</h2>
          <p className="mt-1 text-sm text-gray-600">
            Pick up to {limit}. If we can make the meeting happen, we will.
          </p>
        </div>

        <MyTopChoicesEditor
          conferenceId={conferenceId}
          candidates={present}
          initialChosenOrgIds={chosenOrgIds}
          limit={limit}
        />
      </section>

      <section id="my_blackout" className="scroll-mt-20 space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Who you would not meet</h2>
          <p className="mt-1 text-sm text-gray-600">
            Tick anyone you would rather not sit down with. We won&apos;t schedule you
            together.
          </p>
        </div>

        <MyBlackoutEditor
          conferenceId={conferenceId}
          candidates={present}
          initialRefusedOrgIds={refusedOrgIds}
        />
      </section>
    </>
  );
}
