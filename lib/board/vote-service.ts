/**
 * Board vote lifecycle — open, record, remind, close.
 *
 * The database is the governance record. Circle is a display surface: Butler
 * posts the application there and comments the outcome, but every ballot and
 * every tally lives here. See lib/board/vote-post.ts for why the vote cannot
 * live in a Circle poll.
 */

import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleGhostClient } from "@/lib/circle/client";
import { getCircleConfig } from "@/lib/circle/config";
import { buildVotePost } from "@/lib/board/vote-post";
import { computeClosesAt, formatCloseLabel, computeReminderAt } from "@/lib/board/vote-schedule";
import {
  tallyVote,
  resolveStatus,
  formatTally,
  formatOutcome,
  type Tally,
  type VoteChoice,
  type VoteStatus,
} from "@/lib/board/vote-tally";
import { loadBoardRoster, isSittingDirector } from "@/lib/board/vote-roster";
import type { PartnerApplicationData, DuplicateOrgMatch } from "@/lib/actions/applications";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";

/** Board Stuff. Overridable so a dry run can post somewhere harmless. */
function boardSpaceId(): number | null {
  return Number(process.env.CIRCLE_BOARD_SPACE_ID) || 1749439;
}

const BUTLER_EMAIL = "butler.ghost@campusstores.ca";

export interface BoardVoteRow {
  id: string;
  application_id: string;
  public_token: string;
  circle_post_id: number | null;
  circle_post_url: string | null;
  opened_at: string;
  closes_at: string;
  reminder_sent_at: string | null;
  board_size: number;
  threshold: number;
  status: VoteStatus;
  decided_at: string | null;
  executed_at: string | null;
}

// ─── Opening ──────────────────────────────────────────────────────────────────

/**
 * Opens a vote on a partner application and posts it to Board Stuff.
 *
 * Refuses when the roster disagrees with the bylaw board size — a wrong
 * denominator silently changes what a majority means, so it is better to stop
 * and alert than to hold a vote under a rule nobody chose.
 */
export async function openVoteForApplication(
  applicationId: string,
  options: { dryRun?: boolean } = {}
): Promise<{ ok: true; voteId: string; postUrl: string | null } | { ok: false; error: string }> {
  const db = createAdminClient();

  const { data: app } = await db
    .from("signup_applications")
    .select("id, status, application_type, application_data, paid_amount_cents, paid_for")
    .eq("id", applicationId)
    .maybeSingle();

  if (!app) return { ok: false, error: "Application not found" };
  if (app.application_type !== "partner") {
    return { ok: false, error: "Board votes cover Vendor Partner applications only" };
  }
  if (app.status !== "pending_review") {
    return { ok: false, error: `Application is ${app.status}, not pending_review` };
  }

  // The partial unique index enforces this too; checking first gives a usable message.
  const { data: existing } = await db
    .from("board_votes")
    .select("id")
    .eq("application_id", applicationId)
    .eq("status", "open")
    .maybeSingle();
  if (existing) return { ok: false, error: "A vote is already open on this application" };

  const roster = await loadBoardRoster();
  if (roster.sizeMismatch) return { ok: false, error: roster.sizeMismatch };

  const data = app.application_data as unknown as PartnerApplicationData;
  const openedAt = new Date();
  const closesAt = computeClosesAt(openedAt);
  const token = crypto.randomBytes(24).toString("base64url");

  const duplicates = await findDuplicatesForPost(db, data);

  const { data: vote, error: insertError } = await db
    .from("board_votes")
    .insert({
      application_id: applicationId,
      public_token: token,
      opened_at: openedAt.toISOString(),
      closes_at: closesAt.toISOString(),
      board_size: roster.boardSize,
      threshold: roster.threshold,
      status: "open",
    })
    .select("id")
    .single();

  if (insertError || !vote) {
    return { ok: false, error: `Failed to open vote: ${insertError?.message}` };
  }

  const post = buildVotePost({
    application: {
      id: applicationId,
      data,
      paidAmountCents: app.paid_amount_cents,
      paidFor: app.paid_for,
    },
    duplicates,
    vote: {
      urls: {
        yes: `${APP_URL}/board/vote/${token}?choice=yes`,
        no: `${APP_URL}/board/vote/${token}?choice=no`,
        abstain: `${APP_URL}/board/vote/${token}?choice=abstain`,
      },
      closesAtLabel: formatCloseLabel(closesAt),
      threshold: roster.threshold,
      boardSize: roster.boardSize,
    },
    adminUrl: `${APP_URL}/admin/applications`,
  });

  if (options.dryRun) return { ok: true, voteId: vote.id, postUrl: null };

  const circle = getCircleGhostClient();
  const spaceId = boardSpaceId();
  if (!circle || !getCircleConfig() || !spaceId) {
    // The vote exists and is votable; only the announcement failed.
    return { ok: true, voteId: vote.id, postUrl: null };
  }

  try {
    const created = await circle.createPost({
      space_id: spaceId,
      name: post.name,
      tiptap_body: post.tiptap_body,
      status: "published",
      user_email: BUTLER_EMAIL,
    });

    await db
      .from("board_votes")
      .update({ circle_post_id: created.id, circle_post_url: created.url })
      .eq("id", vote.id);

    return { ok: true, voteId: vote.id, postUrl: created.url ?? null };
  } catch (err) {
    console.error("[board/vote-service] Circle post failed", err);
    return { ok: true, voteId: vote.id, postUrl: null };
  }
}

