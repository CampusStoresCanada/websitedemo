import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAudience } from "@/lib/comms/audience";
import { createCampaign, executeCampaignSend } from "@/lib/comms/send";
import type { AudienceDefinition } from "@/lib/comms/types";
import { CHECK_TYPES, type CheckType } from "./checklist-check-types";
import { CHECKS, evaluateChecklistTaskCheck } from "./checklist-checks";
import { formatDayMonth } from "@/lib/time/supabase-timestamp";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The fixed, developer-maintained vocabulary of "is this done" checks. Every
 * task on every checklist, for every conference, must pick one of these —
 * each reads something the site already captures. There is deliberately no
 * way to define a check outside this registry; if a new kind of task is
 * needed, the underlying capture has to exist first, then a check type gets
 * added here.
 */
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
      // The bare org page has no seat UI on it; the conference page now does.
      return {
        label: "Choose who's going",
        url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}#whos-going`,
      };
    case "entity_purchased":
      return {
        label: "Browse & purchase",
        url: `${appUrl}/conference/${ctx.conferenceYear}/${ctx.conferenceEdition}/offers?org=${ctx.organizationId}`,
      };
    case "travel_info_submitted":
      return { label: "View readiness & travel status", url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}` };
    case "payment_complete":
      // The bare org page shows nothing about conference money.
      return {
        label: "See what's owed",
        url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}#payment`,
      };
    case "legal_document_accepted":
      // Was "View readiness & travel status" pointing at this same page, which
      // then had no acceptance on it — a CTA that led nowhere twice over.
      return {
        label: "Read and accept",
        url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}#agreements`,
      };
    case "directory_profile_complete":
      // Straight to the org's own page, where every field this checks is edited.
      return { label: "Update your listing", url: `${appUrl}/org/${ctx.orgSlug}` };
    case "directory_profile_enriched":
      return { label: "Add your product details", url: `${appUrl}/org/${ctx.orgSlug}` };
    case "self_reported":
      // The org's conference page is where the tick-off list lives.
      return { label: "Mark it done", url: `${appUrl}/org/${ctx.orgSlug}/conference/${ctx.conferenceId}` };

  }
}

/**
 * The framing sentence and the consent ask, both per checklist.
 *
 * The body used to hardcode "still has a few things to finish for the 2027 CSC
 * Conference". That is true for Booth Readiness and WRONG for Directory
 * Listing, which since 2026-08-24 also reaches 52 member stores — they are in
 * the book because they are in the network, not because they are exhibiting.
 *
 * A publication-scoped checklist is about the printed book, so it says so, and
 * it carries the consent ask: the listing prints real contact details for real
 * people, and paper cannot be corrected afterwards.
 *
 * ⚠️ Consent to be printed is **per person** and the admin has NO role in it —
 * not even a fail-safe. Two earlier versions of this copy got it wrong: the
 * first told the admin to remove anyone who did not want to appear, the second
 * still presented consent as part of what they were approving. Both made one
 * person the gatekeeper for everyone else's privacy, and a fail-safe that lets
 * an admin stand in for silence is just opt-OUT with a different label.
 *
 * What is left here is a single informational line so the admin is not
 * surprised when their staff get asked. It states plainly that there is nothing
 * for them to do. The ask itself goes to each person.
 */
