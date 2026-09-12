import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveConferenceBoothHolders } from "@/lib/conference/exhibitor-status";

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

  const [{ data: assignments }, { data: charged }, boothHolders] = await Promise.all([
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
    getActiveConferenceBoothHolders(),
  ]);

  // Two kinds of work now arrive through the same assignment table, and they
  // are counted apart because they are different sentences to say on the phone.
  //
  // An org that has already paid is not a RENEWAL chase — counting it there
  // would send someone after a member who renewed last week. But it can still
  // be a BOOTH ask, and before this it fell through the gap entirely: the board
  // assigned it, nothing was created, and the assignment looked handed out.
  const renewed = new Set((charged ?? []).map((r) => r.organization_id));
  const holders = boothHolders ? new Set(boothHolders.orgIds) : null;
  const renewalByAssignee = new Map<string, number>();
  const boothByAssignee = new Map<string, number>();
  for (const a of assignments ?? []) {
    if (!a.assigned_to) continue;
    if (!renewed.has(a.organization_id)) {
      renewalByAssignee.set(a.assigned_to, (renewalByAssignee.get(a.assigned_to) ?? 0) + 1);
    } else if (holders && !holders.has(a.organization_id)) {
      boothByAssignee.set(a.assigned_to, (boothByAssignee.get(a.assigned_to) ?? 0) + 1);
    }
  }
  const assignees = new Set([...renewalByAssignee.keys(), ...boothByAssignee.keys()]);

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

  const cycleLabel = `${params.renewalYear - 1}-${String(params.renewalYear).slice(2)}`;

  for (const assignee of assignees) {
    const renewalCount = renewalByAssignee.get(assignee) ?? 0;
    const boothCount = boothByAssignee.get(assignee) ?? 0;
    const total = renewalCount + boothCount;

    // The renewal-only wording is left exactly as it was, so a re-run against a
    // meeting that has no booth asks rewrites nothing and no director sees
    // their open item churn for no reason.
    const title =
      boothCount === 0
        ? `Contact your ${renewalCount} assigned ${renewalCount === 1 ? "store" : "stores"} about renewal`
        : renewalCount === 0
          ? `Ask your ${boothCount} assigned ${boothCount === 1 ? "partner" : "partners"} about a booth`
          : `Contact your ${total} assigned organizations`;

    const parts: string[] = [];
    if (renewalCount > 0) {
      parts.push(
        `${renewalCount} ${renewalCount === 1 ? "organization has" : "organizations have"} not renewed for ${cycleLabel} yet.`
      );
    }
    if (boothCount > 0) {
      parts.push(
        `${boothCount} ${boothCount === 1 ? "partner has" : "partners have"} renewed but ${boothCount === 1 ? "has" : "have"} not booked a booth for the conference now on sale.`
      );
    }
    const description =
      `${parts.join(" ")} ` +
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
    if (assignees.has(assignee)) continue;
    if (item.status === "complete" || item.status === "dropped") continue;
    await db
      .from("board_action_items")
      .update({
        status: "dropped",
        dropped_at: new Date().toISOString(),
        dropped_reason: "No outstanding renewals or booth asks remain assigned to this person.",
      })
      .eq("id", item.id);
    result.closed++;
  }

  return result;
}
