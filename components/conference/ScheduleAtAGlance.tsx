import { getConferenceScheduleTimeline } from "@/lib/conference/schedule-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNonMemberDayPasses } from "@/lib/actions/conference-entities";
import ScheduleDayCards, { groupByDay } from "./ScheduleDayCards";

export type ScheduleTrack = "exhibitor" | "bronze" | "delegate" | "non_member";

// Connected+ (internally still keyed "bronze") gets Tuesday's trade show (the
// extra meetings day) and moves in Monday; plain Exhibitor moves in Tuesday
// morning instead and starts on the floor Wed/Thu. Ids are the entities
// referenced by "Connected Exhibitor Staff Registration" (5396cdfe) vs
// "Exhibitor Staff Registration" (b5e5e2a7) `involved_in` refs in
// conference_entity_refs.
const BRONZE_ONLY_IDS = new Set([
  "a5794b99-d18b-4a8d-9c3d-471d101b8326", // Move-in - Monday
  "1f1553a4-0b30-4db3-9f36-28af622cf54c", // Meeting Block 1 (Tuesday's curated-meetings day)
  "3be76d6c-9b4c-4a25-9cb9-ba3ba8ff056d", // Meeting Block 2
  "21457520-9871-44a8-b569-48ea952f3c37", // Meeting Block 3
  "c0688bbc-4184-4317-b6f0-6b78efb4eb8a", // Meeting Block 4
  "4790cf6c-c592-4fac-b43b-905fca448ebb", // Meeting Block 5
  "9afe4b79-4501-46ab-821e-b07aaf7f2d9c", // Downtime - Tuesday
]);
const EXHIBITOR_ONLY_IDS = new Set([
  "7a70d835-6dfe-42a4-9a74-b75b6164b351", // Move-in - Tuesday
]);

// Same navy/red used on the floor plan (floor-plan-viewer.tsx TYPE_STROKE)
// and the tier cards (SponsorshipLadder.tsx) — one colour vocabulary site-wide.
const TRACK_COLOR: Record<"exhibitor" | "bronze", string> = {
  exhibitor: "#163D6D",
  bronze: "#EE2A2E",
};
const TRACK_LABEL: Record<"exhibitor" | "bronze", string> = {
  exhibitor: "Exhibitor",
  bronze: "Connected+",
};

// Every item visible in this combined view already reaches the Partner
// audience one way or another — the question is just whether it's
// restricted to one track or open to both. Anything not specifically
// Connected+-only or plain-Exhibitor-only is available on both, so it gets
// both tags (rendered as a red stripe + a blue stripe) instead of no tag at
// all — "no colour" used to silently mean "both," which read as unlabeled.
function tierTagsOf(itemId: string): { label: string; color: string }[] {
  if (BRONZE_ONLY_IDS.has(itemId))
    return [{ label: TRACK_LABEL.bronze, color: TRACK_COLOR.bronze }];
  if (EXHIBITOR_ONLY_IDS.has(itemId))
    return [{ label: TRACK_LABEL.exhibitor, color: TRACK_COLOR.exhibitor }];
  return [
    { label: TRACK_LABEL.exhibitor, color: TRACK_COLOR.exhibitor },
    { label: TRACK_LABEL.bronze, color: TRACK_COLOR.bronze },
  ];
}

/**
 * Pulled live from the real catalog-derived agenda (schedule-service.ts /
 * agenda.ts) — the same read model the admin Schedule tab uses — not
 * hand-written copy. Rendering itself lives in ScheduleDayCards.tsx (a pure,
 * data-driven block) so other contexts — e.g. the non-member /attend flow,
 * which needs the real schedule for one specific Day Pass rather than an
 * audience track — can reuse the exact same day-card markup instead of a
 * bespoke rewrite.
 *
 * `track` drives both filtering and colour, mirroring the persona pattern
 * used everywhere else on this page:
 *  - "exhibitor" / "bronze": a partner who already holds a booth — show only
 *    the days their own registration actually includes.
 *  - "delegate": a member org — show the days their registration covers.
 *  - null: nobody's picked a level yet (undecided partner, or the public
 *    vendor tab) — show every partner-facing block, colour-coded by which
 *    tier unlocks it, so it doubles as a reason to upgrade.
 */