function renderFraming(checklist: {
  publication_id?: string | null;
  deadline_at: string;
  publicationTitle?: string | null;
}, conferenceYear: number): { intro_line: string; consent_note: string } {
  if (!checklist.publication_id) {
    return {
      intro_line:
        `still has a few things to finish for the <strong>${conferenceYear} CSC Conference</strong>:`,
      consent_note: "",
    };
  }

  // ⚠️ Hand-rolled parsing here shipped "goes to press on NaN undefined" to a
  // real inbox: the guard checked only for a trailing "Z", so a timestamp that
  // already carried "+00" got a Z appended and became invalid. Formatting is in
  // Eastern, because a 23:59 deadline formatted in UTC lands on the next day.
  const deadline = formatDayMonth(checklist.deadline_at) ?? "the deadline";
  const title = checklist.publicationTitle?.trim() || `${conferenceYear} Campus Stores Canada Directory`;

  return {
    intro_line:
      `has an entry in the <strong>${title}</strong> — the printed directory that ships to ` +
      `every member store and goes out at the conference. It goes to press on ` +
      `<strong>${deadline}</strong>, and a few things still need you:`,
    // Informational, NOT a task. The admin is told their staff are being asked
    // so nobody is blindsided when the ask lands — and told explicitly that it
    // is not theirs to action, because anything they could "action" here would
    // be them consenting on someone else's behalf.
    consent_note: `<p style="margin:18px 0 0;font-size:14px;color:#6b7280;line-height:1.55">
  Separately, everyone from your organisation listed in the book is being asked, for
  themselves, whether they want their name and contact details printed. Nobody appears
  without their own yes, and there is nothing for you to do about that here.
</p>`,
  };
}

/** Org names carry ampersands — "Cutter & Buck" would break the markup. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
/**
 * Which organisations does this checklist speak to?
 *
 * Two scopes, because two different questions:
 *
 *  - **Purchasers** (default) — orgs with an `entity_balances` row for the
 *    conference. Right for "you bought a booth, now assign staff and pay".
 *  - **Publication** — every org listed in a saved publication. Right for
 *    "your entry is going to print, check it". Measured 2026-08-24: purchaser
 *    scoping reached 30 of the 123 organisations in the network directory —
 *    NONE of the 52 member stores — so 93 orgs printed data that nothing ever
 *    asked them to confirm.
 *
 * A directory is a network artifact even when it ships inside a conference box.
 * Scoping the loop to buyers meant the loop could never maintain the book.
 */
async function resolveScopedOrgs(
  db: AdminClient,
  checklist: { id: string; conference_id: string; scope_entity_id: string | null; publication_id?: string | null }
): Promise<string[]> {
  if (checklist.publication_id) {
    const { loadPublication } = await import("@/lib/publication/store");
    const { loadEntriesForPublication } = await import("@/lib/publication/composition-loader");
    const { composePublication } = await import("@/lib/publication/composition");

    const saved = await loadPublication(checklist.publication_id);
    // A checklist pointing at a deleted or unparseable publication must reach
    // NOBODY rather than silently falling back to purchasers — that would mail
    // the wrong population about the wrong thing.
    if (!saved) return [];

    const bySource = await loadEntriesForPublication(saved.publication);
    const doc = composePublication(saved.publication, bySource);
    // doc.entries is already deduped across sections, so an exhibiting partner
    // is asked once, not once per section they appear in.
    return doc.entries.map((e) => e.orgId);
  }

  let orgQuery = db
    .from("entity_balances")
    .select("organization_id")
    .eq("conference_id", checklist.conference_id)
    .not("organization_id", "is", null);
  if (checklist.scope_entity_id) {
    orgQuery = orgQuery.eq("entity_id", checklist.scope_entity_id);
  }
  const { data: orgRows } = await orgQuery;
  return [...new Set((orgRows ?? []).map((r) => r.organization_id).filter((id): id is string => !!id))];
}

export interface ChecklistDigest {
  orgName: string;
  openItems: { name: string; description: string; cta: { label: string; url: string } }[];
  variables: Record<string, string>;
}

/**
 * The digest for ONE organisation — the open items and the variables the
 * template needs.
 *
 * Extracted so the "send a test to myself" path runs the SAME code as the real
 * send. A test that builds its own approximation of the email tells you nothing
 * about the email that will actually go out.
 *
 * Returns null when the org has nothing open: that is the same silence the real
 * run uses, and a test send should reproduce it rather than inventing content.
 */