/** Duplicate-org check, shaped for the post. Mirrors the admin review screen. */
async function findDuplicatesForPost(
  db: ReturnType<typeof createAdminClient>,
  data: PartnerApplicationData
): Promise<DuplicateOrgMatch[]> {
  const name = data.company_name?.trim();
  if (!name) return [];

  const { data: byName } = await db
    .from("organizations")
    .select("id, name, email, website, membership_status, type")
    .eq("is_test", false)
    .ilike("name", name);

  const matches = new Map<string, DuplicateOrgMatch>();
  for (const org of byName ?? []) {
    matches.set(org.id as string, {
      id: org.id as string,
      name: org.name as string,
      email: (org.email as string) ?? null,
      website: (org.website as string) ?? null,
      membershipStatus: (org.membership_status as string) ?? null,
      type: (org.type as string) ?? null,
      matchReasons: ["organization name"],
      hasOutstandingInvoice: false,
      hasPaidInvoice: false,
    });
  }

  if (data.contact_email?.trim()) {
    const { data: byEmail } = await db
      .from("organizations")
      .select("id, name, email, website, membership_status, type")
      .eq("is_test", false)
      .ilike("email", data.contact_email.trim());
    for (const org of byEmail ?? []) {
      const id = org.id as string;
      const hit = matches.get(id);
      if (hit) hit.matchReasons.push("contact email");
      else
        matches.set(id, {
          id,
          name: org.name as string,
          email: (org.email as string) ?? null,
          website: (org.website as string) ?? null,
          membershipStatus: (org.membership_status as string) ?? null,
          type: (org.type as string) ?? null,
          matchReasons: ["contact email"],
          hasOutstandingInvoice: false,
          hasPaidInvoice: false,
        });
    }
  }

  return Array.from(matches.values());
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export interface VoteState {
  vote: BoardVoteRow;
  companyName: string;
  tally: Tally;
  deadlinePassed: boolean;
  /** The signed-in director's current ballot, if any. */
  myChoice: VoteChoice | null;
}

export async function getVoteByToken(token: string, viewerProfileId?: string): Promise<VoteState | null> {
  const db = createAdminClient();

  const { data: vote } = await db
    .from("board_votes")
    .select("*")
    .eq("public_token", token)
    .maybeSingle();
  if (!vote) return null;

  const { data: app } = await db
    .from("signup_applications")
    .select("application_data")
    .eq("id", vote.application_id)
    .maybeSingle();

  const { data: ballots } = await db
    .from("board_vote_ballots")
    .select("director_profile_id, choice")
    .eq("vote_id", vote.id);

  const tally = tallyVote({
    ballots: (ballots ?? []).map((b) => ({
      directorProfileId: b.director_profile_id as string,
      choice: b.choice as VoteChoice,
    })),
    boardSize: vote.board_size,
    threshold: vote.threshold,
  });

  const data = (app?.application_data ?? {}) as unknown as PartnerApplicationData;

  return {
    vote: vote as unknown as BoardVoteRow,
    companyName: data.company_name?.trim() || "this applicant",
    tally,
    deadlinePassed: new Date(vote.closes_at) <= new Date(),
    myChoice:
      (ballots ?? []).find((b) => b.director_profile_id === viewerProfileId)?.choice as VoteChoice ??
      null,
  };
}

// ─── Casting ──────────────────────────────────────────────────────────────────

export type CastResult =
  | { ok: true; choice: VoteChoice; changed: boolean }
  | { ok: false; error: string };

/**
 * Records or changes a ballot.
 *
 * Recorded on a GET from Butler's post, which is safe here because it requires
 * an authenticated director session — a link unfurler or prefetcher has no
 * session and cannot cast anything. Changes are silent by design: `changed_at`
 * is stamped and Butler says nothing in the thread.
 */
export async function castBallot(
  token: string,
  directorProfileId: string,
  choice: VoteChoice
): Promise<CastResult> {
  const db = createAdminClient();

  const { data: vote } = await db
    .from("board_votes")
    .select("id, status, closes_at")
    .eq("public_token", token)
    .maybeSingle();

  if (!vote) return { ok: false, error: "That vote could not be found." };
  if (vote.status !== "open") return { ok: false, error: "This vote has already closed." };
  if (new Date(vote.closes_at) <= new Date()) {
    return { ok: false, error: "Voting has closed on this application." };
  }

  if (!(await isSittingDirector(directorProfileId))) {
    return { ok: false, error: "Only sitting board directors can vote." };
  }

  const { data: existing } = await db
    .from("board_vote_ballots")
    .select("id, choice")
    .eq("vote_id", vote.id)
    .eq("director_profile_id", directorProfileId)
    .maybeSingle();

  if (existing) {
    if (existing.choice === choice) return { ok: true, choice, changed: false };
    const { error } = await db
      .from("board_vote_ballots")
      .update({ choice, changed_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { ok: false, error: "Could not record your vote. Please try again." };
    return { ok: true, choice, changed: true };
  }

  const { error } = await db.from("board_vote_ballots").insert({
    vote_id: vote.id,
    director_profile_id: directorProfileId,
    choice,
    source: "circle_button",
  });
  if (error) return { ok: false, error: "Could not record your vote. Please try again." };
  return { ok: true, choice, changed: false };
}

// ─── Reminders and closing ────────────────────────────────────────────────────

/** Posts "closes tomorrow" as a comment on Butler's post. One API call, not nine DMs. */
export async function sendVoteReminder(voteId: string): Promise<boolean> {
  const db = createAdminClient();
  const { data: vote } = await db
    .from("board_votes")
    .select("id, circle_post_id, closes_at, reminder_sent_at, status")
    .eq("id", voteId)
    .maybeSingle();

  if (!vote || vote.status !== "open" || vote.reminder_sent_at || !vote.circle_post_id) return false;

  const state = await getVoteByToken(
    (await db.from("board_votes").select("public_token").eq("id", voteId).single()).data!
      .public_token as string
  );
  if (!state) return false;

  const circle = getCircleGhostClient();
  if (circle) {
    try {
      await circle.createComment({
        post_id: vote.circle_post_id,
        user_email: BUTLER_EMAIL,
        body:
          `<p>Voting closes <strong>${formatCloseLabel(new Date(vote.closes_at))}</strong>. ` +
          `Currently ${formatTally(state.tally)}.</p>`,
      });
    } catch (err) {
      console.error("[board/vote-service] reminder comment failed", err);
      return false;
    }
  }

  await db
    .from("board_votes")
    .update({ reminder_sent_at: new Date().toISOString() })
    .eq("id", voteId);
  return true;
}

/**
 * Closes a vote whose deadline has passed: tallies, sets the outcome, and
 * comments the result. Never executes the approval — a human does that.
 */
export async function closeVote(
  voteId: string
): Promise<{ status: VoteStatus; tally: Tally } | null> {
  const db = createAdminClient();

  const { data: vote } = await db
    .from("board_votes")
    .select("id, public_token, status, circle_post_id, board_size, threshold")
    .eq("id", voteId)
    .maybeSingle();
  if (!vote || vote.status !== "open") return null;

  const state = await getVoteByToken(vote.public_token as string);
  if (!state) return null;

  const status = resolveStatus(state.tally, true);
  if (status === "open") return null;

  await db
    .from("board_votes")
    .update({ status, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", voteId);

  const circle = getCircleGhostClient();
  if (circle && vote.circle_post_id) {
    try {
      await circle.createComment({
        post_id: vote.circle_post_id as number,
        user_email: BUTLER_EMAIL,
        body: `<p><strong>Voting closed.</strong> ${formatOutcome(state.tally, status)}</p>`,
      });
    } catch (err) {
      console.error("[board/vote-service] closing comment failed", err);
    }
  }

  await notifyStaffOfOutcome(state.companyName, status, state.tally, vote.public_token as string);

  return { status, tally: state.tally };
}

/**
 * Tells CSC staff a vote has closed and what to do about it.
 *
 * Staff are the `super_admin` accounts — they do not vote, but they are who
 * executes the approval. A carried vote is the only one with an action
 * attached; the others are FYI. This is a handful of DMs a month, not the
 * per-application blast that was deliberately left out of the opening post.
 */
async function notifyStaffOfOutcome(
  companyName: string,
  status: VoteStatus,
  tally: Tally,
  token: string
): Promise<void> {
  const db = createAdminClient();
  const circle = getCircleGhostClient();
  if (!circle) return;

  const { data: staff } = await db
    .from("profiles")
    .select("id")
    .eq("global_role", "super_admin");
  if (!staff?.length) return;

  const { data: contacts } = await db
    .from("contacts")
    .select("profile_id, email")
    .in(
      "profile_id",
      staff.map((s) => s.id as string)
    )
    .not("email", "is", null);

  const action =
    status === "carried"
      ? "Approve it in the admin applications screen — nothing is provisioned until you do."
      : status === "lapsed"
        ? "No decision was reached, so this carries to the next board meeting rather than being declined."
        : "No action needed unless you want to notify the applicant.";

  const voteUrl = `${APP_URL}/board/vote/${token}`;
  const adminUrl = `${APP_URL}/admin/applications`;

  const content = [
    {
      type: "paragraph",
      content: [
        { type: "text", text: `Board vote closed — ${companyName}`, marks: [{ type: "bold" }] },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: formatOutcome(tally, status) }] },
    { type: "paragraph", content: [{ type: "text", text: action }] },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: status === "carried" ? "Open the application" : "See the vote",
          marks: [
            {
              type: "link",
              attrs: { href: status === "carried" ? adminUrl : voteUrl, target: "_blank" },
            },
          ],
        },
      ],
    },
  ];

  const fallback = `Board vote closed — ${companyName}. ${formatOutcome(tally, status)} ${action}`;

  const seen = new Set<string>();
  for (const contact of contacts ?? []) {
    const email = (contact.email as string)?.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    try {
      await circle.sendDirectMessageRich(email, content, fallback);
    } catch (err) {
      console.error(`[board/vote-service] staff DM to ${email} failed`, err);
    }
  }
}

/** Votes whose deadline has passed but which are still marked open. */
export async function findVotesToClose(): Promise<BoardVoteRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_votes")
    .select("*")
    .eq("status", "open")
    .lte("closes_at", new Date().toISOString());
  return (data ?? []) as unknown as BoardVoteRow[];
}

