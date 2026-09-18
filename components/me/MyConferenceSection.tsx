import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import AgendaView from "@/components/me/AgendaView";
import { loadPersonAgenda } from "@/lib/conference/person-agenda";
import { getSwapState } from "@/lib/actions/conference-swaps";

/**
 * The attendee's own conference to-dos, on the page they already use.
 *
 * Mirrors what ConferenceChecklistSection does for an organisation. The
 * details a person supplies — dietary, travel, emergency contact — are not
 * here: those live behind Edit, in the same modal they use to change their
 * name, because that is the one path for "change something about me".
 *
 * What is left is genuinely a checklist: things only they can confirm, where
 * "doesn't apply to me" is a complete answer.
 */
export default async function MyConferenceSection() {
  const auth = await requireAuthenticated();
  if (!auth.ok) return null;

  const db = createAdminClient();
  const { data: people } = await db
    .from("conference_people")
    .select("id, conference_id, conference_instances!inner(name, year, edition_code)")
    .eq("user_id", auth.ctx.userId)
    .neq("assignment_status", "canceled")
    .order("updated_at", { ascending: false })
    .limit(1);

  const person = (people ?? [])[0] as unknown as {
    id: string;
    conference_id: string;
    conference_instances: { name: string; year: number; edition_code: string } | null;
  } | undefined;
  if (!person) return null;

  // Check-ins are no longer loaded here — they arrive with the obligations in
  // the edit modal, which is the one place a person answers anything about
  // themselves. The agenda still lists them as outstanding.
  const agendaResult = await loadPersonAgenda(person.id, person.conference_id);
  const agenda = agendaResult.success ? agendaResult.data : null;

  /**
   * How many swaps are left, and whether the schedule is final — read here so
   * the agenda can say "swaps are closed" instead of offering a button the
   * server would refuse. Reading never consumes a swap; only requesting does.
   */
  const swapState =
    agenda?.meetingSeatId && agenda.items.some((i) => i.reason === "meeting")
      ? await getSwapState(person.conference_id, agenda.meetingSeatId)
      : null;
  const swap = swapState?.success ? swapState.data : null;
  const conference = person.conference_instances;

  // Nothing to show and nothing to link to is not a section, it is a heading.
  if (!agenda?.items.length && !agenda?.deadlines.length && !conference) return null;

  return (
    <section id="conference_checklist" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {conference?.name ?? "Conference"}
        </h2>
        {/*
          The "Your schedule →" link is gone: it pointed at
          /conference/[year]/[edition]/schedule, which now redirects straight
          back to this section. A link that returns you to where you already are
          is worse than no link.
        */}
      </div>

      {/*
        ⛔ DEADLINES RENDER EVEN WITH AN EMPTY SCHEDULE. This was gated on
        `items.length > 0`, which meant a registered attendee whose schedule has
        not been built yet saw none of what they owe — and since the meeting
        schedule is built FROM these answers, that is everybody at the point we
        are asking. The block is "Before you go", not a view of the agenda.
      */}
      {agenda && (agenda.items.length > 0 || agenda.deadlines.length > 0) && conference && (
        <AgendaView
          agenda={agenda}
          mapHref={`/conference/${conference.year}/${conference.edition_code}/map`}
          conferenceId={person.conference_id}
          swap={swap}
        />
      )}

    </section>
  );
}
