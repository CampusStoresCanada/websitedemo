import { requireAuthenticated } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMyTopChoices } from "@/lib/actions/conference-meeting-preferences";
import MyTopChoicesEditor from "@/components/me/MyTopChoicesEditor";

/**
 * A delegate's own top five, on their own page.
 *
 * ⛔ NOT behind org-admin rights. "If I am going to the conference I should be
 * given the choices." An attendee picks for themselves; the org page's version
 * of this is the exhibitor's, where the company has one list because the suite
 * meets whoever walks in.
 *
 * Returns null unless the viewer is actually registered — an empty "who do you
 * want to meet" block on the profile of someone who is not going is noise, and
 * invites preferences that can never be honoured.
 */
export default async function MyTopChoicesSection() {
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

  const result = await getMyTopChoices(conferenceId);
  if (!result.success || !result.data) return null;

  const { present, chosenOrgIds, limit } = result.data;
  if (present.length === 0) return null;

  return (
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
  );
}
