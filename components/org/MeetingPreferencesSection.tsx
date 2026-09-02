import { getMeetingPreferences } from "@/lib/actions/conference-meeting-preferences";
import MeetingPreferencesEditor from "@/components/org/MeetingPreferencesEditor";

/**
 * Where an organisation says who it wants to meet, and who it does not.
 *
 * On the org page they were already on, behind an anchor, exactly like
 * #conference_checklist — not a new route. Both of these are things an org
 * admin does while looking at everything else they owe for the conference.
 *
 * ⛔ Returns null when the org is not at this conference. An empty "who do you
 * want to meet" block on 160 org pages, most of which are not coming, is noise
 * — and worse, it invites someone to express preferences that can never be
 * honoured because they have no seat.
 *
 * A server component so it loads its own data, with the editing surface handed
 * to a client child. Same shape as ConferenceChecklistSection.
 */
export default async function MeetingPreferencesSection({
  orgId,
  conferenceId,
}: {
  orgId: string;
  conferenceId: string | null;
}) {
  if (!conferenceId) return null;

  const result = await getMeetingPreferences(conferenceId, orgId);
  // Not an error worth showing: a member of staff without admin rights simply
  // does not get this section, the same way they do not get the roster controls.
  if (!result.success || !result.data) return null;

  const { present, topChoiceOrgIds, refusedOrgIds, limit } = result.data;

  // Nobody to choose from means this org is not really at the conference yet.
  const others = present.filter((org) => org.id !== orgId);
  if (others.length === 0) return null;

  return (
    <section
      id="meeting_preferences"
      className="max-w-6xl mx-auto px-4 pb-10 space-y-4 scroll-mt-20"
    >
      <div>
        <h2 className="text-xl font-semibold text-gray-900">Who you want to meet</h2>
        <p className="mt-1 text-sm text-gray-600">
          Pick up to {limit} of the organizations coming to the conference. We use this to
          build the meeting schedule and try to fit them in — it isn&apos;t a guarantee, and
          you may be matched with others besides.
        </p>
      </div>

      <MeetingPreferencesEditor
        conferenceId={conferenceId}
        orgId={orgId}
        candidates={others}
        initialTopChoiceOrgIds={topChoiceOrgIds}
        initialRefusedOrgIds={refusedOrgIds}
        limit={limit}
      />
    </section>
  );
}
