/**
 * Handing the election's work to the people who actually do it.
 *
 * An election is a sequence of obligations with dates and named owners, and the
 * by-law names most of them: the board appoints the Nominating Committee
 * (Part V S1), the committee submits the slate and issues the call (S2(a),(b)),
 * the President appoints a scrutineer (S3(b)), the committee's Chair announces
 * the result at the AGM (S3(d)). None of that should arrive as a reminder in
 * somebody's personal notes — it belongs in the board's own action-item system,
 * assigned, dated, and visible at the meeting where it can still be acted on.
 *
 * Two design points worth stating:
 *
 *  - Each item is parented to the last board meeting BEFORE its deadline, not
 *    the meeting after. An action item that first appears at the meeting after
 *    its due date is an autopsy, not a task.
 *  - Owners are resolved from `governance_role_assignments`, so "the President"
 *    means whoever holds the office when the items are minted, and next year's
 *    President inherits the work without anyone editing code. Where an office is
 *    vacant the item is still created and reported as unassigned, because a
 *    missing owner is a fact the board needs rather than a reason to skip a
 *    constitutional step.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { Election } from "./service";

/** Offices the election process depends on. */
export type ElectionRoleKey =
  | "executive_director"
  | "president"
  | "past_president"
  | "nominating_committee_chair";

export interface ElectionTaskTemplate {
  key: string;
  title: string;
  description: string;
  /** Which phase date this hangs off. */
  dueOn: (election: Election) => string;
  /** Preferred owner first; later entries are fallbacks if the office is vacant. */
  owners: ElectionRoleKey[];
}

/**
 * The election's obligations, in order.
 *
 * The Past-President leads the nominating process at CSC in practice, with the
 * President standing in when they are unavailable — so most nomination-side work
 * lists past_president first and falls back to president, then to the Executive
 * Director who runs the mechanics either way.
 */
export const ELECTION_TASKS: ElectionTaskTemplate[] = [
  {
    key: "appoint_nominating_committee",
    title: "Appoint the Nominating Committee for the {year} election",
    description:
      "By-Law Part V S1: the board appoints a Nominating Committee annually, and sets its size and duties in terms of reference. Recent practice has been for the Executive Director to fill it, which is a divergence from the by-law worth resolving one way or the other — either bring the appointment back to the board, or amend the by-law to match what the association actually does.\n\nWhile the committee is being appointed, agree what happens if two candidates tie for the last seat. By-Law No. 1 prescribes nothing. Two readings are defensible: the members elect at the AGM (Part V S3(e)), so the tie goes to the floor; or the motion is defeated (Part VII S8), the seat is vacant, and the board appoints (Part IV S3). The software will stop and ask rather than break a tie, so the answer has to exist before December.",
    dueOn: (e) => e.schedule.nominationsOpenAt,
    owners: ["past_president", "president", "executive_director"],
  },
  {
    key: "submit_slate",
    title: "Submit the continuing directors and the Nominating Committee's slate",
    description:
      "By-Law Part V S2(a): no fewer than 120 days before the AGM, the Nominating Committee submits the list of continuing directors and a slate of nominees for the vacant positions.\n\nThe slate must contain exactly the number of seats being filled. More than that and the acclamation branch is incoherent — you cannot acclaim five people into four seats.",
    dueOn: (e) => e.schedule.nominationsOpenAt,
    owners: ["past_president", "president", "executive_director"],
  },
  {
    key: "issue_call",
    title: "Send the call for nominations to the membership",
    description:
      "By-Law Part V S2(b): the call goes to every member institution no fewer than 120 days before the AGM, and must include the slate and a nomination form.\n\nSend it from the election review page in the admin area — it emails every administrator at each currently eligible institution and records that it was sent, so it cannot go out twice. Check the eligibility figure before pressing it: institutions that have not completed their renewal cannot nominate, co-sign or vote, and they are not counted in the reach.",
    dueOn: (e) => e.schedule.nominationsOpenAt,
    owners: ["executive_director"],
  },
  {
    key: "chase_incomplete",
    title: "Chase incomplete nominations before they lapse",
    description:
      "A nomination reaches the ballot only when the nominee has accepted, their institution has granted permission for them to serve (Part V S2(d)), and the required co-signatures are in. Anything short of that on the closing date does not go forward.\n\nThe election review page lists exactly what each nomination is missing and will send a reminder to the nominees. Some of the gaps need someone other than the nominee to act, so they are worth a phone call rather than a second email.",
    dueOn: (e) => e.schedule.nominationsCloseAt,
    owners: ["executive_director"],
  },
  {
    key: "close_nominations",
    title: "Close nominations and confirm whether a ballot is needed",
    description:
      "By-Law Part V S2(c): additional nominations may be submitted up to 90 days before the AGM. After that the field is fixed.\n\nIf more nominees stand than there are seats, a ballot goes out. If not, the nominees are acclaimed and there is no vote. Closing nominations in the admin area writes the field down — after this point the ballot cannot change, which is the whole point: a member who votes early must be looking at the same ballot as one who votes late.",
    dueOn: (e) => e.schedule.nominationsCloseAt,
    owners: ["past_president", "president", "executive_director"],
  },
  {
    key: "appoint_scrutineer",
    title: "Appoint a scrutineer to receive and count the ballots",
    description:
      "By-Law Part V S3(b): the President appoints a scrutineer to receive and count the ballots.\n\nThis is the audit role. The scrutineer can see which institutions returned a ballot and the totals per candidate, and can confirm the two reconcile — but not how any institution voted. That link is destroyed when the ballots are sealed, deliberately and irreversibly.",
    dueOn: (e) => e.schedule.ballotsOpenAt,
    owners: ["president", "past_president"],
  },
  {
    key: "circulate_ballots",
    title: "Circulate ballots to the membership",
    description:
      "By-Law Part V S3(a): if additional nominations were received, ballots are circulated no less than 60 days before the AGM, listing candidates alphabetically and stating how many directors are to be elected.\n\nEach institution gets one ballot regardless of how many administrators it has, and any of them can change it until it closes.",
    dueOn: (e) => e.schedule.ballotsOpenAt,
    owners: ["executive_director"],
  },
  {
    key: "chase_turnout",
    title: "Chase institutions that have not returned a ballot",
    description:
      "Ballots are due back no less than 30 days before the AGM (Part V S3(c)).\n\nTurnout is measured from ballots actually returned, not from whether anyone opened an email — delivery tracking is not currently recording anything, so the returned count is the only figure worth acting on. Every director is also an administrator of their own institution; if turnout is limited to them, the board has effectively re-elected itself, and that is worth a round of phone calls.",
    dueOn: (e) => e.schedule.ballotsCloseAt,
    owners: ["executive_director"],
  },
  {
    key: "certify_result",
    title: "Seal the ballots, count, and certify the result",
    description:
      "Sealing removes the link between every ballot and the institution that cast it. It is irreversible, and afterwards a disputed ballot cannot be traced back — that is the point of it, but it should be done knowingly.\n\nIf two candidates tie for the last seat the count will stop and name them rather than picking one, and certification stays blocked until a human records how the tie was resolved and on what authority.",
    dueOn: (e) => e.schedule.ballotsCloseAt,
    owners: ["president", "past_president", "executive_director"],
  },
  {
    key: "announce_result",
    title: "Announce the result at the annual general meeting",
    description:
      "By-Law Part V S3(d): the Chair of the Nominating Committee announces the ballot results, or the acclaimed candidates where no additional nominations were received. Under S3(e) the members then elect the directors who had the most votes.\n\nIf a tie went to the floor, this is where it is settled.",
    dueOn: (e) => e.schedule.agmDate,
    owners: ["nominating_committee_chair", "past_president", "president"],
  },
];

