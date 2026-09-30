"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";
import type { KeyDateKind, ServiceStatus } from "@/lib/benchmarking/key-dates";

/**
 * Section 1 answers that belong to the ORGANISATION rather than the submission.
 *
 * Key dates, the logo, and the services a store offers are facts about the
 * institution. They outlive any one survey, other parts of the site already
 * read them, and a store should not be retyping them every October. The survey
 * is where they get confirmed.
 */

export interface KeyDate {
  id: string;
  kind: KeyDateKind;
  label: string;
  occursOn: string | null;
  endsOn: string | null;
}

type Guard =
  | { ok: true; organizationId: string; userId: string }
  | { ok: false; error: string };

/**
 * May this person write the store's profile?
 *
 * Same three ways in as the rest of the survey: CSC staff, the store's own
 * org_admin, or the colleague the admin delegated this submission to.
 */
async function guard(benchmarkingId: string): Promise<Guard> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: auth.error };

  const db = createAdminClient();
  const { data: row } = await db
    .from("benchmarking")
    .select("organization_id, status, respondent_delegate_profile_id")
    .eq("id", benchmarkingId)
    .maybeSingle();
  if (!row) return { ok: false, error: "Submission not found." };
  if (row.status === "submitted") {
    return { ok: false, error: "This submission is already in. Choose Amend first." };
  }

  const organizationId = row.organization_id as string;
  const userId = auth.ctx.userId;

  if (isGlobalAdmin(auth.ctx.globalRole)) return { ok: true, organizationId, userId };
  if (row.respondent_delegate_profile_id === userId) {
    return { ok: true, organizationId, userId };
  }

  const { data: link } = await db
    .from("user_organizations")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (link?.role !== "org_admin") return { ok: false, error: "Not your store." };
  return { ok: true, organizationId, userId };
}

// ── Key dates ────────────────────────────────────────────────────────────

export async function loadKeyDates(organizationId: string): Promise<KeyDate[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("organization_key_dates")
    .select("id, kind, label, occurs_on, ends_on, position")
    .eq("organization_id", organizationId)
    .order("position");

  return (data ?? []).map((d) => ({
    id: d.id as string,
    kind: d.kind as KeyDateKind,
    label: (d.label as string) ?? "",
    occursOn: (d.occurs_on as string | null) ?? null,
    endsOn: (d.ends_on as string | null) ?? null,
  }));
}

/**
 * Dates the organisation already told us, outside this survey.
 *
 * ⛔ Suggested, never adopted silently. Two stores have adoption deadlines in
 * their procurement profile from an entirely different conversation, and
 * loadKeyDates could not see them: the survey read only its own table and asked
 * those stores to type dates we were already holding. Copying them in
 * automatically would make a guess about currency that only the store can make,
 * so they arrive as something to confirm.
 */
export async function loadProfileKeyDateSuggestions(
  organizationId: string,
): Promise<{ title: string; date: string }[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];

  const db = createAdminClient();
  const [{ data: org }, { data: existing }] = await Promise.all([
    db
      .from("organizations")
      .select("procurement_info")
      .eq("id", organizationId)
      .maybeSingle(),
    db
      .from("organization_key_dates")
      .select("label, occurs_on")
      .eq("organization_id", organizationId),
  ]);

  const info = (org?.procurement_info as Record<string, unknown> | null) ?? {};
  const cycle = (info.buying_cycle as Record<string, unknown> | null) ?? {};
  const raw = Array.isArray(cycle.key_dates) ? cycle.key_dates : [];

  const have = new Set(
    (existing ?? []).map((e) => `${(e.label as string) ?? ""}|${(e.occurs_on as string) ?? ""}`),
  );

  return raw
    .map((d) => {
      const entry = d as Record<string, unknown>;
      return {
        title: typeof entry.title === "string" ? entry.title : "",
        date: typeof entry.date === "string" ? entry.date : "",
      };
    })
    .filter((d) => d.title && d.date)
    .filter((d) => !have.has(`${d.title}|${d.date}`));
}

