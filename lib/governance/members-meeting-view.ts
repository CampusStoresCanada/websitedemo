/**
 * Everything a members' meeting screen needs, read in one pass.
 *
 * Lives in `lib/governance/` with the rest of the meeting, not in
 * `lib/elections/service.ts` where it was first written. The meeting is the
 * activity; the election is business at it. This module may import the election
 * readers — the dependency runs governance → elections and not back, which is
 * what keeps it acyclic.
 *
 * ⛔ ONE loader, the shape `getCommitteeReview` has for the election screen.
 * The meeting page used to call the meeting reader, the election, the notice
 * state, the package state and then a spine reader that loaded the meeting and
 * the election AGAIN — three reads of the election and two of the meeting per
 * render. Everything below takes what it is given rather than fetching.
 *
 * ⚠️ `getElection` cannot simply be request-cached to paper over that:
 * `applyBoardTransition` re-reads it after writing, so a per-request cache
 * would hand it stale rows.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  evaluateElectionEligibility,
  getAgmPackageState,
  getCandidateOutcomes,
  getElection,
  getNoticeState,
  listNominations,
  today,
  type Election,
  type NoticeState,
} from "@/lib/elections/service";
import { resolveNoticeWindow } from "@/lib/elections/agm-notice";
import type { TimelineStage } from "@/lib/elections/timeline";
import {
  buildMeetingSpine,
  type ElectionFacts,
  type TimelineFacts,
} from "@/lib/governance/meeting-spine";
import {
  MEMBERS_MEETING_LABELS,
  isMembersMeetingType,
  membersMeetingGaps,
} from "@/lib/governance/members-meetings";
import { getMembersMeeting } from "@/lib/governance/members-meetings-service";
import type { Event } from "@/lib/events/types";

/**
 * The cycle as a chronological spine, resolved from live state.
 *
 * `onDate` re-reads that live state as it would stand on another day, so the
 * committee can see what a stage looks like before living through it. It moves
 * the calendar and nothing else: every stage is still resolved from what has
 * actually happened, so a date preview can show that closing nominations
 * becomes available on the 23rd, and can never show it already done.
 *
 * ⚠️ Callers passing a date MUST disable the actions — see `disableActions`.
 */
export async function getElectionTimeline(
  slug: string,
  onDate?: string
): Promise<TimelineStage[] | null> {
  const election = await getElection(slug);
  if (!election) return null;

  // ⛔ By the relation, not by matching dates — `election.meetingId`.
  const [meeting, notice] = await Promise.all([
    election.meetingId ? getMembersMeeting(election.meetingId) : Promise.resolve(null),
    getNoticeState(slug, onDate),
  ]);

  return buildMeetingSpine(
    {
      ...meetingHalfOf(meeting, election.schedule.agmDate, election, notice),
      election: await electionHalf(election),
    },
    onDate ?? today()
  );
}

/**
 * Everything the members' meeting screen needs, in ONE pass.
 *
 * ⛔ One loader, like `getCommitteeReview` is for the election screen. The page
 * used to call `getMembersMeeting`, `getElection`, `getNoticeState`,
 * `getAgmPackageState` and then a spine reader that loaded the meeting and the
 * election AGAIN — `getElection` three times and the meeting twice per render,
 * measured at 17 to 23 seconds against the election screen's 7. Nothing here is
 * request-cached and `getElection` cannot safely be: `applyBoardTransition`
 * re-reads it after writing, so a per-request cache would hand it stale rows.
 * The fix is to load each thing once and pass it down, which is why every
 * helper below takes what it is given rather than fetching.
 */
export interface MembersMeetingView {
  meeting: NonNullable<
    Awaited<
      ReturnType<
        typeof import("@/lib/governance/members-meetings-service").getMembersMeeting
      >
    >
  >;
  election: Election | null;
  noticeState: NoticeState | null;
  agmPackage: Awaited<ReturnType<typeof getAgmPackageState>>;
  /** The full event row, for `EventForm`. Null when there is no event yet. */
  event: Event | null;
  /** Only resolved once the result is certified. */
  candidateCount: number | null;
  spine: TimelineStage[];
}