export interface MintedTask {
  key: string;
  title: string;
  dueDate: string;
  meetingDate: string | null;
  assignedTo: { role: ElectionRoleKey; name: string } | null;
  /** Set when no holder of any listed office could be found. */
  unassignedReason?: string;
  created: boolean;
}

/** Current holder of an office, if there is one. */
async function resolveRoleHolder(
  bodyId: string,
  roleKey: ElectionRoleKey
): Promise<{ profileId: string; name: string } | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("governance_role_assignments")
    .select("person_profile_id, profiles:person_profile_id(display_name)")
    .eq("body_id", bodyId)
    .eq("role_key", roleKey)
    .is("term_end", null)
    .limit(1);

  const row = data?.[0];
  if (!row?.person_profile_id) return null;
  return {
    profileId: row.person_profile_id as string,
    name: (row.profiles as { display_name: string } | null)?.display_name ?? "Unnamed",
  };
}

/**
 * The last board meeting on or before a date.
 *
 * Deliberately BEFORE: an action item that first surfaces at the meeting after
 * its due date is a post-mortem. Returns null when nothing precedes it, which
 * happens when the deadline falls before the next scheduled meeting — reported
 * rather than silently attached to the wrong one.
 */
async function meetingBefore(date: string): Promise<{ id: string; date: string } | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_meetings")
    .select("id, meeting_date")
    .lte("meeting_date", date)
    .order("meeting_date", { ascending: false })
    .limit(1);

  const row = data?.[0];
  return row ? { id: row.id as string, date: row.meeting_date as string } : null;
}

/**
 * Create the election's action items, assigned to whoever currently holds each
 * office. Idempotent — re-running adds only what is missing, matched on the
 * title, so a second press does not double the board's list.
 */
export async function mintElectionActionItems(
  election: Election,
  options: { dryRun?: boolean } = {}
): Promise<MintedTask[]> {
  const db = createAdminClient();
  const results: MintedTask[] = [];

  for (const task of ELECTION_TASKS) {
    const dueDate = task.dueOn(election);
    const title = task.title.replace("{year}", String(election.cycleYear));

    let holder: { profileId: string; name: string } | null = null;
    let usedRole: ElectionRoleKey | null = null;
    for (const role of task.owners) {
      holder = await resolveRoleHolder(election.bodyId, role);
      if (holder) {
        usedRole = role;
        break;
      }
    }

    const meeting = await meetingBefore(dueDate);

    const { data: existing } = await db
      .from("board_action_items")
      .select("id")
      .eq("title", title)
      .limit(1);

    const alreadyThere = (existing?.length ?? 0) > 0;
    let created = false;

    if (!alreadyThere && !options.dryRun && meeting) {
      const { data: last } = await db
        .from("board_action_items")
        .select("sort_order")
        .eq("meeting_id", meeting.id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { error } = await db.from("board_action_items").insert({
        meeting_id: meeting.id,
        title,
        description: task.description,
        assignees: holder ? [holder.profileId] : [],
        due_date: dueDate,
        sort_order: ((last?.sort_order as number) ?? -1) + 1,
        source: "manual",
      });
      created = !error;
    }

    results.push({
      key: task.key,
      title,
      dueDate,
      meetingDate: meeting?.date ?? null,
      assignedTo: holder && usedRole ? { role: usedRole, name: holder.name } : null,
      unassignedReason: holder
        ? undefined
        : `No current holder of: ${task.owners.join(", ")}. The item is still on the board's list, unassigned.`,
      created: created || (alreadyThere ? false : created),
    });
  }

  return results;
}
