"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Competing stores, one row at a time.
 *
 * Every other list in this survey works this way — locations, key dates,
 * income lines, people. A count plus a free-text "who are they?" asked the
 * store to compress four answers into one box and gave us back a sentence
 * nobody can group by.
 */

export interface CompetitorRow {
  id: string;
  name: string;
  kind: string | null;
}

type Guard = { ok: true; organizationId: string } | { ok: false; error: string };

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
  if (isGlobalAdmin(auth.ctx.globalRole)) return { ok: true, organizationId };
  if (row.respondent_delegate_profile_id === auth.ctx.userId) {
    return { ok: true, organizationId };
  }

  const { data: link } = await db
    .from("user_organizations")
    .select("role")
    .eq("user_id", auth.ctx.userId)
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .maybeSingle();

  if (link?.role !== "org_admin") return { ok: false, error: "Not your store." };
  return { ok: true, organizationId };
}

export async function loadCompetitors(benchmarkingId: string): Promise<CompetitorRow[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_competitors")
    .select("id, name, kind, position")
    .eq("benchmarking_id", benchmarkingId)
    .order("position");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    name: (r.name as string) ?? "",
    kind: (r.kind as string | null) ?? null,
  }));
}

export async function addCompetitor(input: {
  benchmarkingId: string;
  name: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!input.name.trim()) return { success: false, error: "Name the store first." };

  const db = createAdminClient();
  const { count } = await db
    .from("benchmarking_competitors")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", input.benchmarkingId);

  const { data, error } = await db
    .from("benchmarking_competitors")
    .insert({
      benchmarking_id: input.benchmarkingId,
      name: input.name.trim(),
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add that." };
  return { success: true, id: data.id as string };
}

export async function updateCompetitor(input: {
  benchmarkingId: string;
  competitorId: string;
  name?: string;
  kind?: string | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.kind !== undefined) patch.kind = input.kind;

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_competitors")
    .update(patch)
    .eq("id", input.competitorId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

export async function removeCompetitor(input: {
  benchmarkingId: string;
  competitorId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_competitors")
    .delete()
    .eq("id", input.competitorId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not remove that." };
  return { success: true };
}
