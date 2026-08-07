import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAudience } from "@/lib/comms/audience";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import type { AudienceDefinition } from "@/lib/comms/types";
import { CHECK_TYPES, type CheckType } from "./checklist-check-types";
import { computeOrgLegalCompleteness } from "./legal-acceptance";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The fixed, developer-maintained vocabulary of "is this done" checks. Every
 * task on every checklist, for every conference, must pick one of these —
 * each reads something the site already captures. There is deliberately no
 * way to define a check outside this registry; if a new kind of task is
 * needed, the underlying capture has to exist first, then a check type gets
 * added here.
 */
const CHECKS: Record<
  CheckType,
  (db: AdminClient, organizationId: string, conferenceId: string, entityId: string | null) => Promise<boolean>
> = {
  async seat_assigned(db, organizationId, conferenceId, entityId) {
    if (!entityId) return true; // malformed task — never blocks, but shouldn't happen (form requires it)
    const { data } = await db
      .from("entity_balance_seats")
      .select("holder_person_id")
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId);
    if (!data || data.length === 0) return true; // org holds none of this entity — nothing to assign
    const assignedCount = data.filter((s) => s.holder_person_id !== null).length;

    // "All purchased seats assigned" is only the right definition of done
    // when the org actually intends to use every seat it bought — someone
    // who buys 4 exhibitor registrations but is only sending 1 person isn't
    // "behind," they're done. If they've told us how many they actually
    // plan to use (conference_entity_usage_intents), that number is what
    // "complete" means instead — capped at the real seat count so a stale
    // over-declaration can never make this impossible to satisfy.
    const { data: intent } = await db
      .from("conference_entity_usage_intents")
      .select("intended_quantity, declared_against_total")
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId)
      .eq("conference_id", conferenceId)
      .maybeSingle();

    // A later purchase can raise the real seat count past what the org saw
    // when they declared — e.g. they said "using 1 of 4," then bought 2
    // more, now holding 6. The old "1" no longer reflects a real decision
    // about those extra seats, so it's treated as stale (not merely
    // clamped) and this falls through to strict mode until they re-declare.
    if (intent && data.length <= intent.declared_against_total) {
      return assignedCount >= Math.min(intent.intended_quantity, data.length);
    }

    // No declared intent, or the declaration is stale — fall back to the
    // original strict definition.
    return data.every((s) => s.holder_person_id !== null);
  },

  async entity_purchased(db, organizationId, _conferenceId, entityId) {
    if (!entityId) return true;
    const { count } = await db
      .from("entity_balances")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("entity_id", entityId);
    return (count ?? 0) > 0;
  },

  async travel_info_submitted(db, organizationId, conferenceId) {
    const { data } = await db
      .from("conference_people")
      .select("travel_mode")
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId);
    if (!data || data.length === 0) return false; // nobody registered yet — not complete
    return data.every((p) => p.travel_mode !== null);
  },

  async payment_complete(db, organizationId, conferenceId) {
    const { count } = await db
      .from("conference_orders")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("conference_id", conferenceId)
      .not("paid_at", "is", null);
    return (count ?? 0) > 0;
  },

  async legal_document_accepted(db, organizationId, conferenceId) {
    return computeOrgLegalCompleteness(db, conferenceId, organizationId);
  },
};

/**
 * The CTA for a task is derived from its check type, never admin-entered —
 * so it can never point at a broken or wrong URL. Real routes confirmed by
 * codebase research; see plan doc for the full route survey.
 */
function getTaskCta(
  checkType: CheckType,
  ctx: { orgSlug: string; conferenceId: string; conferenceYear: number; conferenceEdition: string; organizationId: string }
): { label: string; url: string } {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
  switch (checkType) {
    case "seat_assigned":
      return { label: "Assign your seats", url: `${appUrl}/org/${ctx.orgSlug}` };
    case "entity_purchased":
      return {
        label: "Browse & purchase",
        url: `${appUrl}/conference/${ctx.conferenceYear}/${ctx.conferenceEdition}/offers?org=${ctx.organizationId}`,
      };
    case "travel_info_submitted":
      return { label: "View readiness & travel status", url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}` };
    case "payment_complete":
      return { label: "View your account", url: `${appUrl}/org/${ctx.orgSlug}` };
    case "legal_document_accepted":
      return { label: "View readiness & travel status", url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}` };
  }
}

