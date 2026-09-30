"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * The repeating parts of §4 Other Income, §6 Staffing and §7 Expenses.
 *
 * Everything with a fixed shape lives in the field config; this file is only
 * for the rows a store adds itself — income that fits no category, expenses we
 * did not name, and the people on the team.
 */

export interface OtherIncomeRow {
  id: string;
  kind: string;
  serviceName: string | null;
  label: string;
  amount: number | null;
  /**
   * The store's own call on whether this line is revenue for comparison.
   *
   * Some run a service at cost as a campus obligation — a print desk that
   * clears its expenses and nothing more. Counting that as revenue makes the
   * store look bigger and its margin worse, and only the store knows which it
   * is.
   */
  countsAsIncome: boolean;
  /** What it costs to deliver this income, if the store tracks it. */
  directCost: number | null;
  /**
   * Whether that cost is already inside the Expenses section.
   *
   * ⛔ The statement adds it to operating expenses ONLY when this is false.
   * For most stores the toner is already in "Store and business supplies" and
   * the machine lease in "Depreciation", so counting it again would double it.
   */
  directCostInExpenses: boolean;
}

export interface OtherExpenseRow {
  id: string;
  label: string;
  amount: number | null;
}

export interface StaffRow {
  id: string;
  contactId: string | null;
  name: string;
  employmentType: string | null;
  yearsInCampusRetail: number | null;
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

// ── §4 Other income ──────────────────────────────────────────────────────

export async function loadOtherIncome(benchmarkingId: string): Promise<OtherIncomeRow[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_other_income")
    .select(
      "id, kind, service_name, label, amount, counts_as_income, direct_cost, direct_cost_in_expenses, position",
    )
    .eq("benchmarking_id", benchmarkingId)
    .order("position");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    kind: (r.kind as string) ?? "other",
    serviceName: (r.service_name as string | null) ?? null,
    label: (r.label as string) ?? "",
    amount: (r.amount as number | null) ?? null,
    countsAsIncome: (r.counts_as_income as boolean | null) ?? true,
    directCost: (r.direct_cost as number | null) ?? null,
    directCostInExpenses: (r.direct_cost_in_expenses as boolean | null) ?? true,
  }));
}

/**
 * Give every service the store says it offers a line of its own.
 *
 * A store that runs printing, lockers and transit passes should not have to
 * remember that those earn money and type three labels. It already told us in
 * §1; this turns that answer into the rows waiting to be filled.
 */
export async function seedServiceIncome(
  benchmarkingId: string,
): Promise<{ success: boolean; added: number }> {
  const g = await guard(benchmarkingId);
  if (!g.ok) return { success: false, added: 0 };

  const db = createAdminClient();
  const [{ data: row }, { data: existing }] = await Promise.all([
    db.from("benchmarking").select("service_status").eq("id", benchmarkingId).maybeSingle(),
    db
      .from("benchmarking_other_income")
      .select("service_name")
      .eq("benchmarking_id", benchmarkingId)
      .eq("kind", "store_service"),
  ]);

  const offered = Object.entries(
    (row?.service_status as Record<string, string> | null) ?? {},
  )
    .filter(([, v]) => v === "offered")
    .map(([k]) => k);

  const have = new Set((existing ?? []).map((e) => e.service_name as string));
  const missing = offered.filter((s) => !have.has(s));
  if (missing.length === 0) return { success: true, added: 0 };

  const { count } = await db
    .from("benchmarking_other_income")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", benchmarkingId);

  await db.from("benchmarking_other_income").insert(
    missing.map((s, i) => ({
      benchmarking_id: benchmarkingId,
      kind: "store_service",
      service_name: s,
      label: s,
      position: (count ?? 0) + i,
    })),
  );
  return { success: true, added: missing.length };
}