export async function addKeyDate(input: {
  benchmarkingId: string;
  kind: KeyDateKind;
  label: string;
  /** Prefilled when adopting a date we already hold on the profile. */
  occursOn?: string | null;
}): Promise<{
  success: boolean;
  error?: string;
  id?: string;
  dates?: KeyDate[];
}> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!input.label.trim()) return { success: false, error: "Give the date a name." };

  const db = createAdminClient();
  const { count } = await db
    .from("organization_key_dates")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", g.organizationId);

  const { data, error } = await db
    .from("organization_key_dates")
    .insert({
      organization_id: g.organizationId,
      kind: input.kind,
      label: input.label.trim(),
      occurs_on: input.occursOn ?? null,
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add that date." };

  /*
    The whole list back, not just the new id.

    Callers reloaded the page to see a date they had just added, and a reload
    discards any field typed in the last 800ms. It also makes the seeding
    effects idempotent: React mounts an effect twice in development, and a
    caller that reads back the current state does not care which call wins.
  */
  return {
    success: true,
    id: data.id as string,
    dates: await loadKeyDates(g.organizationId),
  };
}

export async function updateKeyDate(input: {
  benchmarkingId: string;
  keyDateId: string;
  label?: string;
  occursOn?: string | null;
  endsOn?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.occursOn !== undefined) patch.occurs_on = input.occursOn || null;
  if (input.endsOn !== undefined) patch.ends_on = input.endsOn || null;

  const db = createAdminClient();
  const { error } = await db
    .from("organization_key_dates")
    .update(patch)
    .eq("id", input.keyDateId)
    .eq("organization_id", g.organizationId);

  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

export async function removeKeyDate(input: {
  benchmarkingId: string;
  keyDateId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { error } = await db
    .from("organization_key_dates")
    .delete()
    .eq("id", input.keyDateId)
    .eq("organization_id", g.organizationId);

  if (error) return { success: false, error: "Could not remove that." };
  return { success: true };
}

// ── Services, with their journey ─────────────────────────────────────────

export async function setServiceStatus(input: {
  benchmarkingId: string;
  service: string;
  status: ServiceStatus;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { data: row } = await db
    .from("benchmarking")
    .select("service_status")
    .eq("id", input.benchmarkingId)
    .maybeSingle();

  const current = ((row?.service_status as Record<string, string> | null) ?? {});
  const next = { ...current, [input.service]: input.status };

  const { error } = await db
    .from("benchmarking")
    .update({ service_status: next, updated_at: new Date().toISOString() })
    .eq("id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not save that." };

  /*
    Keep the store's public procurement profile in step.

    procurement_info.store_services is what partners see and what the match
    engine reads. Only what is CURRENTLY offered belongs there — a service the
    store plans to add is not a service it has, and publishing an intention as a
    fact is how a directory stops being trustworthy.
  */
  const offered = Object.entries(next)
    .filter(([, v]) => v === "offered")
    .map(([k]) => k);

  const { data: org } = await db
    .from("organizations")
    .select("procurement_info")
    .eq("id", g.organizationId)
    .maybeSingle();

  const info = ((org?.procurement_info as Record<string, unknown> | null) ?? {});
  await db
    .from("organizations")
    .update({
      procurement_info: { ...info, store_services: offered },
      updated_at: new Date().toISOString(),
    })
    .eq("id", g.organizationId);

  return { success: true };
}

// ── Logo confirmation ────────────────────────────────────────────────────

export async function confirmLogos(input: {
  benchmarkingId: string;
  logoUrl?: string | null;
  logoHorizontalUrl?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = {
    logo_confirmed_at: new Date().toISOString(),
    logo_confirmed_by: g.userId,
    updated_at: new Date().toISOString(),
  };
  // Only overwrite when a replacement was actually given. Confirming "yes that
  // is still us" must never blank the asset we already hold.
  if (input.logoUrl !== undefined && input.logoUrl) patch.logo_url = input.logoUrl;
  if (input.logoHorizontalUrl !== undefined && input.logoHorizontalUrl) {
    patch.logo_horizontal_url = input.logoHorizontalUrl;
  }

  const db = createAdminClient();
  const { error } = await db.from("organizations").update(patch).eq("id", g.organizationId);
  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}