function renderOpenItemsHtml(
  items: { name: string; description: string; cta: { label: string; url: string } }[]
): string {
  return items
    .map(
      (item) => `<div style="margin:12px 0;padding:12px;border:1px solid #e5e7eb;border-radius:8px">
  <p style="margin:0 0 4px;font-weight:600;color:#111827">${item.name}</p>
  <p style="margin:0 0 8px;color:#6b7280;font-size:14px">${item.description}</p>
  <a href="${item.cta.url}" style="color:#163D6D;font-weight:600;text-decoration:none;font-size:14px">${item.cta.label} →</a>
</div>`
    )
    .join("\n");
}

interface DueOrg {
  organizationId: string;
  checkpointId: string;
}

/**
 * For one checklist, find orgs in scope with a checkpoint due today that
 * hasn't already been logged for them. If multiple checkpoints are
 * simultaneously overdue (e.g. cron missed a few days), only the most
 * recent unlogged one is returned per org — never a backlog burst.
 */
async function findDueOrgs(
  db: AdminClient,
  checklist: { id: string; conference_id: string; scope_entity_id: string | null; deadline_at: string }
): Promise<DueOrg[]> {
  const { data: checkpoints } = await db
    .from("conference_checklist_checkpoints")
    .select("id, days_before_deadline")
    .eq("checklist_id", checklist.id)
    .order("days_before_deadline", { ascending: true }); // most-overdue-first
  if (!checkpoints || checkpoints.length === 0) return [];

  const deadline = new Date(checklist.deadline_at).getTime();
  const now = Date.now();
  const dueCheckpoints = checkpoints.filter(
    (cp) => deadline - cp.days_before_deadline * 24 * 60 * 60 * 1000 <= now
  );
  if (dueCheckpoints.length === 0) return [];

  // Scope: orgs holding scope_entity_id, or every org with any purchase
  // for this conference if unscoped.
  let orgQuery = db
    .from("entity_balances")
    .select("organization_id")
    .eq("conference_id", checklist.conference_id)
    .not("organization_id", "is", null);
  if (checklist.scope_entity_id) {
    orgQuery = orgQuery.eq("entity_id", checklist.scope_entity_id);
  }
  const { data: orgRows } = await orgQuery;
  const orgIds = [...new Set((orgRows ?? []).map((r) => r.organization_id).filter((id): id is string => !!id))];
  if (orgIds.length === 0) return [];

  const { data: alreadyLogged } = await db
    .from("conference_checklist_reminder_log")
    .select("checkpoint_id, organization_id")
    .in(
      "checkpoint_id",
      dueCheckpoints.map((cp) => cp.id)
    );
  const loggedSet = new Set((alreadyLogged ?? []).map((r) => `${r.checkpoint_id}:${r.organization_id}`));

  const due: DueOrg[] = [];
  for (const orgId of orgIds) {
    // dueCheckpoints is sorted most-overdue-first; take the first unlogged one.
    const checkpoint = dueCheckpoints.find((cp) => !loggedSet.has(`${cp.id}:${orgId}`));
    if (checkpoint) due.push({ organizationId: orgId, checkpointId: checkpoint.id });
  }
  return due;
}

export interface ChecklistRunResult {
  checklistsProcessed: number;
  orgsReminded: number;
  errors: string[];
}

/**
 * Evaluate every active checklist's due checkpoints and send digest
 * reminders to orgs with open tasks. Called identically from the admin
 * "Send Reminders Now" button and the daily cron route — same code path,
 * so what's tested manually is exactly what runs unattended.
 */
