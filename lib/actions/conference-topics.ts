"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isGlobalAdmin, requireAdmin, requireAuthenticated } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";
import { logAuditEventSafe } from "@/lib/ops/audit";
import { zonedWallTimeToUtcIso } from "@/lib/conference/tz";
import {
  PRESENTATION_OFFER_NAME,
  clock,
  hhmm,
  loadBigIdeasDay,
  presentationSlotStarts,
  toMinutes,
  wallMinutesInZone,
} from "@/lib/conference/big-ideas-day";

/**
 * Big Ideas Day topics — proposing them, and members choosing between them.
 *
 * One object for both sources. A member proposing a table conversation and a
 * partner proposing a presentation produce the same chip, and members pick
 * between them under the same rules. What differs is the money: a partner must
 * already hold a Big Ideas Presentations slot ($250, refunded if not selected)
 * before they can put one in.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export type TopicChip = {
  id: string;
  title: string;
  body: string | null;
  /** The proposing organisation, shown so a reader can see who wants to talk about it. */
  orgName: string;
  orgType: string | null;
  /** How many members picked it. Visible to everyone; it is not a secret ballot. */
  votes: number;
  /** Did THIS viewer pick it? */
  chosen: boolean;
  /** Staff have placed it: it is running. */
  running: boolean;
  /** "9:20" once a running pitch has a time, in the conference's own zone. */
  startsAt: string | null;
  /** The table staff gave a running table conversation. */
  tableLabel: string | null;
};

/** The viewer's standing with the topic area, so the page can render one state. */
export type TopicBoardView = {
  topics: TopicChip[];
  /** Null when they have never voted. A ballot with zero picks is "none of these". */
  hasBallot: boolean;
  /** Members vote. Partners propose but do not choose between themselves. */
  canVote: boolean;
  canPropose: boolean;
  /** Set when a partner has not bought a slot, so the page can say why. */
  proposeBlockedReason: string | null;
};

/** A partner's pitch is a presentation; anyone else's is a table conversation. */
const isPresentation = (orgType: string | null | undefined) => orgType === "Vendor Partner";

async function conferenceTimeZone(db: ReturnType<typeof createAdminClient>, conferenceId: string) {
  const { data } = await db.from("conference_instances").select("timezone").eq("id", conferenceId).maybeSingle();
  return data?.timezone ?? "America/Toronto";
}

/**
 * Everything the topic board needs for one viewer, in one call.
 *
 * Deliberately one function rather than a list + a separate "did I vote" query:
 * the two answers are read together on every render, and splitting them is how
 * a page ends up showing a vote count that disagrees with the ticked boxes.
 */
export async function loadTopicBoard(
  conferenceId: string,
  organizationId: string | null,
  options: { fixtures?: boolean } = {}
): Promise<Result<TopicBoardView>> {
  const db = createAdminClient();
  const auth = await requireAuthenticated();
  const userId = auth.ok ? auth.ctx.userId : null;
  // Staff can look at the test organisations' pitches in place of the real
  // ones, to see what a placed pitch looks like without placing a real one.
  const fixtures = Boolean(options.fixtures && auth.ok && isGlobalAdmin(auth.ctx.globalRole));

  const { data: topicRows, error } = await db
    .from("conference_topics")
    .select("id, title, body, status, scheduled_at, table_label, organization_id, organizations!inner(name, type, is_test)")
    .eq("conference_id", conferenceId)
    .in("status", ["proposed", "scheduled"])
    // ⛔ Test orgs do not put topics in front of real members. Caught by
    // testing: a seeded persona's topic rendered on the board as "Proposed by
    // Test Org (BI Member)", which is what every other audience query in this
    // codebase already guards against with this same flag.
    .eq("organizations.is_test", fixtures)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { success: false, error: error.message };

  const topicIds = (topicRows ?? []).map((t) => t.id);
  const timeZone = await conferenceTimeZone(db, conferenceId);

  // Counts for every topic in one pass, rather than a query per chip.
  const { data: selectionRows } = topicIds.length
    ? await db.from("conference_topic_ballot_selections").select("topic_id, ballot_id").in("topic_id", topicIds)
    : { data: [] };

  const { data: myBallot } = userId
    ? await db
        .from("conference_topic_ballots")
        .select("id")
        .eq("conference_id", conferenceId)
        .eq("user_id", userId)
        .maybeSingle()
    : { data: null };

  const myPicks = new Set(
    (selectionRows ?? []).filter((s) => myBallot && s.ballot_id === myBallot.id).map((s) => s.topic_id)
  );
  const countByTopic = new Map<string, number>();
  for (const s of selectionRows ?? []) {
    countByTopic.set(s.topic_id, (countByTopic.get(s.topic_id) ?? 0) + 1);
  }

  const { data: org } = organizationId
    ? await db.from("organizations").select("type").eq("id", organizationId).maybeSingle()
    : { data: null };
  const isMember = org?.type === "Member";
  const isPartner = org?.type === "Vendor Partner";

  // A partner proposes only once they hold a slot. Members pay nothing.
  let proposeBlockedReason: string | null = null;
  let canPropose = Boolean(userId && organizationId && (isMember || isPartner));
  if (isPartner && organizationId) {
    const { data: slot } = await db
      .from("conference_entities")
      .select("id")
      .eq("conference_id", conferenceId)
      .eq("name", PRESENTATION_OFFER_NAME)
      .maybeSingle();
    const { count } = slot
      ? await db
          .from("entity_balances")
          .select("entity_id", { count: "exact", head: true })
          .eq("conference_id", conferenceId)
          .eq("organization_id", organizationId)
          .eq("entity_id", slot.id)
      : { count: 0 };
    if (!count) {
      canPropose = false;
      proposeBlockedReason =
        "Presentation slots run on a proposal with a deposit, refunded if yours is not selected. Add one to your cart to put a topic forward.";
    }
  }

  return {
    success: true,
    data: {
      topics: (topicRows ?? []).map((t) => {
        const o = Array.isArray(t.organizations) ? t.organizations[0] : t.organizations;
        return {
          id: t.id,
          title: t.title,
          body: t.body,
          orgName: (o as { name?: string } | null)?.name ?? "",
          orgType: (o as { type?: string } | null)?.type ?? null,
          votes: countByTopic.get(t.id) ?? 0,
          chosen: myPicks.has(t.id),
          running: t.status === "scheduled",
          startsAt: t.scheduled_at ? clock(wallMinutesInZone(t.scheduled_at, timeZone)) : null,
          tableLabel: t.table_label,
        };
      }),
      hasBallot: Boolean(myBallot),
      canVote: Boolean(userId && isMember),
      canPropose,
      proposeBlockedReason,
    },
  };
}

