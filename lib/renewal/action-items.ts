import { createAdminClient } from "@/lib/supabase/admin";

export interface RenewalActionItemSync {
  created: number;
  updated: number;
  closed: number;
}

/**
 * One board action item per assignee per meeting — never one per organization.
 *
 * There are 67 outstanding organizations and about 20 open board action items
 * in total. An item per org would bury every other obligation the board has and
 * turn the checklist into a renewal tool that happens to also hold governance.
 * An item per person is six or seven rows, and it inherits everything
 * board_action_items already does: the reminder cron, the emailed
 * complete_token (whose GET/POST split defeats Safe Links prefetch), ICS
 * export, escalation, and the "mine" filter directors already use.
 *
 * The obligation is the prompt; the call list is where the work happens; the
 * contact log is what survives the cycle. Those are three different records and
 * this only owns the first.
 *
 * Re-runnable. Items are keyed by (meeting_id, source='renewal', assignee), so
 * a second run after more assignments updates the count rather than adding a
 * second item. An assignee whose orgs have all gone is closed out, not left
 * asserting work that no longer exists.
 */
export async function syncRenewalActionItems(params: {
  meetingId: string;
  renewalYear: number;
  /** Where the assignee should go to do the work. */
  callListPath?: string;
}): Promise<RenewalActionItemSync> {
  const db = createAdminClient();
  const callListPath = params.callListPath ?? "/admin/renewals";

  const [{ data: assignments }, { data: charged }] = await Promise.all([
    db
      .from("renewal_assignments")
      .select("organization_id, assigned_to")
      .eq("renewal_year", params.renewalYear)
      .not("assigned_to", "is", null),
    db
      .from("renewal_events")
      .select("organization_id")
      .eq("event_type", "charge_succeeded")
      .eq("renewal_year", params.renewalYear),
  ]);

  // An org that has already paid is not work. Counting it would send someone
  // to chase a member who renewed last week.
  const renewed = new Set((charged ?? []).map((r) => r.organization_id));
  const countByAssignee = new Map<string, number>();
  for (const a of assignments ?? []) {
    if (!a.assigned_to || renewed.has(a.organization_id)) continue;
    countByAssignee.set(a.assigned_to, (countByAssignee.get(a.assigned_to) ?? 0) + 1);
  }

  const { data: existing } = await db
    .from("board_action_items")
    .select("id, assignees, status")
    .eq("meeting_id", params.meetingId)
    .eq("source", "renewal");

  const byAssignee = new Map<string, { id: string; status: string }>();
  for (const item of existing ?? []) {
    const who = ((item.assignees ?? []) as string[])[0];
    if (who) byAssignee.set(who, { id: item.id, status: item.status });
  }

  const result: RenewalActionItemSync = { created: 0, updated: 0, closed: 0 };

  for (const [assignee, count] of countByAssignee) {
    const title = `Contact your ${count} assigned ${count === 1 ? "store" : "stores"} about renewal`;
    const description =
      `${count} ${count === 1 ? "organization has" : "organizations have"} not renewed for ` +
      `${params.renewalYear - 1}-${String(params.renewalYear).slice(2)} yet. ` +
      `Your list, with contact details and what was said last time: ${callListPath}`;

    const found = byAssignee.get(assignee);
    if (found) {
      // Don't reopen something a director has already marked done — that is
      // their statement about their own work, not ours to overwrite.
      if (found.status === "complete" || found.status === "dropped") continue;
      await db
        .from("board_action_items")
        .update({ title, description })
        .eq("id", found.id);
      result.updated++;
    } else {
      await db.from("board_action_items").insert({
        meeting_id: params.meetingId,
        title,
        description,
        assignees: [assignee],
        source: "renewal",
        status: "open",
        priority: "high",
      });
      result.created++;
    }
  }

  // Someone who no longer holds any outstanding org — reassigned, or their
  // stores all paid — should not keep an open item telling them otherwise.
  for (const [assignee, item] of byAssignee) {
    if (countByAssignee.has(assignee)) continue;
    if (item.status === "complete" || item.status === "dropped") continue;
    await db
      .from("board_action_items")
      .update({
        status: "dropped",
        dropped_at: new Date().toISOString(),
        dropped_reason: "No outstanding renewals remain assigned to this person.",
      })
      .eq("id", item.id);
    result.closed++;
  }

  return result;
}