export default async function ScheduleAtAGlance({
  conferenceId,
  conferenceStartDate,
  track,
}: {
  conferenceId: string;
  /** On-site days only — pre-conference items (see DeadlinesTimeline) are excluded so nothing shows twice. */
  conferenceStartDate: string;
  track: ScheduleTrack | null;
}) {
  const timeline = await getConferenceScheduleTimeline(conferenceId, {
    viewerRole: "observer",
  });

  // Meals are real rows but too granular for a summary. Filtering by kind
  // (rather than nesting depth) also guarantees a meaningful block like
  // Trade Show Tuesday always surfaces as its own row even when agenda.ts's
  // time-containment nesting tucks it a level under the wider Move-in window.
  const blocks = timeline.programItems.filter(
    (item) => item.kind !== "meal" && item.dayKeyLocal >= conferenceStartDate,
  );

  let visible: typeof blocks;
  if (track === "non_member") {
    // A non-member's access isn't audience-tagged on the schedule items
    // themselves (only the Day Pass offer entities are `who`-linked to the
    // Non-Member audience) — it's whatever each Day Pass reaches via its own
    // `includes` graph, same computation the /attend storefront uses. Union
    // across every non-member offer, since before buying, this is "what can
    // a non-member attend at all," not one specific purchased day.
    const passes = await getNonMemberDayPasses(conferenceId);
    const idSet = new Set(passes.flatMap((p) => p.entityIds));
    visible = blocks.filter((item) => idSet.has(item.id));
  } else {
    const audience = track === "delegate" ? "Member" : "Partner";
    visible = blocks.filter((item) => item.audienceNames.includes(audience));
    if (track === "exhibitor")
      visible = visible.filter((item) => !BRONZE_ONLY_IDS.has(item.id));
    if (track === "bronze")
      visible = visible.filter((item) => !EXHIBITOR_ONLY_IDS.has(item.id));
  }

  if (visible.length === 0) return null;

  // AgendaItem.id is the catalog entity id, which is also what a linked
  // Events row points back at — no changes needed in agenda.ts/schedule-service.ts.
  const { data: linkedEvents } = await createAdminClient()
    .from("events")
    .select("slug, conference_entity_id")
    .in(
      "conference_entity_id",
      visible.map((item) => item.id),
    )
    .eq("status", "published");
  const rsvpSlugByEntityId = new Map(
    (linkedEvents ?? [])
      .filter(
        (e): e is { slug: string; conference_entity_id: string } =>
          !!e.slug && !!e.conference_entity_id,
      )
      .map((e) => [e.conference_entity_id, e.slug]),
  );

  const { dayKeys, byDay } = groupByDay(visible);

  const heading =
    track === "delegate" || track === "non_member"
      ? "Your schedule"
      : track
        ? "Your on-site schedule"
        : "Schedule at a glance";
  const subheading =
    track === "delegate"
      ? "Pulled from your registration."
      : track === "non_member"
        ? "Every day you can register for as a non-member."
        : track
          ? `Pulled from your booth registration — the ${TRACK_LABEL[track].toLowerCase()} track.`
          : "Colour-coded by tier, so you can see exactly which days each level unlocks.";

  const legend =
    track === null ? (
      <div className="flex gap-4 text-xs font-medium text-[#6B6B6B]">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: TRACK_COLOR.exhibitor }}
          />
          Exhibitor
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: TRACK_COLOR.bronze }}
          />
          Connected+
        </span>
      </div>
    ) : undefined;

  return (
    <ScheduleDayCards
      heading={heading}
      subheading={subheading}
      dayKeys={dayKeys}
      byDay={byDay}
      rsvpSlugByEntityId={rsvpSlugByEntityId}
      tierTagFor={track === null ? tierTagsOf : undefined}
      legend={legend}
    />
  );
}
