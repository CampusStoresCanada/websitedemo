import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import AgendaView from "@/components/me/AgendaView";
import { loadPersonAgenda } from "@/lib/conference/person-agenda";

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
  const conference = person.conference_instances;

  // Nothing to show and nothing to link to is not a section, it is a heading.
  if (!agenda?.items.length && !agenda?.deadlines.length && !conference) return null;

  return (
    <section id="conference_checklist" className="scroll-mt-20 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-900">
          {conference?.name ?? "Conference"}
        </h2>
        {conference && (
          <Link
            href={`/conference/${conference.year}/${conference.edition_code}/schedule`}
            className="text-sm font-medium text-[#163D6D] hover:underline"
          >
            Your schedule &rarr;
          </Link>
        )}
      </div>

      {agenda && agenda.items.length > 0 && conference && (
        <AgendaView
          agenda={agenda}
          mapHref={`/conference/${conference.year}/${conference.edition_code}/map`}
        />
      )}

    </section>
  );
}