export async function buildChecklistDigest(
  checklist: { id: string; name: string; conference_id: string; deadline_at: string; publication_id?: string | null; publicationTitle?: string | null },
  conference: { year: number; edition_code: string },
  organizationId: string,
  db: AdminClient = createAdminClient()
): Promise<ChecklistDigest | null> {
  const { data: org } = await db.from("organizations").select("name, slug").eq("id", organizationId).single();
  if (!org) return null;

  const { data: tasks } = await db
    .from("conference_checklist_tasks")
    .select("id, name, description, check_type, check_entity_id")
    .eq("checklist_id", checklist.id)
    .eq("active", true)
    .eq("audience", "org")
    .order("sort_order", { ascending: true });

  const openItems: ChecklistDigest["openItems"] = [];
  for (const task of tasks ?? []) {
    const checkType = task.check_type as CheckType;
    const complete = await CHECKS[checkType]({
      db, organizationId, conferenceId: checklist.conference_id,
      entityId: task.check_entity_id, taskId: task.id,
    });
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
  if (openItems.length === 0) return null;

  const framing = renderFraming(checklist, conference.year);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca";
  return {
    orgName: org.name,
    openItems,
    variables: {
      /**
       * Where this list lives, so nobody has to keep the email to find it.
       *
       * Two destinations because an org admin is also a person and holds two
       * separate lists: the company's items (which is what this email is) and
       * their own. Sending them to one and letting them discover the other is
       * how the "conflicting messages" problem started.
       */
      where_to_track:
        `<p style="margin:18px 0 0;font-size:13px;color:#6b7280;line-height:1.55">` +
        `You don't need to keep this email — ${escapeHtml(org.name)}'s list is always at ` +
        `<a href="${appUrl}/org/${org.slug}/conference/${checklist.conference_id}" style="color:#163D6D">your organisation's conference page</a>, ` +
        `and anything that's yours personally is at ` +
        `<a href="${appUrl}/me/conference/${checklist.conference_id}" style="color:#163D6D">your own conference page</a>.` +
        `</p>`,
      org_name: org.name,
      checklist_name: checklist.name,
      open_items_html: renderOpenItemsHtml(openItems),
      conference_year: String(conference.year),
      ...framing,
    },
  };
}

async function findDueOrgs(
  db: AdminClient,
  checklist: { id: string; conference_id: string; scope_entity_id: string | null; deadline_at: string; publication_id?: string | null }
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

  const orgIds = await resolveScopedOrgs(db, checklist);
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
    .select("id, conference_id, name, deadline_at, scope_entity_id, publication_id, publication:publications(title), conference:conference_instances(year, edition_code)")
    .eq("active", true);
  if (checklistsError) {
    result.errors.push(`Failed to load checklists: ${checklistsError.message}`);
    return result;
  }

  /**
   * One email per organisation, not one per checklist.
   *
   * The old shape sent a separate digest for every checklist that happened to
   * be due, so a partner admin with three armed checklists received three
   * messages — each titled "a few things still need your attention", each
   * showing a slice of their list, each framed differently. From the
   * recipient's side that reads as three unrelated nags about the same
   * conference.
   *
   * The action centres already merge across checklists (`loadOrgTasks` /
   * `loadPersonalTasks`); this makes the mail agree with them.
   */
  type Pending = {
    conferenceId: string;
    conferenceYear: number;
    orgName: string;
    /** Each carries its OWN framing, so a lone reminder still reads specifically. */
    sections: { checklistName: string; openItemsHtml: string; introLine: string }[];
    /** Only publication-scoped checklists contribute the consent note. */
    consentNote: string;
    log: { checklist_id: string; checkpoint_id: string; organization_id: string }[];
  };
  const pendingByOrg = new Map<string, Pending>();

  for (const checklist of checklists ?? []) {
    try {
      const conference = Array.isArray(checklist.conference) ? checklist.conference[0] : checklist.conference;
      if (!conference) continue;
      const publication = Array.isArray(checklist.publication) ? checklist.publication[0] : checklist.publication;
      const framing = renderFraming(
        { ...checklist, publicationTitle: publication?.title ?? null },
        conference.year
      );

      const dueOrgs = await findDueOrgs(db, checklist);
      result.checklistsProcessed++;
      if (dueOrgs.length === 0) continue;

      for (const { organizationId, checkpointId } of dueOrgs) {
        const digest = await buildChecklistDigest(
          { ...checklist, publicationTitle: publication?.title ?? null },
          conference,
          organizationId,
          db
        );
        if (!digest) continue; // fully caught up — silently skip, nothing logged

        const existing: Pending = pendingByOrg.get(organizationId) ?? {
          conferenceId: checklist.conference_id,
          conferenceYear: conference.year,
          orgName: digest.orgName,
          sections: [],
          consentNote: "",
          log: [],
        };
        existing.sections.push({
          checklistName: checklist.name,
          openItemsHtml: digest.variables.open_items_html,
          introLine: framing.intro_line,
        });
        // Carried once even if several checklists would supply it.
        if (!existing.consentNote && framing.consent_note) existing.consentNote = framing.consent_note;
        existing.log.push({ checklist_id: checklist.id, checkpoint_id: checkpointId, organization_id: organizationId });
        pendingByOrg.set(organizationId, existing);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      result.errors.push(`Checklist ${checklist.id}: ${msg}`);
      console.error(`[checklist-engine] Failed for checklist ${checklist.id}:`, msg);
    }
  }

  if (pendingByOrg.size === 0) return result;

  const recipients: { email: string; name: string | null; variableOverrides: Record<string, string> }[] = [];
  const sentLog: { checklist_id: string; checkpoint_id: string; organization_id: string }[] = [];
  let conferenceIdForAudience: string | null = null;

  for (const [organizationId, pending] of pendingByOrg) {
    const admins = await resolveAudience({
      type: "org_admins",
      filters: { org_ids: [organizationId] },
    } satisfies AudienceDefinition);
    if (admins.length === 0) continue;

    conferenceIdForAudience ??= pending.conferenceId;
    // Several checklists due at once become headed sections in one message,
    // rather than several messages.
    const body =
      pending.sections.length === 1
        ? pending.sections[0].openItemsHtml
        : pending.sections
            .map((s) => `<p style="margin:18px 0 4px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280">${s.checklistName}</p>\n${s.openItemsHtml}`)
            .join("\n");

    for (const admin of admins) {
      recipients.push({
        email: admin.email,
        name: admin.name,
        variableOverrides: {
          contact_name: admin.name ?? admin.email,
          org_name: pending.orgName,
          checklist_name:
            pending.sections.length === 1
              ? pending.sections[0].checklistName
              : `${pending.conferenceYear} conference`,
          open_items_html: body,
          conference_year: String(pending.conferenceYear),
          // One checklist keeps its own specific framing. Several become a
          // NEUTRAL opening, because the sections may mix a conference
          // checklist with a directory one — asserting "for the conference"
          // over a member store's directory tasks is exactly the wrong-audience
          // wording this framing exists to avoid. Each section is headed by its
          // checklist name, so the specifics are not lost.
          intro_line:
            pending.sections.length === 1
              ? pending.sections[0].introLine
              : "has a few things outstanding:",
          consent_note: pending.consentNote,
        },
      });
    }
    sentLog.push(...pending.log);
  }

  if (recipients.length === 0) return result;

  const campaignResult = await createCampaign({
    name: `Checklist reminders — ${pendingByOrg.size} organisation${pendingByOrg.size === 1 ? "" : "s"}`,
    templateKey: "conference_checklist_reminder",
    audience: {
      type: "custom_recipient_list",
      filters: { conference_instance_id: conferenceIdForAudience ?? undefined, recipients },
    },
    triggerSource: "conference",
    automationMode: "auto_send",
  });

  if (campaignResult.success && campaignResult.campaignId) {
    await executeCampaignSend(campaignResult.campaignId);
    if (sentLog.length > 0) {
      await db.from("conference_checklist_reminder_log").insert(sentLog);
    }
    result.orgsReminded += pendingByOrg.size;
  } else {
    result.errors.push(`Campaign creation failed — ${campaignResult.error}`);
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
export { CHECK_TYPES, type CheckType };
export { evaluateChecklistTaskCheck };
