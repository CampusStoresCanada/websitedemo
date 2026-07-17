import Link from "next/link";
import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import { createAdminClient } from "@/lib/supabase/admin";

function formatDate(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00Z`).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "Today" in the conference's own timezone, as a YYYY-MM-DD string comparable to dayKeyLocal. */
function todayInTimeZone(timeZone: string): string {
  return new Date().toLocaleDateString("en-CA", { timeZone });
}

// Descriptions carry the odd bare URL (Google Meet links, dial-in pages) —
// linkify them rather than adding a dedicated catalog attribute for it.
const URL_PATTERN = /(https?:\/\/[^\s]+)/g;

function renderWithLinks(text: string) {
  const parts = text.split(URL_PATTERN);
  return parts.map((part, i) =>
    URL_PATTERN.test(part) ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-[#EE2A2E] hover:underline">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

/**
 * Pre- and post-conference milestones — deadlines, walkthroughs, orientation
 * calls, post-conference surveys/follow-ups — that fall outside the on-site
 * event window (which ScheduleAtAGlance already covers). Pulled from the same
 * live catalog agenda, sorted as a flat chronological list instead of a
 * day grid, since these can be weeks or months apart on either side.
 *
 * `audiences` is a list (not a single value) so one entity tagged with both
 * Member and Partner `who` refs shows up wherever it's rendered without any
 * component change — the catalog tag is the only thing that needs touching.
 */
export default async function DeadlinesTimeline({
  conferenceId,
  conferenceStartDate,
  conferenceEndDate,
  audiences,
}: {
  conferenceId: string;
  conferenceStartDate: string;
  conferenceEndDate: string;
  audiences: Array<"Partner" | "Member">;
}) {
  const timeline = await getConferenceScheduleTimeline(conferenceId, { viewerRole: "observer" });
  const today = todayInTimeZone(timeline.timeZone);

  const upcoming = timeline.programItems.filter(
    (item) =>
      item.kind !== "meal" &&
      item.dayKeyLocal >= today &&
      (item.dayKeyLocal < conferenceStartDate || item.dayKeyLocal > conferenceEndDate) &&
      item.audienceNames.some((a) => audiences.includes(a as "Partner" | "Member"))
  );

  if (upcoming.length === 0) return null;

  // AgendaItem.id is the catalog entity id, which is also what a linked
  // Events row points back at — no changes needed in agenda.ts/schedule-service.ts.
  const { data: linkedEvents } = await createAdminClient()
    .from("events")
    .select("slug, conference_entity_id")
    .in("conference_entity_id", upcoming.map((item) => item.id))
    .eq("status", "published");
  const rsvpSlugByEntityId = new Map((linkedEvents ?? []).map((e) => [e.conference_entity_id as string, e.slug]));

  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight text-[#1A1A1A]">Deadlines & key dates</h2>
      <p className="mt-1 max-w-2xl text-sm text-[#6B6B6B]">What's coming up before and after the conference.</p>

      <ul className="mt-6 space-y-3">
        {upcoming.map((item) => {
          // A dedicated summary is a short teaser behind which the full
          // description (join links, dial-in, etc.) sits collapsed. Items
          // without one just show the description directly — no forced split.
          const teaser = item.summary ?? item.description;
          const hasMore = Boolean(item.summary && item.description && item.description !== item.summary);
          const rsvpSlug = rsvpSlugByEntityId.get(item.id);
          const isPostConference = item.dayKeyLocal > conferenceEndDate;

          return (
            <li key={item.id} className="rounded-2xl border border-[#E5E5E5] bg-white p-5 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-[#6B6B6B]">
                {formatDate(item.dayKeyLocal)} · {isPostConference ? "Post-conference" : "Pre-conference"}
              </p>
              <p className="mt-1 text-base font-semibold text-[#1A1A1A]">{item.title}</p>
              <p className="mt-0.5 text-xs text-[#6B6B6B]">
                {item.startsAtLocal}
                {item.endsAtLocal ? ` – ${item.endsAtLocal}` : ""}
                {item.locationLabel ? ` · ${item.locationLabel}` : ""}
              </p>
              {teaser && <p className="mt-2 text-sm text-[#1A1A1A]/80">{renderWithLinks(teaser)}</p>}
              <div className="mt-2 flex flex-wrap items-start gap-4">
                {rsvpSlug && (
                  <Link href={`/events/${rsvpSlug}`} className="text-sm font-medium text-[#EE2A2E] hover:underline">
                    RSVP →
                  </Link>
                )}
                {hasMore && (
                  <details className="group">
                    <summary className="cursor-pointer text-sm font-medium text-[#EE2A2E] hover:underline [&::-webkit-details-marker]:hidden">
                      View details
                    </summary>
                    <p className="mt-2 whitespace-pre-line text-sm text-[#1A1A1A]/80">{renderWithLinks(item.description!)}</p>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