export async function runChecklistReminders(): Promise<ChecklistRunResult> {
  const db = createAdminClient();
  const result: ChecklistRunResult = { checklistsProcessed: 0, orgsReminded: 0, errors: [] };

  const { data: checklists, error: checklistsError } = await db
    .from("conference_checklists")
    .select("id, conference_id, name, deadline_at, scope_entity_id, conference:conference_instances(year, edition_code)")
    .eq("active", true);
  if (checklistsError) {
    result.errors.push(`Failed to load checklists: ${checklistsError.message}`);
    return result;
  }

  for (const checklist of checklists ?? []) {
    try {
      const conference = Array.isArray(checklist.conference) ? checklist.conference[0] : checklist.conference;
      if (!conference) continue;

      const dueOrgs = await findDueOrgs(db, checklist);
      if (dueOrgs.length === 0) {
        result.checklistsProcessed++;
        continue;
      }

      const { data: tasks } = await db
        .from("conference_checklist_tasks")
        .select("id, name, description, check_type, check_entity_id")
        .eq("checklist_id", checklist.id)
        .eq("active", true)
        .order("sort_order", { ascending: true });

      const recipients: { email: string; name: string | null; variableOverrides: Record<string, string> }[] = [];
      const sentLog: { checklist_id: string; checkpoint_id: string; organization_id: string }[] = [];

      for (const { organizationId, checkpointId } of dueOrgs) {
        const { data: org } = await db.from("organizations").select("name, slug").eq("id", organizationId).single();
        if (!org) continue;

        const openItems: { name: string; description: string; cta: { label: string; url: string } }[] = [];
        for (const task of tasks ?? []) {
          const checkType = task.check_type as CheckType;
          const checkFn = CHECKS[checkType];
          const complete = await checkFn(db, organizationId, checklist.conference_id, task.check_entity_id);
          if (!complete) {
            openItems.push({
              name: task.name,
              description: task.description,
              cta: getTaskCta(checkType, {
                orgSlug: org.slug,
                conferenceId: checklist.conference_id,
                conferenceYear: conference.year,
                conferenceEdition: conference.edition_code,
                organizationId,
              }),
            });
          }
        }

        if (openItems.length === 0) continue; // fully caught up — silently skip, nothing logged

        const admins = await resolveAudience({
          type: "org_admins",
          filters: { org_ids: [organizationId] },
        } satisfies AudienceDefinition);
        if (admins.length === 0) continue;

        const openItemsHtml = renderOpenItemsHtml(openItems);
        for (const admin of admins) {
          recipients.push({
            email: admin.email,
            name: admin.name,
            variableOverrides: {
              contact_name: admin.name ?? admin.email,
              org_name: org.name,
              checklist_name: checklist.name,
              open_items_html: openItemsHtml,
              conference_year: String(conference.year),
            },
          });
        }
        sentLog.push({ checklist_id: checklist.id, checkpoint_id: checkpointId, organization_id: organizationId });
      }

      if (recipients.length > 0) {
        const campaignResult = await createCampaign({
          name: `Checklist Reminder: ${checklist.name}`,
          templateKey: "conference_checklist_reminder",
          audience: {
            type: "custom_recipient_list",
            filters: { conference_instance_id: checklist.conference_id, recipients },
          },
          triggerSource: "conference",
          automationMode: "auto_send",
        });

        if (campaignResult.success && campaignResult.campaignId) {
          await executeCampaignSend(campaignResult.campaignId);
          if (sentLog.length > 0) {
            await db.from("conference_checklist_reminder_log").insert(sentLog);
          }
          result.orgsReminded += sentLog.length;
        } else {
          result.errors.push(`Checklist ${checklist.name}: campaign creation failed — ${campaignResult.error}`);
        }
      }

      result.checklistsProcessed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      result.errors.push(`Checklist ${checklist.id}: ${msg}`);
      console.error(`[checklist-engine] Failed for checklist ${checklist.id}:`, msg);
    }
  }

  return result;
}

/**
 * Run a single checklist task's completion check for one org — the same
 * CHECKS registry the reminder digest uses internally, exposed so other
 * callers (the comms condition system's "Checklist Task" subject) can ask
 * "is this org done with this task yet" without duplicating the check
 * logic or its fixed vocabulary.
 */
export async function evaluateChecklistTaskCheck(
  db: AdminClient,
  checkType: CheckType,
  organizationId: string,
  conferenceId: string,
  entityId: string | null
): Promise<boolean> {
  return CHECKS[checkType](db, organizationId, conferenceId, entityId);
}

export { CHECK_TYPES, type CheckType };