/** Put a topic forward. */
export async function proposeTopic(params: {
  conferenceId: string;
  organizationId: string;
  title: string;
  body: string;
}): Promise<Result<{ id: string }>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.ctx.activeOrgIds.includes(params.organizationId)) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const title = params.title.trim();
  if (!title) return { success: false, error: "Give the topic a title." };

  const db = createAdminClient();

  // Re-check the deposit server-side. The page hides the form without one, but
  // a hidden form is a presentation choice, not a gate.
  const { data: org } = await db
    .from("organizations")
    .select("type")
    .eq("id", params.organizationId)
    .maybeSingle();
  // The deposit this pitch rides on. The column existed from the start "so the
  // refund has something to point at in December" and nothing ever filled it.
  let depositPurchaseId: string | null = null;
  if (org?.type === "Vendor Partner") {
    const { data: slot } = await db
      .from("conference_entities")
      .select("id")
      .eq("conference_id", params.conferenceId)
      .eq("name", PRESENTATION_OFFER_NAME)
      .maybeSingle();
    const { data: held } = slot
      ? await db
          .from("entity_balances")
          .select("purchase_id")
          .eq("conference_id", params.conferenceId)
          .eq("organization_id", params.organizationId)
          .eq("entity_id", slot.id)
          .limit(1)
      : { data: [] };
    if (!held?.length) return { success: false, error: "A presentation slot is required before proposing a topic." };
    depositPurchaseId = held[0].purchase_id ?? null;
  }

  const { data, error } = await db
    .from("conference_topics")
    .insert({
      conference_id: params.conferenceId,
      organization_id: params.organizationId,
      submitted_by_user_id: auth.ctx.userId,
      title,
      body: params.body.trim() || null,
      deposit_purchase_id: depositPurchaseId,
    })
    .select("id")
    .single();
  if (error || !data) return { success: false, error: error?.message ?? "Could not save that topic." };

  revalidatePath("/big-ideas-day");
  return { success: true, data: { id: data.id } };
}

/**
 * Record this member's picks, replacing whatever they had.
 *
 * ⛔ An EMPTY array is a real answer — "none of these" — not an empty call.
 * That is why the ballot and its selections are separate rows: no ballot means
 * they never came, a ballot with no selections means they read the list and
 * none of it appealed.
 *
 * ⛔ Which also makes this the most destructive write on the page. Call it from
 * a click, NEVER from an effect watching state: React double-invokes effects in
 * development, and the second pass writing an initial empty array would silently
 * convert "has not voted" into "voted for none". MeetingPreferencesEditor
 * carries the same warning because it already destroyed a real saved choice
 * that way.
 */
