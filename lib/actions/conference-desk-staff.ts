"use server";

/**
 * Desk staff, managed FROM the conference: Days & Setup → Desk staff.
 *
 * ⛔ Moved here from the Access page so staff are assigned by conference. Same
 * appointments table and the same end-appointment action as every other
 * appointment; the Access page no longer offers this capability.
 *
 * Adding someone does three things, all through existing paths:
 *   1. ACCOUNT  — the staff organisation's own invite (provisionOrgLogin, what
 *                 "Invite user" on an org uses): a new person gets a login and
 *                 the set-your-password email; an existing one is linked.
 *   2. STAFF LINK END DATE — a temp's link to the staff organisation ends when
 *                 their desk work does. ⛔ Never shortens or adds an end date
 *                 to a link that has none already: that is a permanent staffer
 *                 (Carolyn), and appointing her to a desk must not schedule
 *                 her removal. "Allow permanent access" clears it.
 *   3. APPOINTMENT — for this conference (blank days follow its dates, read
 *                 fresh each time) or, when permanent, for every conference.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import { provisionOrgLogin } from "@/lib/identity/org-login";
import { findUserByEmail } from "@/lib/supabase/user-lookup";
import { DESK_STAFF_CAPABILITY, nextIsoDate, staffLinkEndDecision } from "@/lib/conference/desk-staff";
import { isoDateInZone } from "@/lib/conference/tz";
import { ORG_TYPE } from "@/lib/constants/org-types";

export type DeskStaffRow = {
  assignmentId: string;
  name: string;
  /** Every conference, no end date. */
  permanent: boolean;
  /** Inclusive days, or null for "follows the conference's dates". */
  firstDay: string | null;
  lastDay: string | null;
  reason: string;
  profileId: string | null;
  /** Has chosen a desk PIN. An admin can clear it; they choose again on next use. */
  hasPin: boolean;
};

type Result<T> = { success: true; data: T } | { success: false; error: string };

async function requireGlobalAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole)) return { ok: false, error: "Administrator access required" };
  return { ok: true, userId: auth.ctx.userId };
}

/** Desk staff for this conference: its own appointments and the permanent ones, current or upcoming. */
export async function listDeskStaff(conferenceId: string): Promise<Result<DeskStaffRow[]>> {
  const admin = await requireGlobalAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const db = createAdminClient();
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db
    .from("capability_contributions")
    .select("assignment_id, subject_id, display_name, conference_id, term_start, term_end, reason")
    .eq("capability", DESK_STAFF_CAPABILITY)
    .or(`conference_id.eq.${conferenceId},conference_id.is.null`)
    .order("term_start");
  if (error) return { success: false, error: error.message };

  const profileIds = [...new Set((data ?? []).map((r) => r.subject_id as string | null).filter((id): id is string => Boolean(id)))];
  const { data: pins, error: pinError } = profileIds.length
    ? await db.from("desk_pins").select("profile_id").in("profile_id", profileIds)
    : { data: [], error: null };
  if (pinError) return { success: false, error: pinError.message };
  const withPin = new Set((pins ?? []).map((p) => p.profile_id as string));

  return {
    success: true,
    data: (data ?? [])
      // Current or upcoming only; ended appointments are history.
      .filter((r) => r.term_end === null || (r.term_end as string) > today)
      .map((r) => {
      const termEnd = (r.term_end as string | null) ?? null;
      return {
        assignmentId: r.assignment_id as string,
        name: (r.display_name as string | null) ?? "Unknown",
        permanent: r.conference_id === null,
        firstDay: termEnd ? (r.term_start as string) : null,
        // Stored exclusive; shown as the last day worked.
        lastDay: termEnd ? isoDayBefore(termEnd) : null,
        reason: (r.reason as string | null) ?? "",
        profileId: (r.subject_id as string | null) ?? null,
        hasPin: withPin.has(r.subject_id as string),
      };
    }),
  };
}

function isoDayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function addDeskStaff(input: {
  conferenceId: string;
  /** An existing person with a login (from the search), or… */
  profileId?: string;
  /** …an email to invite. */
  email?: string;
  firstDay?: string;
  lastDay?: string;
  permanent: boolean;
  reason: string;
}): Promise<Result<{ invited: boolean }>> {
  const admin = await requireGlobalAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  if (!input.reason?.trim()) return { success: false, error: "Say what they are doing, for the record." };

  const db = createAdminClient();
  const [{ data: conference }, { data: staffOrg }] = await Promise.all([
    db
      .from("conference_instances")
      .select("id, end_date, timezone")
      .eq("id", input.conferenceId)
      .maybeSingle(),
    db.from("organizations").select("id").eq("type", ORG_TYPE.staff).limit(1).maybeSingle(),
  ]);
  if (!conference) return { success: false, error: "That conference does not exist." };
  if (!staffOrg) return { success: false, error: "There is no staff organisation to add them to." };

  // ── 1. Who, with a login and a link to the staff organisation ──────────
  let email = input.email?.trim().toLowerCase() || null;
  let profileId = input.profileId ?? null;
  if (!email && profileId) {
    const { data } = await db.auth.admin.getUserById(profileId);
    email = data?.user?.email?.toLowerCase() ?? null;
  }
  if (!email) return { success: false, error: "Pick a person or enter an email." };

  const existingUser = await findUserByEmail(db, email);
  const { data: linkBefore } = existingUser
    ? await db
        .from("user_organizations")
        .select("id, status, expires_at")
        .eq("user_id", existingUser.id)
        .eq("organization_id", staffOrg.id)
        .maybeSingle()
    : { data: null };

  const provisioned = await provisionOrgLogin({
    orgId: staffOrg.id,
    email,
    role: "member",
    syncIdentity: true,
  });
  if (!provisioned.success && provisioned.outcome !== "already_member") {
    return { success: false, error: provisioned.error ?? "Could not create their login." };
  }
  profileId = profileId ?? (await findUserByEmail(db, email))?.id ?? null;
  if (!profileId) return { success: false, error: "Their login was not found after inviting them." };

  // ── 2. The staff link's end date ───────────────────────────────────────
  const tz = conference.timezone || "America/Toronto";
  const lastDayWorked = input.lastDay || input.firstDay || conference.end_date || null;
  const decision = staffLinkEndDecision({
    linkBefore: linkBefore ? { status: linkBefore.status, expires_at: linkBefore.expires_at } : null,
    permanent: input.permanent,
    lastDayWorked,
  });
  if (decision.action !== "keep") {
    await db
      .from("user_organizations")
      .update({ expires_at: decision.action === "set" ? decision.endsOn : null })
      .eq("user_id", profileId)
      .eq("organization_id", staffOrg.id);
  }

  // ── 3. The appointment ─────────────────────────────────────────────────
  const { data: body } = await db
    .from("governance_bodies")
    .select("id")
    .eq("key", "conference_operations")
    .maybeSingle();
  const { data: role } = await db
    .from("governance_role_capabilities")
    .select("role_key")
    .eq("capability", DESK_STAFF_CAPABILITY)
    .eq("appointable", true)
    .limit(1)
    .maybeSingle();
  if (!body?.id || !role?.role_key) {
    return { success: false, error: "Desk staff appointments are not set up in this database." };
  }

  const today = isoDateInZone(new Date(), tz);
  let term: { conferenceId: string | null; termStart: string; termEnd: string | null };
  if (input.permanent) {
    term = { conferenceId: null, termStart: today, termEnd: null };
  } else if (input.firstDay || input.lastDay) {
    const first = (input.firstDay || input.lastDay) as string;
    const last = (input.lastDay || input.firstDay) as string;
    if (last < first) return { success: false, error: "The last day is before the first day." };
    term = { conferenceId: input.conferenceId, termStart: first, termEnd: nextIsoDate(last) };
  } else {
    // Blank: follows the conference's dates, read fresh on every check.
    term = { conferenceId: input.conferenceId, termStart: today, termEnd: null };
  }

  // Already covered? A second row would say the same thing twice.
  const { data: held } = await db
    .from("capability_contributions")
    .select("conference_id, term_start, term_end")
    .eq("subject_id", profileId)
    .eq("capability", DESK_STAFF_CAPABILITY)
    .or(`term_end.is.null,term_end.gt.${today}`);
  for (const h of held ?? []) {
    if (h.conference_id === null) {
      return { success: false, error: "They already have permanent desk access." };
    }
    if (!input.permanent && h.conference_id === input.conferenceId) {
      const hEnd = (h.term_end as string | null) ?? "9999-12-31";
      const tEnd = term.termEnd ?? "9999-12-31";
      if ((h.term_start as string) < tEnd && hEnd > term.termStart) {
        return { success: false, error: "They are already desk staff for this conference on some of those days." };
      }
    }
  }

  const { error } = await db.from("governance_role_assignments").insert({
    body_id: body.id,
    person_profile_id: profileId,
    role_key: role.role_key,
    conference_id: term.conferenceId,
    term_start: term.termStart,
    term_end: term.termEnd,
    appointing_resolution: input.reason.trim(),
    counts_toward_cap: false,
  });
  if (error) {
    console.error("[addDeskStaff]", error);
    return { success: false, error: "Could not save that appointment." };
  }

  revalidatePath(`/admin/conference/${input.conferenceId}/describe`);
  return { success: true, data: { invited: !existingUser } };
}
