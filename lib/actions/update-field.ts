"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import {
  canManageOrganization,
  requireAuthenticated,
  requireConferenceDeskAccess,
} from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  EDITABLE_COLUMNS,
  isTier2,
  editAnchorId,
  fieldDisplayLabel,
  type EditableTable,
} from "@/lib/editable-fields";
import { queueTier2Change } from "@/lib/actions/pending-content-changes";
import { sendContentChangeFyi } from "@/lib/email/send";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { mirrorFieldsToMembership } from "@/lib/membership/mirror";
import {
  resolveBenchmarkingEdit,
  type BenchmarkingEditDecision,
} from "@/lib/benchmarking/manual-edit";

interface UpdateFieldParams {
  table: EditableTable;
  column: string;
  entityId: string;
  newValue: string | number | null;
  /** Pass the org's UUID when this field is on an org page (/org/[slug]).
   *  Org-page edits always write immediately (no queue).
   *  Tier 2 org-page edits still fire a passive FYI to super_admins. */
  orgId?: string;
  /** Human-readable name of the entity, for email/audit context. */
  entityDisplayName?: string;
  /** Page path for deep-link in emails, e.g. "/org/lakeland-college". */
  pageHref?: string;
  /**
   * The check-in desk correcting a name or title before a reprint (Stephen,
   * 2026-10-21). Desk staff are not org admins, so this is their permission:
   * desk access to THIS conference, for a contact registered at it, and only
   * the name and title.
   *
   * ⛔ A desk edit never reaches Circle. Two Circle accounts are shared by
   * contacts with different names (2026-10-21); a desk rename of either would
   * rename the other person's Circle profile. Circle is corrected on purpose,
   * from the org page.
   */
  deskConferenceId?: string;
}

/** What the desk may correct: the words printed on the badge. */
const DESK_EDITABLE_CONTACT_COLUMNS = new Set(["first_name", "last_name", "role_title"]);

/** "Mary Ann Smith" → Mary / Ann Smith; one word is a first name alone. */
function splitName(name: string): { first_name: string | null; last_name: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return { first_name: parts[0] ?? null, last_name: parts.slice(1).join(" ") || null };
}

export interface UpdateFieldResult {
  success: boolean;
  error?: string;
  previousValue?: string | number | null;
  /** Set when the change was queued for second-signer approval (Tier 2, no orgId). */
  pendingChangeId?: string;
  requiresApproval?: boolean;
}

/**
 * Update a single field in the database.
 * Used by the global Toolkit Edit feature.
 *
 * Security:
 * - Only admins (super_admin or org_admin for the org) can update
 * - Only columns in EDITABLE_COLUMNS (lib/editable-fields.ts) can be updated
 * - Entity ownership is verified before any write
 * - Writes use the admin client (bypasses RLS) — permission check is in app code
 *
 * Tier 2 behaviour:
 * - On org pages (orgId provided): always writes immediately, sends FYI to super_admins
 *   for Tier 2 fields (logos, URLs, action links)
 * - Outside org pages (no orgId): Tier 2 fields go to pending_content_changes queue
 */