export async function saveTopicBallot(params: {
  conferenceId: string;
  organizationId: string;
  topicIds: string[];
}): Promise<Result<null>> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!auth.ctx.activeOrgIds.includes(params.organizationId)) {
    return { success: false, error: "Not authorized for this organization." };
  }

  const db = createAdminClient();

  // Members choose; partners are the ones being chosen between.
  const { data: org } = await db
    .from("organizations")
    .select("type")
    .eq("id", params.organizationId)
    .maybeSingle();
  if (org?.type !== "Member") {
    return { success: false, error: "Only member stores vote on topics." };
  }

  const { data: ballot, error: ballotError } = await db
    .from("conference_topic_ballots")
    .upsert(
      {
        conference_id: params.conferenceId,
        organization_id: params.organizationId,
        user_id: auth.ctx.userId,
        submitted_at: new Date().toISOString(),
      },
      { onConflict: "conference_id,user_id" }
    )
    .select("id")
    .single();
  if (ballotError || !ballot) {
    return { success: false, error: ballotError?.message ?? "Could not record your choices." };
  }

  const { error: clearError } = await db
    .from("conference_topic_ballot_selections")
    .delete()
    .eq("ballot_id", ballot.id);
  if (clearError) return { success: false, error: clearError.message };

  if (params.topicIds.length > 0) {
    const { error: insertError } = await db
      .from("conference_topic_ballot_selections")
      .insert(params.topicIds.map((topic_id) => ({ ballot_id: ballot.id, topic_id })));
    if (insertError) return { success: false, error: insertError.message };
  }

  revalidatePath("/big-ideas-day");
  return { success: true, data: null };
}

// ─────────────────────────────────────────────────────────────────
// Staff: read the tallies, place what runs
// ─────────────────────────────────────────────────────────────────

export type StaffTopic = {
  id: string;
  title: string;
  body: string | null;
  orgName: string;
  /** Presentation (a partner's, in the presentation room) or table conversation. */
  presentation: boolean;
  status: "proposed" | "scheduled" | "declined" | "withdrawn";
  /** How many members chose it. */
  votes: number;
  /** "09:20" when placed, the same form the slot picker offers. */
  startTime: string | null;
  tableLabel: string | null;
  /** A partner's $250 deposit is on record for this pitch. */
  hasDeposit: boolean;
};

export type StaffTopicBoard = {
  dayLabel: string | null;
  tablesRoom: string | null;
  talksRoom: string | null;
  /** How many members have cast a ballot at all, including "none of these". */
  ballots: number;
  /** Every start a presentation can take, from the schedule's own windows. */
  slots: Array<{ value: string; label: string }>;
  topics: StaffTopic[];
};

/**
 * Every pitch with its tally, for the admin Schedule page.
 *
 * `fixtures` swaps the real pitches for the test organisations' ones, so the
 * buttons can be tried without placing a real partner's presentation on the
 * live page (local and production share one database). Never both at once: a
 * mixed list is how a fixture gets mistaken for a pitch.
 */
export async function listTopicsForStaff(
  conferenceId: string,
  options: { fixtures?: boolean } = {}
): Promise<Result<StaffTopicBoard>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const [day, timeZone] = await Promise.all([loadBigIdeasDay(db, conferenceId), conferenceTimeZone(db, conferenceId)]);

  const { data: rows, error } = await db
    .from("conference_topics")
    .select(
      "id, title, body, status, scheduled_at, table_label, deposit_purchase_id, organizations!inner(name, type, is_test)"
    )
    .eq("conference_id", conferenceId)
    .eq("organizations.is_test", Boolean(options.fixtures))
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { success: false, error: error.message };

  /*
    ⛔ Count only the ballots of the kind being shown. A test member's pick on a
    real pitch is not a vote, and it was being counted as one: the first look
    at this panel said "1 member has chosen" when no real member had.
  */
  const { data: ballotRows } = await db
    .from("conference_topic_ballots")
    .select("id, organizations!inner(is_test)")
    .eq("conference_id", conferenceId)
    .eq("organizations.is_test", Boolean(options.fixtures));
  const ballotIds = new Set((ballotRows ?? []).map((b) => b.id));
  const ballots = ballotIds.size;

  const ids = (rows ?? []).map((r) => r.id);
  const { data: selections } = ids.length
    ? await db.from("conference_topic_ballot_selections").select("topic_id, ballot_id").in("topic_id", ids)
    : { data: [] };
  const votes = new Map<string, number>();
  for (const sel of selections ?? []) {
    if (ballotIds.has(sel.ballot_id)) votes.set(sel.topic_id, (votes.get(sel.topic_id) ?? 0) + 1);
  }

  return {
    success: true,
    data: {
      dayLabel: day?.dayLabel ?? null,
      tablesRoom: day?.tablesRoom ?? null,
      talksRoom: day?.talksRoom ?? null,
      ballots,
      slots: presentationSlotStarts(day?.talkWindows ?? []).map((m) => ({ value: hhmm(m), label: clock(m) })),
      topics: (rows ?? []).map((r) => {
        const o = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
        return {
          id: r.id,
          title: r.title,
          body: r.body,
          orgName: (o as { name?: string } | null)?.name ?? "",
          presentation: isPresentation((o as { type?: string } | null)?.type),
          status: r.status as StaffTopic["status"],
          votes: votes.get(r.id) ?? 0,
          startTime: r.scheduled_at ? hhmm(wallMinutesInZone(r.scheduled_at, timeZone)) : null,
          tableLabel: r.table_label,
          hasDeposit: Boolean(r.deposit_purchase_id),
        };
      }),
    },
  };
}