/** Open votes due a reminder: past the reminder time, not yet reminded. */
export async function findVotesToRemind(): Promise<BoardVoteRow[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("board_votes")
    .select("*")
    .eq("status", "open")
    .is("reminder_sent_at", null)
    .gt("closes_at", new Date().toISOString());

  const now = new Date();
  return ((data ?? []) as unknown as BoardVoteRow[]).filter(
    (v) => computeReminderAt(new Date(v.opened_at), new Date(v.closes_at)) <= now
  );
}

/** Partner applications awaiting review with no vote yet. */
export async function findApplicationsNeedingVote(): Promise<string[]> {
  const db = createAdminClient();
  const { data: apps } = await db
    .from("signup_applications")
    .select("id")
    .eq("application_type", "partner")
    .eq("status", "pending_review");
  if (!apps?.length) return [];

  const { data: votes } = await db
    .from("board_votes")
    .select("application_id")
    .in(
      "application_id",
      apps.map((a) => a.id as string)
    );

  const covered = new Set((votes ?? []).map((v) => v.application_id as string));
  return apps.map((a) => a.id as string).filter((id) => !covered.has(id));
}

// ─── Admin + minutes surfaces ─────────────────────────────────────────────────

export interface BoardVoteSummary {
  voteId: string;
  applicationId: string;
  status: VoteStatus;
  closesAt: string;
  decidedAt: string | null;
  executedAt: string | null;
  circlePostUrl: string | null;
  tally: Tally;
}