export async function updateField({
  table,
  column,
  entityId,
  newValue,
  orgId,
  entityDisplayName,
  pageHref,
  deskConferenceId,
}: UpdateFieldParams): Promise<UpdateFieldResult> {
  try {
    const auth = await requireAuthenticated();
    if (!auth.ok) {
      return { success: false, error: "You must be logged in to edit" };
    }
    const { supabase, userEmail } = auth.ctx;

    // 1. Validate column is in allowlist
    const allowedColumns = EDITABLE_COLUMNS[table] as readonly string[];
    if (!allowedColumns || !allowedColumns.includes(column)) {
      console.error(`Column ${table}.${column} is not editable`);
      return { success: false, error: "This field cannot be edited" };
    }

    // 2. Verify entity ownership and capture previous value
    let canEdit = false;
    let previousValue: string | number | null = null;
    let resolvedOrgId: string | null = orgId ?? null;
    let resolvedDisplayName: string = entityDisplayName ?? "";
    // Set only on the benchmarking path; carries the amendment facts from the
    // permission check down to the write and the audit row.
    let benchmarkingEdit: BenchmarkingEditDecision | null = null;
    // The contact's split name, so a name edit keeps name and first/last in step.
    let contactNameParts: { first_name: string | null; last_name: string | null } | null = null;

    if (table === "organizations") {
      const { data: org } = await supabase
        .from("organizations")
        .select("id, name, slug, " + column)
        .eq("id", entityId)
        .single();

      if (!org) return { success: false, error: "Organization not found" };
      const orgData = org as unknown as Record<string, unknown>;
      previousValue = orgData[column] as string | number | null;
      resolvedOrgId = entityId;
      resolvedDisplayName = resolvedDisplayName || (orgData.name as string) || "";
      canEdit = canManageOrganization(auth.ctx, entityId);
    } else if (table === "contacts") {
      // Session client lost SELECT on contacts when the public-read policy
      // was dropped (PII leak fix); use the admin client like every other
      // contacts read in this file. Authorization is still enforced below
      // via canManageOrganization / isOwnContact.
      const adminClient = createAdminClient();
      const { data: contact } = await adminClient
        .from("contacts")
        .select("id, name, first_name, last_name, work_email, email, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!contact) return { success: false, error: "Contact not found" };
      contactNameParts = contact as unknown as { first_name: string | null; last_name: string | null };
      const contactData = contact as unknown as Record<string, unknown>;
      previousValue = contactData[column] as string | number | null;
      const cOrgId = contactData.organization_id as string | null;
      resolvedOrgId = resolvedOrgId ?? cOrgId;
      resolvedDisplayName = resolvedDisplayName || (contactData.name as string) || "";
      const isOrgAdmin = Boolean(cOrgId && canManageOrganization(auth.ctx, cOrgId));
      // Members can edit their own contact fields (matched by email)
      const contactEmail = (contactData.work_email || contactData.email) as string | null;
      const isOwnContact = !!auth.ctx.userEmail && !!contactEmail &&
        contactEmail.toLowerCase() === auth.ctx.userEmail.toLowerCase();
      canEdit = isOrgAdmin || isOwnContact;

      if (!canEdit && deskConferenceId) {
        if (!DESK_EDITABLE_CONTACT_COLUMNS.has(column)) {
          return { success: false, error: "The desk can only correct a name or title." };
        }
        const desk = await requireConferenceDeskAccess(deskConferenceId);
        if (!desk.ok) return { success: false, error: desk.error };
        // Only somebody registered at this conference: desk access is not a
        // licence to edit any contact on the site.
        const { data: registered } = await adminClient
          .from("conference_people")
          .select("id")
          .eq("conference_id", deskConferenceId)
          .eq("canonical_person_id", entityId)
          .limit(1)
          .maybeSingle();
        canEdit = Boolean(registered);
      }
    } else if (table === "brand_colors") {
      const { data: color } = await supabase
        .from("brand_colors")
        .select("id, organization_id, " + column)
        .eq("id", entityId)
        .single();

      if (!color) return { success: false, error: "Brand color not found" };
      const colorData = color as unknown as Record<string, unknown>;
      previousValue = colorData[column] as string | number | null;
      const cOrgId = colorData.organization_id as string;
      resolvedOrgId = resolvedOrgId ?? cOrgId;
      canEdit = canManageOrganization(auth.ctx, cOrgId);
    } else if (table === "benchmarking") {
      const adminClient = createAdminClient();
      const { data: benchmark } = await adminClient
        .from("benchmarking")
        .select("id, organization_id, fiscal_year, " + column)
        .eq("id", entityId)
        .single();

      if (!benchmark) return { success: false, error: "Benchmarking record not found" };
      const benchmarkData = benchmark as unknown as Record<string, unknown>;
      previousValue = benchmarkData[column] as string | number | null;
      const bOrgId = benchmarkData.organization_id as string;
      resolvedOrgId = resolvedOrgId ?? bOrgId;
      canEdit = canManageOrganization(auth.ctx, bOrgId);

      // Permission is not the only question for these figures. The survey owns
      // them while a cycle is live, and only the newest year may be corrected
      // at all. Decided before the write, and it refuses with the reason so the
      // store is told where to go rather than that it "cannot".
      if (canEdit) {
        benchmarkingEdit = await resolveBenchmarkingEdit({
          id: entityId,
          organization_id: bOrgId,
          fiscal_year: benchmarkData.fiscal_year as number,
        });
        if (!benchmarkingEdit.allowed) {
          return { success: false, error: benchmarkingEdit.reason };
        }
      }
    } else if (table === "site_content") {
      // site_content requires admin or super_admin
      const role = auth.ctx.globalRole;
      if (role !== "admin" && role !== "super_admin") {
        return { success: false, error: "You don't have permission to edit site content" };
      }
      const adminClient = createAdminClient();
      const { data: sc } = await adminClient
        .from("site_content")
        .select("id, " + column)
        .eq("id", entityId)
        .single();

      if (!sc) return { success: false, error: "Site content record not found" };
      const scData = sc as unknown as Record<string, unknown>;
      previousValue = scData[column] as string | number | null;
      canEdit = true;
    }

    if (!canEdit) {
      return { success: false, error: "You don't have permission to edit this" };
    }

    // 3. Tier 2 gate — only applies when outside an org-page context.
    // super_admins are the final authority and bypass the queue entirely.
    const isOrgPageEdit = Boolean(resolvedOrgId && orgId);
    const isSuperAdmin = auth.ctx.globalRole === "super_admin";
    if (isTier2(table, column) && !isOrgPageEdit && !isSuperAdmin) {
      // Queue for second-signer approval
      const anchor = editAnchorId(table, column, entityId);
      const result = await queueTier2Change({
        targetTable: table,
        targetColumn: column,
        targetEntityId: entityId,
        proposedValue: newValue,
        previousValue,
        entityDisplayName: resolvedDisplayName,
        fieldDisplayLabel: fieldDisplayLabel(column),
        pageHref: pageHref ?? null,
        anchorId: anchor,
        requestedBy: auth.ctx.userId,
      });

      if (!result.success) {
        return { success: false, error: result.error ?? "Failed to queue change for approval" };
      }

      return {
        success: true,
        requiresApproval: true,
        pendingChangeId: result.pendingChangeId,
        previousValue,
      };
    }

    // 4. Perform the write (Tier 1, or Tier 2 on org page)
    // Editing FTE directly is an explicit admin call — it should stick as
    // the org's public/priced number until the org's next benchmarking
    // submission naturally refreshes it (see submitBenchmarkingSurvey).
    const isManualFteEdit = table === "organizations" && column === "fte";
    // Editing the org's contact slot IS the affirmation that it is a public
    // record. Every existing value predates that promise — they were collected
    // as "how do we reach you" and are a named person's details in 102 of 110
    // rows — so none of them may be printed until someone sets them again
    // under the label that now says so. Stamping here is what makes the value
    // publishable; nothing backfills it.
    const isPublicContactEdit =
      table === "organizations" && (column === "email" || column === "phone");
    // A benchmarking figure changed here did not come from the survey. Stamping
    // amended_at is what stops it from reading, a year later, as what the store
    // originally filed — the same column the survey's own amend flow sets.
    const isBenchmarkingAmendment = table === "benchmarking";
    // ⛔ A contact's name lives twice: `name` (the directory, Circle) and
    // first_name/last_name (the badge reads these). An edit to one used to leave
    // the other stale, so a corrected name never reached a printed badge.
    const nameInStep: Record<string, string | null> = {};
    if (table === "contacts" && contactNameParts) {
      const text = typeof newValue === "string" ? newValue.trim() : "";
      if (column === "name" && text) {
        Object.assign(nameInStep, splitName(text));
      } else if (column === "first_name" || column === "last_name") {
        const parts = { ...contactNameParts, [column]: text || null };
        const full = [parts.first_name, parts.last_name].filter(Boolean).join(" ").trim();
        if (!full) return { success: false, error: "A name can't be empty." };
        nameInStep.name = full;
      }
    }
    const fullNameAfter = (nameInStep.name ?? (column === "name" ? newValue : null)) as string | null;
    const adminClient = createAdminClient();
    const { error: updateError } = await adminClient
      .from(table)
      .update({
        [column]: newValue,
        ...nameInStep,
        ...(isManualFteEdit ? { fte_is_manual_override: true } : {}),
        ...(isPublicContactEdit ? { public_contact_confirmed_at: new Date().toISOString() } : {}),
        ...(isBenchmarkingAmendment ? { amended_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", entityId);

    if (updateError) {
      console.error(`Error updating ${table}.${column}:`, updateError);
      return { success: false, error: "Failed to update field" };
    }

    // Phase 4 Stage 2a: keep the org's `memberships` row in step with the
    // FTE just written, so billing reads can move onto that table without
    // silently pricing off a stale number. Deliberately scoped to the
    // organizations.fte case only — this handler serves dozens of other
    // table/column combos that have nothing to do with membership.
    if (isManualFteEdit) {
      const mirroredFte = newValue === null ? null : Number(newValue);
      if (mirroredFte === null || Number.isFinite(mirroredFte)) {
        await mirrorFieldsToMembership(
          entityId,
          { fte: mirroredFte },
          { source: "update-field" }
        );
      }
    }

    // Derived metrics are what the peer comparison actually reads. Changing a
    // source figure without refreshing them leaves the comparison quietly
    // disagreeing with the profile it sits under — which is where this path has
    // been since the four inline fields shipped, because only
    // submitBenchmarkingSurvey ever called this.
    //
    // syncMetricsFor declines to touch a year whose survey is `complete`, on
    // purpose: those figures went out to members in a package, and restating a
    // published year is a decision someone makes with a covering note, not a
    // side effect of an edit. So for a completed year the source row changes
    // here and the published metrics deliberately do not — which is what
    // metrics_frozen in the audit row above is recording, and what the org page
    // tells the store.
    if (table === "benchmarking") {
      try {
        const { syncMetricsFor } = await import("@/lib/actions/benchmarking-metrics");
        await syncMetricsFor(entityId);
      } catch (err) {
        // Recoverable by recomputeYear; never worth failing a saved edit over.
        console.warn("[update-field] benchmarking metrics sync failed:", err);
      }
    }

    // 5. Post-write side effects
    // ⛔ This used to re-match the contact BY EMAIL (ensureKnownPerson) and
    // write it back: on a shared inbox that picked whichever row came first, so
    // renaming one person could put their name on the other's record, and every
    // edit reset contact_type to ["directory"]. A contact row IS the person now;
    // the write above is the whole edit.
    //
    // Push profile edits outward. The database is the source of truth: a
    // change made here has to reach the other endpoints, not sit locally.
    // Circle accepts name and custom profile fields. It has no field for
    // phone, and member email is an identity change rather than a profile
    // edit, so neither is pushed. ⛔ Never from the desk (deskConferenceId).
    if (table === "contacts" && !deskConferenceId) {
      const payload =
        fullNameAfter
          ? { name: fullNameAfter }
          : column === "role_title" && typeof newValue === "string" && newValue
            ? { jobTitle: newValue }
            : null;

      if (payload) {
        void enqueueCircleSync({
          operation: "update_profile",
          entityType: "contact",
          entityId,
          payload,
          orgId: resolvedOrgId ?? undefined,
          idempotencyKey: `update-profile-${column}-${entityId}-${fullNameAfter ?? newValue}`,
        });
      }
    }

    // 5b. Record what changed. previousValue was already read for the FYI
    // email and then thrown away, so an edit to a priced field — FTE decides
    // dues and next year's comparison — left nothing behind but a console
    // line on whichever server happened to handle it. A secretary asking in
    // two years who set KPU to 12,000, and on what basis, had no way to find
    // out. Fire and forget: a lost audit row is bad, a refused edit is worse.
    void adminClient
      .from("audit_log")
      .insert({
        action: "field.update",
        entity_type: table,
        entity_id: entityId,
        actor_id: auth.ctx.userId ?? null,
        actor_type: "user",
        details: {
          table,
          column,
          previous_value: previousValue,
          new_value: newValue,
          organization_id: resolvedOrgId,
          entity_name: resolvedDisplayName,
          changed_by_email: userEmail ?? null,
          // The desk's corrections, told apart from an org admin's.
          via_check_in_desk: deskConferenceId || undefined,
          name_kept_in_step: Object.keys(nameInStep).length ? nameInStep : undefined,
          // The two writes that reach beyond this row, recorded so the effect
          // is legible without re-deriving it from the column name.
          set_manual_override: isManualFteEdit || undefined,
          mirrored_to_membership: isManualFteEdit || undefined,
          // What makes a benchmarking figure legible a year from now: that it
          // was changed outside the survey, and what the cycle was doing at the
          // time. Without the status, a reader has to reconstruct the calendar
          // to tell a between-cycles correction from an in-cycle one.
          manual_amendment: benchmarkingEdit?.allowed || undefined,
          survey_status: benchmarkingEdit?.allowed
            ? benchmarkingEdit.surveyStatus
            : undefined,
          // True when the year's published metrics were left alone on purpose.
          metrics_frozen: benchmarkingEdit?.allowed
            ? benchmarkingEdit.metricsFrozen || undefined
            : undefined,
        },
      })
      .then(({ error }) => {
        if (error) console.warn("[update-field] audit write failed:", error.message);
      });

    // 6. Passive FYI notification for Tier 2 fields on org pages
    if (isTier2(table, column) && isOrgPageEdit) {
      void sendContentChangeFyi({
        fieldLabel: fieldDisplayLabel(column),
        entityDisplayName: resolvedDisplayName,
        previousValue: previousValue !== null ? String(previousValue) : null,
        newValue: newValue !== null ? String(newValue) : null,
        changedByEmail: userEmail ?? "unknown",
        pageHref: pageHref ?? (resolvedOrgId ? `/org/${resolvedOrgId}` : null),
      }).catch((err) => {
        console.warn("[update-field] FYI email failed (non-blocking):", err);
      });
    }

    // 7. Bust Next.js server cache so router.refresh() sees the new value
    if (deskConferenceId) {
      // The desk reads its own data back; rebuilding every page on the site
      // cost each correction ~10s at the front of a queue (2026-10-21).
    } else if (pageHref) {
      revalidatePath(pageHref);
    } else {
      // No specific path — revalidate everything (edits are infrequent admin ops)
      revalidatePath("/", "layout");
    }
    if (resolvedOrgId) {
      // revalidatePath doesn't reach the unstable_cache-tagged org profile data cache
      revalidateTag("org-profile", "max");
    }

    console.log(`[update-field] ${table}.${column} updated`, { entityId, previousValue, newValue, user: userEmail });

    return { success: true, previousValue };
  } catch (err) {
    console.error("Error updating field:", err);
    return { success: false, error: "An unexpected error occurred" };
  }
}