export async function getMembersMeetingView(
  meetingId: string,
  onDate?: string
): Promise<MembersMeetingView | null> {
  const { getEvent } = await import("@/lib/actions/events");
  const meeting = await getMembersMeeting(meetingId);
  if (!meeting) return null;

  const slug = meeting.election?.slug ?? null;

  // ⛔ ONE wave. `electionHalf` needs the Election object, so the election is
  // resolved first (~150ms) and then everything else fires together. Awaiting
  // the notice state and `electionHalf` in series cost 8.5s + 5.2s instead of
  // the longer of the two.
  const election = slug ? await getElection(slug) : null;

  const [noticeState, agmPackage, eventResult, electionFacts, candidateOutcomes] =
    await Promise.all([
      slug ? getNoticeState(slug, onDate) : Promise.resolve(null),
      slug ? getAgmPackageState(slug) : Promise.resolve(null),
      meeting.event ? getEvent(meeting.event.id) : Promise.resolve(null),
      election ? electionHalf(election) : Promise.resolve(null),
      slug && election?.status === "certified"
        ? getCandidateOutcomes(slug)
        : Promise.resolve(null),
    ]);

  const spine = buildMeetingSpine(
    {
      ...meetingHalfOf(meeting, meeting.meetingDate, election, noticeState),
      election: electionFacts,
    },
    onDate ?? today()
  );

  return {
    meeting,
    election,
    noticeState,
    agmPackage,
    event: eventResult?.success ? eventResult.data : null,
    candidateCount: candidateOutcomes
      ? candidateOutcomes.elected.length + candidateOutcomes.notElected.length
      : null,
    spine,
  };
}

/**
 * The meeting half of the spine's facts. Pure: it fetches nothing.
 *
 * The notice window comes from `resolveNoticeWindow(meetingDate)`, which is
 * pure — so it is available with no election. The notice/proxy/package SENT
 * timestamps are recorded on the election's config, so they are null for a
 * meeting without one. ⚠️ That is a real gap, not a default: notice given by
 * hand for a special members' meeting has nowhere to be recorded, so the spine
 * will keep saying it has not been given.
 */
function meetingHalfOf(
  meeting: Awaited<
    ReturnType<typeof import("@/lib/governance/members-meetings-service").getMembersMeeting>
  >,
  meetingDate: string,
  election: Election | null,
  notice: NoticeState | null
): Omit<TimelineFacts, "election"> {
  const window = notice
    ? {
        opensOn: notice.window.opensOn,
        closesOn: notice.window.closesOn,
        proxyDueOn: notice.window.proxyDueOn,
      }
    : (() => {
        const w = resolveNoticeWindow(meetingDate);
        return { opensOn: w.opensOn, closesOn: w.closesOn, proxyDueOn: w.proxyDueOn };
      })();

  return {
    // ⛔ Not `meeting.title`. The stored title carries the date in it
    // ("CSC Annual General Meeting — 2028-01-20"), which reads as a duplicate
    // beside the stage's own date column.
    meetingLabel: election
      ? `${election.cycleYear} Annual General Meeting`
      : meeting && isMembersMeetingType(meeting.meetingType)
        ? MEMBERS_MEETING_LABELS[meeting.meetingType]
        : "Meeting of the members",
    meetingDate,
    eventPublished: notice?.eventPage.readyForNotice ?? meeting?.event?.status === "published",
    eventStartSet: Boolean(meeting?.event?.startsAt),
    eventGaps: meeting ? membersMeetingGaps(meeting) : [],
    agendaDrafted: meeting?.hasAgenda ?? false,
    noticeWindow: window,
    // ⛔ From the MEETING. These are its obligations, and a members' meeting
    // with no election still has to be able to record them.
    noticeSentAt: meeting?.noticeSentAt ?? null,
    proxySentAt: meeting?.proxyFormSentAt ?? null,
    packageSentAt: meeting?.packageSentAt ?? null,
  };
}

/** The election half of the spine's facts. */
async function electionHalf(
  election: NonNullable<Awaited<ReturnType<typeof getElection>>>
): Promise<ElectionFacts> {
  const db = createAdminClient();
  const cfg = election.config as unknown as {
    callSentAt?: string;
    ballotsCirculatedAt?: string;
    resultsAnnouncedAt?: string;
    candidateResultsSentAt?: string;
  };

  const nominations = await listNominations(election.slug);
  const validated = nominations.filter((n) => n.completeness.complete).length;
  const { summary } = await evaluateElectionEligibility(election.id);

  const { count: ballotsReturned } = await db
    .from("election_participation")
    .select("id", { count: "exact", head: true })
    .eq("election_id", election.id);

  const { data: cert } = await db
    .from("election_certifications")
    .select("certified_at")
    .eq("election_id", election.id)
    .maybeSingle();

  return {
    cycleYear: election.cycleYear,
    status: election.status,
    outcome: (election.outcome as "acclaimed" | "balloted" | null) ?? null,
    schedule: election.schedule,
    callSentAt: cfg.callSentAt ?? null,
    ballotsCirculatedAt: cfg.ballotsCirculatedAt ?? null,
    resultsAnnouncedAt: cfg.resultsAnnouncedAt ?? null,
    candidateResultsSentAt: cfg.candidateResultsSentAt ?? null,
    certifiedAt: (cert?.certified_at as string) ?? null,
    sealed: ["sealed", "certified"].includes(election.status),
    nominationsReceived: nominations.length,
    validatedNominees: validated,
    ballotsReturned: ballotsReturned ?? 0,
    electorate: summary.eligible,
  };
}
