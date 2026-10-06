"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated } from "@/lib/auth/guards";
import { revalidatePath } from "next/cache";

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

const PRESENTATION_OFFER_NAME = "Big Ideas Presentations";

/**
 * Everything the topic board needs for one viewer, in one call.
 *
 * Deliberately one function rather than a list + a separate "did I vote" query:
 * the two answers are read together on every render, and splitting them is how
 * a page ends up showing a vote count that disagrees with the ticked boxes.
 */
export async function loadTopicBoard(
  conferenceId: string,
  organizationId: string | null
): Promise<Result<TopicBoardView>> {
  const db = createAdminClient();
  const auth = await requireAuthenticated();
  const userId = auth.ok ? auth.ctx.userId : null;

  const { data: topicRows, error } = await db
    .from("conference_topics")
    .select("id, title, body, organization_id, organizations!inner(name, type, is_test)")
    .eq("conference_id", conferenceId)
    .in("status", ["proposed", "scheduled"])
    // ⛔ Test orgs do not put topics in front of real members. Caught by
    // testing: a seeded persona's topic rendered on the board as "Proposed by
    // Test Org (BI Member)", which is what every other audience query in this
    // codebase already guards against with this same flag.
    .eq("organizations.is_test", false)
    .order("created_at", { ascending: true });
  if (error) return { success: false, error: error.message };

  const topicIds = (topicRows ?? []).map((t) => t.id);

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
  if (org?.type === "Vendor Partner") {
    const { data: slot } = await db
      .from("conference_entities")
      .select("id")
      .eq("conference_id", params.conferenceId)
      .eq("name", PRESENTATION_OFFER_NAME)
      .maybeSingle();
    const { count } = slot
      ? await db
          .from("entity_balances")
          .select("entity_id", { count: "exact", head: true })
          .eq("conference_id", params.conferenceId)
          .eq("organization_id", params.organizationId)
          .eq("entity_id", slot.id)
      : { count: 0 };
    if (!count) return { success: false, error: "A presentation slot is required before proposing a topic." };
  }

  const { data, error } = await db
    .from("conference_topics")
    .insert({
      conference_id: params.conferenceId,
      organization_id: params.organizationId,
      submitted_by_user_id: auth.ctx.userId,
      title,
      body: params.body.trim() || null,
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