/**
 * Staff decide what runs: "informed by the votes but not bound to them".
 *
 * ⛔ Running is the placement, not a press after it. A presentation runs by
 * being given one of the day's slots; a table conversation runs by being given
 * a table. There is no "approve" that leaves either without a place, because
 * the public page would then announce something with nowhere to be.
 *
 * ⛔ Declining moves no money. A partner's deposit is refunded from the order
 * screen, by a person, not as a side effect of this button.
 */
export async function placeTopic(params: {
  topicId: string;
  decision: "run" | "decline" | "undecide";
  /** "09:20". Required to run a presentation; optional for a table. */
  startTime?: string | null;
  /** Required to run a table conversation. */
  tableLabel?: string | null;
}): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: topic } = await db
    .from("conference_topics")
    .select("id, conference_id, status, scheduled_at, table_label, organizations!inner(type, is_test)")
    .eq("id", params.topicId)
    .maybeSingle();
  if (!topic) return { success: false, error: "That pitch no longer exists." };
  const o = Array.isArray(topic.organizations) ? topic.organizations[0] : topic.organizations;
  const presentation = isPresentation((o as { type?: string } | null)?.type);

  let patch: { status: string; scheduled_at: string | null; table_label: string | null };

  if (params.decision === "run") {
    const [day, timeZone] = await Promise.all([
      loadBigIdeasDay(db, topic.conference_id),
      conferenceTimeZone(db, topic.conference_id),
    ]);
    if (!day?.dayIso) return { success: false, error: "Big Ideas Day has no day on the schedule yet." };
    const startTime = params.startTime?.trim() || null;
    if (startTime && !/^\d{2}:\d{2}$/.test(startTime)) return { success: false, error: "That is not a time." };

    if (presentation) {
      if (!startTime) return { success: false, error: "Pick a time for this presentation." };
      const allowed = presentationSlotStarts(day.talkWindows).map(hhmm);
      if (!allowed.includes(startTime)) {
        return { success: false, error: "That time is outside the presentation windows on the schedule." };
      }
      // One room, one presenter at a time.
      const { data: others } = await db
        .from("conference_topics")
        .select("id, title, scheduled_at, organizations!inner(type)")
        .eq("conference_id", topic.conference_id)
        .eq("status", "scheduled")
        .eq("organizations.type", "Vendor Partner")
        // A fixture's slot never blocks a real presentation, nor the reverse.
        .eq("organizations.is_test", Boolean((o as { is_test?: boolean } | null)?.is_test))
        .neq("id", topic.id);
      const clash = (others ?? []).find(
        (x) => x.scheduled_at && hhmm(wallMinutesInZone(x.scheduled_at, timeZone)) === startTime
      );
      if (clash) return { success: false, error: `"${clash.title}" already has ${clock(toMinutes(startTime))}.` };
    } else if (!params.tableLabel?.trim()) {
      return { success: false, error: "Give this conversation a table." };
    }

    patch = {
      status: "scheduled",
      scheduled_at: startTime ? zonedWallTimeToUtcIso(day.dayIso, startTime, timeZone) : null,
      table_label: presentation ? null : (params.tableLabel?.trim() ?? null),
    };
  } else {
    patch = {
      status: params.decision === "decline" ? "declined" : "proposed",
      scheduled_at: null,
      table_label: null,
    };
  }

  const { error } = await db
    .from("conference_topics")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", topic.id);
  if (error) return { success: false, error: error.message };

  await logAuditEventSafe({
    action: "conference_topic_placed",
    entityType: "conference_topic",
    entityId: topic.id,
    actorId: auth.ctx.userId,
    actorType: "user",
    details: {
      conferenceId: topic.conference_id,
      from: { status: topic.status, scheduledAt: topic.scheduled_at, tableLabel: topic.table_label },
      to: patch,
    },
  });

  revalidatePath("/big-ideas-day");
  revalidatePath(`/admin/conference/${topic.conference_id}/schedule`);
  return { success: true, data: null };
}