export async function addOtherIncome(input: {
  benchmarkingId: string;
  label: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!input.label.trim()) return { success: false, error: "Name the income first." };

  const db = createAdminClient();
  const { count } = await db
    .from("benchmarking_other_income")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", input.benchmarkingId);

  const { data, error } = await db
    .from("benchmarking_other_income")
    .insert({
      benchmarking_id: input.benchmarkingId,
      kind: "other",
      label: input.label.trim(),
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add that." };
  return { success: true, id: data.id as string };
}

export async function updateOtherIncome(input: {
  benchmarkingId: string;
  rowId: string;
  label?: string;
  amount?: number | null;
  countsAsIncome?: boolean;
  directCost?: number | null;
  directCostInExpenses?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.amount !== undefined) patch.amount = input.amount;
  if (input.countsAsIncome !== undefined) patch.counts_as_income = input.countsAsIncome;
  if (input.directCost !== undefined) patch.direct_cost = input.directCost;
  if (input.directCostInExpenses !== undefined) {
    patch.direct_cost_in_expenses = input.directCostInExpenses;
  }

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_other_income")
    .update(patch)
    .eq("id", input.rowId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

export async function removeOtherIncome(input: {
  benchmarkingId: string;
  rowId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_other_income")
    .delete()
    .eq("id", input.rowId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not remove that." };
  return { success: true };
}

// ── §7 Expenses a store names itself ─────────────────────────────────────

export async function loadOtherExpenses(benchmarkingId: string): Promise<OtherExpenseRow[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_other_expenses")
    .select("id, label, amount, position")
    .eq("benchmarking_id", benchmarkingId)
    .order("position");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: (r.label as string) ?? "",
    amount: (r.amount as number | null) ?? null,
  }));
}

export async function addOtherExpense(input: {
  benchmarkingId: string;
  label: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!input.label.trim()) return { success: false, error: "Name the expense first." };

  const db = createAdminClient();
  const { count } = await db
    .from("benchmarking_other_expenses")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", input.benchmarkingId);

  const { data, error } = await db
    .from("benchmarking_other_expenses")
    .insert({
      benchmarking_id: input.benchmarkingId,
      label: input.label.trim(),
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add that." };
  return { success: true, id: data.id as string };
}

export async function updateOtherExpense(input: {
  benchmarkingId: string;
  rowId: string;
  label?: string;
  amount?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.amount !== undefined) patch.amount = input.amount;
  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_other_expenses")
    .update(patch)
    .eq("id", input.rowId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

export async function removeOtherExpense(input: {
  benchmarkingId: string;
  rowId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_other_expenses")
    .delete()
    .eq("id", input.rowId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not remove that." };
  return { success: true };
}

// ── §6 Staffing ──────────────────────────────────────────────────────────

export async function loadStaff(benchmarkingId: string): Promise<StaffRow[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];
  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_staff")
    .select("id, contact_id, name, employment_type, years_in_campus_retail, position")
    .eq("benchmarking_id", benchmarkingId)
    .order("position");
  return (data ?? []).map((r) => ({
    id: r.id as string,
    contactId: (r.contact_id as string | null) ?? null,
    name: (r.name as string) ?? "",
    employmentType: (r.employment_type as string | null) ?? null,
    yearsInCampusRetail: (r.years_in_campus_retail as number | null) ?? null,
  }));
}

/**
 * Start from the people we already know at this store.
 *
 * The store has contacts on file; asking it to retype the team is the same
 * mistake the four respondent boxes made. Seeded once, then the store adds and
 * removes freely — the roster is theirs, not ours.
 */
export async function seedStaffFromContacts(
  benchmarkingId: string,
): Promise<{ success: boolean; added: number }> {
  const g = await guard(benchmarkingId);
  if (!g.ok) return { success: false, added: 0 };

  const db = createAdminClient();
  const [{ data: contacts }, { data: existing }] = await Promise.all([
    db
      .from("contacts")
      .select("id, name, first_name, last_name")
      .eq("organization_id", g.organizationId)
      .order("name"),
    db.from("benchmarking_staff").select("contact_id").eq("benchmarking_id", benchmarkingId),
  ]);

  const have = new Set((existing ?? []).map((e) => e.contact_id as string));
  const seen = new Set<string>();
  const rows: { benchmarking_id: string; contact_id: string; name: string; position: number }[] = [];

  for (const c of contacts ?? []) {
    const name =
      (c.name as string | null) ??
      [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
    if (!name) continue;
    // ⛔ De-duplicated for display only; the contact rows are never merged.
    const key = name.toLowerCase();
    if (seen.has(key) || have.has(c.id as string)) continue;
    seen.add(key);
    rows.push({
      benchmarking_id: benchmarkingId,
      contact_id: c.id as string,
      name,
      position: rows.length,
    });
  }

  if (rows.length === 0) return { success: true, added: 0 };
  await db.from("benchmarking_staff").insert(rows);
  return { success: true, added: rows.length };
}

export async function addStaff(input: {
  benchmarkingId: string;
  name: string;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!input.name.trim()) return { success: false, error: "Name them first." };

  const db = createAdminClient();
  const { count } = await db
    .from("benchmarking_staff")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", input.benchmarkingId);

  const { data, error } = await db
    .from("benchmarking_staff")
    .insert({
      benchmarking_id: input.benchmarkingId,
      name: input.name.trim(),
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add them." };
  return { success: true, id: data.id as string };
}

export async function updateStaff(input: {
  benchmarkingId: string;
  staffId: string;
  employmentType?: string | null;
  yearsInCampusRetail?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = {};
  if (input.employmentType !== undefined) patch.employment_type = input.employmentType;
  if (input.yearsInCampusRetail !== undefined)
    patch.years_in_campus_retail = input.yearsInCampusRetail;

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_staff")
    .update(patch)
    .eq("id", input.staffId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

export async function removeStaff(input: {
  benchmarkingId: string;
  staffId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_staff")
    .delete()
    .eq("id", input.staffId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not remove them." };
  return { success: true };
}