/**
 * Vote standing for a set of applications, keyed by application id.
 *
 * One query for the votes and one for all their ballots, rather than a tally
 * query per application — the admin screen renders every application at once.
 */
export async function getVoteSummaries(
  applicationIds: string[]
): Promise<Map<string, BoardVoteSummary>> {
  const out = new Map<string, BoardVoteSummary>();
  if (!applicationIds.length) return out;

  const db = createAdminClient();

  const { data: votes } = await db
    .from("board_votes")
    .select("id, application_id, status, closes_at, decided_at, executed_at, circle_post_url, board_size, threshold")
    .in("application_id", applicationIds)
    .order("opened_at", { ascending: false });

  if (!votes?.length) return out;

  const { data: ballots } = await db
    .from("board_vote_ballots")
    .select("vote_id, director_profile_id, choice")
    .in(
      "vote_id",
      votes.map((v) => v.id as string)
    );

  const byVote = new Map<string, Array<{ directorProfileId: string; choice: VoteChoice }>>();
  for (const b of ballots ?? []) {
    const list = byVote.get(b.vote_id as string) ?? [];
    list.push({
      directorProfileId: b.director_profile_id as string,
      choice: b.choice as VoteChoice,
    });
    byVote.set(b.vote_id as string, list);
  }

  for (const vote of votes) {
    const applicationId = vote.application_id as string;
    // Ordered newest-first, so the first one wins and older votes are ignored.
    if (out.has(applicationId)) continue;

    out.set(applicationId, {
      voteId: vote.id as string,
      applicationId,
      status: vote.status as VoteStatus,
      closesAt: vote.closes_at as string,
      decidedAt: (vote.decided_at as string) ?? null,
      executedAt: (vote.executed_at as string) ?? null,
      circlePostUrl: (vote.circle_post_url as string) ?? null,
      tally: tallyVote({
        ballots: byVote.get(vote.id as string) ?? [],
        boardSize: vote.board_size as number,
        threshold: vote.threshold as number,
      }),
    });
  }

  return out;
}

