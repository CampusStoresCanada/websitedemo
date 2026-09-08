import { createAdminClient } from "@/lib/supabase/admin";
import type { BoardRenewalReport } from "./board-report";

export interface RenewalSnapshot {
  meetingId: string;
  renewalYear: number;
  report: BoardRenewalReport;
  pulledAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

/** What changed between this meeting's figures and the previous meeting's. */
export interface RenewalDelta {
  sinceMeetingDate: string;
  sincePulledAt: string;
  renewedDelta: number;
  collectedCentsDelta: number;
  outstandingCountDelta: number;
  contactedDelta: number;
}

function toSnapshot(row: {
  meeting_id: string;
  renewal_year: number;
  data_json: unknown;
  pulled_at: string;
  approved_at: string | null;
  approved_by: string | null;
}): RenewalSnapshot {
  return {
    meetingId: row.meeting_id,
    renewalYear: row.renewal_year,
    report: row.data_json as BoardRenewalReport,
    pulledAt: row.pulled_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  };
}

export async function getRenewalSnapshot(meetingId: string): Promise<RenewalSnapshot | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("renewal_snapshots")
    .select("meeting_id, renewal_year, data_json, pulled_at, approved_at, approved_by")
    .eq("meeting_id", meetingId)
    .maybeSingle();
  return data ? toSnapshot(data) : null;
}

/**
 * Freeze the current figures against a meeting.
 *
 * Refuses once approved. After a board has accepted a number as the figure of
 * record, silently replacing it would make the minutes unverifiable — which is
 * the entire reason this table exists. Re-pulling before approval is fine and
 * replaces the draft.
 */
export async function saveRenewalSnapshot(params: {
  meetingId: string;
  report: BoardRenewalReport;
  pulledBy: string | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const db = createAdminClient();

  const { data: existing } = await db
    .from("renewal_snapshots")
    .select("approved_at")
    .eq("meeting_id", params.meetingId)
    .maybeSingle();

  if (existing?.approved_at) {
    return {
      success: false,
      error: "This snapshot has been approved and cannot be replaced.",
    };
  }

  const { error } = await db.from("renewal_snapshots").upsert(
    {
      meeting_id: params.meetingId,
      renewal_year: params.report.renewalYear,
      data_json: params.report as unknown as never,
      pulled_at: new Date().toISOString(),
      pulled_by: params.pulledBy,
    },
    { onConflict: "meeting_id" }
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function approveRenewalSnapshot(params: {
  meetingId: string;
  approvedBy: string | null;
}): Promise<{ success: true } | { success: false; error: string }> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("renewal_snapshots")
    .update({ approved_by: params.approvedBy, approved_at: new Date().toISOString() })
    .eq("meeting_id", params.meetingId)
    .is("approved_at", null)
    .select("meeting_id");

  if (error) return { success: false, error: error.message };
  // Zero rows means it was already approved, or there is nothing to approve.
  if (!data || data.length === 0) {
    return { success: false, error: "Nothing to approve — pull a snapshot first." };
  }
  return { success: true };
}

/**
 * The delta a board actually asks for: what moved since we last met.
 *
 * Compares against the most recent snapshot from an EARLIER meeting in the same
 * renewal year. Returns null when there is no prior snapshot — the first
 * meeting of a cycle has nothing to compare against, and inventing a zero
 * baseline would read as "no progress" rather than "no comparison".
 */
export async function getRenewalDelta(params: {
  meetingId: string;
  meetingDate: string;
  renewalYear: number;
  current: BoardRenewalReport;
}): Promise<RenewalDelta | null> {
  const db = createAdminClient();

  const { data } = await db
    .from("renewal_snapshots")
    .select("data_json, pulled_at, board_meetings!inner(meeting_date)")
    .eq("renewal_year", params.renewalYear)
    .neq("meeting_id", params.meetingId)
    .lt("board_meetings.meeting_date", params.meetingDate)
    .order("pulled_at", { ascending: false })
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  const prior = row.data_json as unknown as BoardRenewalReport;
  const meetingDate = (row.board_meetings as unknown as { meeting_date: string }).meeting_date;

  return {
    sinceMeetingDate: meetingDate,
    sincePulledAt: row.pulled_at,
    renewedDelta: params.current.totals.renewedCount - prior.totals.renewedCount,
    collectedCentsDelta: params.current.totals.collectedCents - prior.totals.collectedCents,
    outstandingCountDelta:
      params.current.totals.outstandingCount - prior.totals.outstandingCount,
    // Older snapshots predate coverage tracking, so treat a missing figure as
    // zero rather than NaN — the delta is then "everything since", which is true.
    contactedDelta:
      (params.current.totals.contactedCount ?? 0) - (prior.totals.contactedCount ?? 0),
  };
}