/** Marks a carried vote as executed. Call after approveApplication() succeeds. */
export async function markVoteExecuted(applicationId: string, actorProfileId: string): Promise<void> {
  const db = createAdminClient();
  await db
    .from("board_votes")
    .update({ executed_at: new Date().toISOString(), executed_by: actorProfileId })
    .eq("application_id", applicationId)
    .eq("status", "carried")
    .is("executed_at", null);
}

export interface DecisionRecord {
  companyName: string;
  status: VoteStatus;
  decidedAt: string;
  summary: string;
}

/**
 * Decisions taken between two board meetings, for the minutes.
 *
 * Votes held between meetings are still governance actions and have to appear
 * in the record. Feed this into the meeting write-up as "Decisions since the
 * last meeting" rather than keeping a second, parallel record.
 */
export async function getDecisionsBetween(
  fromIso: string,
  toIso: string
): Promise<DecisionRecord[]> {
  const db = createAdminClient();

  const { data: votes } = await db
    .from("board_votes")
    .select("id, application_id, status, decided_at, board_size, threshold")
    .not("decided_at", "is", null)
    .gte("decided_at", fromIso)
    .lte("decided_at", toIso)
    .order("decided_at", { ascending: true });

  if (!votes?.length) return [];

  const summaries = await getVoteSummaries(votes.map((v) => v.application_id as string));

  const { data: apps } = await db
    .from("signup_applications")
    .select("id, application_data")
    .in(
      "id",
      votes.map((v) => v.application_id as string)
    );

  const nameById = new Map<string, string>();
  for (const app of apps ?? []) {
    const data = app.application_data as unknown as PartnerApplicationData;
    nameById.set(app.id as string, data?.company_name?.trim() || "Unnamed applicant");
  }

  return votes.map((vote) => {
    const applicationId = vote.application_id as string;
    const summary = summaries.get(applicationId);
    const status = vote.status as VoteStatus;
    return {
      companyName: nameById.get(applicationId) ?? "Unnamed applicant",
      status,
      decidedAt: vote.decided_at as string,
      summary: summary
        ? formatOutcome(summary.tally, status)
        : `Recorded as ${status}.`,
    };
  });
}
