"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Sales by category — §2 General Merchandise and §3 Course Materials.
 *
 * A store declares what it carries, says whether it wants a department broken
 * into subcategories, and gives the same five measures either way. Course
 * materials adds units, because dollars alone cannot tell "sold less" from
 * "discounted more".
 *
 * Buyers mirror procurement_info.category_buyers, so answering here improves
 * the store's partner matching rather than being a second set of facts about
 * the same people.
 */

export type CategoryScope = "general_merchandise" | "course_materials";

export interface CategoryLine {
  id: string;
  subcategory: string | null;
  retailSales: number | null;
  onlineSales: number | null;
  grossMarginPct: number | null;
  inventoryOpen: number | null;
  inventoryClose: number | null;
  unitsSold: number | null;
  unitsAvailable: number | null;
}

export interface CategoryLocation {
  locationId: string;
  sqft: number | null;
}

export interface SurveyCategory {
  id: string;
  department: string;
  splitBySubcategory: boolean;
  buyerContactIds: string[];
  lines: CategoryLine[];
  locations: CategoryLocation[];
}

type Guard =
  | { ok: true; organizationId: string }
  | { ok: false; error: string };

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

export async function loadCategories(
  benchmarkingId: string,
  scope: CategoryScope,
): Promise<SurveyCategory[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];

  /*
    Three plain queries rather than one nested embed.

    The embed form returned GenericStringError — PostgREST could not resolve the
    two-level nesting, and a relation it cannot resolve fails as a type error at
    best and as silently empty data at worst. Separate reads are boring, are
    obviously correct, and cost one round trip each.
  */
  const db = createAdminClient();

  const { data: cats } = await db
    .from("benchmarking_categories")
    .select("id, department, split_by_subcategory, buyer_contact_ids, position")
    .eq("benchmarking_id", benchmarkingId)
    .eq("scope", scope)
    .order("position");

  const ids = (cats ?? []).map((c) => c.id as string);
  if (ids.length === 0) return [];

  const [{ data: lines }, { data: locs }] = await Promise.all([
    db
      .from("benchmarking_category_lines")
      .select(
        "id, category_id, subcategory, retail_sales, online_sales, gross_margin_pct, inventory_open, inventory_close, units_sold, units_available, position",
      )
      .in("category_id", ids)
      .order("position"),
    db
      .from("benchmarking_category_locations")
      .select("category_id, location_id, sqft")
      .in("category_id", ids),
  ]);

  return (cats ?? []).map((c) => ({
    id: c.id as string,
    department: c.department as string,
    splitBySubcategory: Boolean(c.split_by_subcategory),
    buyerContactIds: ((c.buyer_contact_ids as string[] | null) ?? []),
    lines: (lines ?? [])
      .filter((l) => l.category_id === c.id)
      .map((l) => ({
        id: l.id as string,
        subcategory: (l.subcategory as string | null) ?? null,
        retailSales: (l.retail_sales as number | null) ?? null,
        onlineSales: (l.online_sales as number | null) ?? null,
        grossMarginPct: (l.gross_margin_pct as number | null) ?? null,
        inventoryOpen: (l.inventory_open as number | null) ?? null,
        inventoryClose: (l.inventory_close as number | null) ?? null,
        unitsSold: (l.units_sold as number | null) ?? null,
        unitsAvailable: (l.units_available as number | null) ?? null,
      })),
    locations: (locs ?? [])
      .filter((x) => x.category_id === c.id)
      .map((x) => ({
        locationId: x.location_id as string,
        sqft: (x.sqft as number | null) ?? null,
      })),
  }));
}

/** Add a department the store carries, with a single whole-department line. */
export async function addCategory(input: {
  benchmarkingId: string;
  scope: CategoryScope;
  department: string;
}): Promise<{ success: boolean; error?: string; id?: string; lineId?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { count } = await db
    .from("benchmarking_categories")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", input.benchmarkingId)
    .eq("scope", input.scope);

  const { data, error } = await db
    .from("benchmarking_categories")
    .insert({
      benchmarking_id: input.benchmarkingId,
      scope: input.scope,
      department: input.department,
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { success: false, error: "You already have that category, or it could not be added." };
  }

  // Reported whole until the store says otherwise: subcategory null means "the
  // whole department", never "an unnamed subcategory".
  const { data: line } = await db
    .from("benchmarking_category_lines")
    .insert({ category_id: data.id as string, subcategory: null, position: 0 })
    .select("id")
    .single();

  return { success: true, id: data.id as string, lineId: line?.id as string };
}

export async function removeCategory(input: {
  benchmarkingId: string;
  categoryId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_categories")
    .delete()
    .eq("id", input.categoryId)
    .eq("benchmarking_id", input.benchmarkingId);

  if (error) return { success: false, error: "Could not remove that." };
  return { success: true };
}

/**
 * Switch a department between one whole line and one line per subcategory.
 *
 * ⛔ Splitting never deletes what was already entered — the whole-department
 * line is kept and becomes the first subcategory's row only if the store puts
 * it there. Collapsing back keeps every subcategory row too. A store that
 * toggles this by accident must not lose an afternoon's typing, and figures
 * are not ours to discard on a click.
 */
export async function setCategorySplit(input: {
  benchmarkingId: string;
  categoryId: string;
  scope: CategoryScope;
  split: boolean;
  subcategories: string[];
}): Promise<{ success: boolean; error?: string; category?: SurveyCategory }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { data: existing } = await db
    .from("benchmarking_category_lines")
    .select("id, subcategory")
    .eq("category_id", input.categoryId);

  const have = new Set(
    (existing ?? []).map((l) => (l.subcategory as string | null) ?? "__whole__"),
  );

  if (input.split) {
    const missing = input.subcategories.filter((s) => !have.has(s));
    if (missing.length > 0) {
      await db.from("benchmarking_category_lines").insert(
        missing.map((s, i) => ({
          category_id: input.categoryId,
          subcategory: s,
          position: i + 1,
        })),
      );
    }
  } else if (!have.has("__whole__")) {
    await db
      .from("benchmarking_category_lines")
      .insert({ category_id: input.categoryId, subcategory: null, position: 0 });
  }

  const { error } = await db
    .from("benchmarking_categories")
    .update({ split_by_subcategory: input.split, updated_at: new Date().toISOString() })
    .eq("id", input.categoryId);

  if (error) return { success: false, error: "Could not save that." };

  /*
    Hand back the category as it now stands, rows and all.

    The caller used to reload the page to see the lines this created, which
    throws away any field typed in the last 800ms — the debounce window on every
    save in this form. Splitting a category into subcategories is not worth
    losing somebody's figure from two sections ago.
  */
  const categories = await loadCategories(input.benchmarkingId, input.scope);
  return { success: true, category: categories.find((c) => c.id === input.categoryId) };
}

export async function updateCategoryLine(input: {
  benchmarkingId: string;
  lineId: string;
  retailSales?: number | null;
  onlineSales?: number | null;
  grossMarginPct?: number | null;
  inventoryOpen?: number | null;
  inventoryClose?: number | null;
  unitsSold?: number | null;
  unitsAvailable?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const map: Record<string, string> = {
    retailSales: "retail_sales",
    onlineSales: "online_sales",
    grossMarginPct: "gross_margin_pct",
    inventoryOpen: "inventory_open",
    inventoryClose: "inventory_close",
    unitsSold: "units_sold",
    unitsAvailable: "units_available",
  };
  for (const [k, col] of Object.entries(map)) {
    const v = (input as Record<string, unknown>)[k];
    if (v !== undefined) patch[col] = v;
  }

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_category_lines")
    .update(patch)
    .eq("id", input.lineId);

  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

/** Tick, untick, or resize a department's presence at a location. */
export async function setCategoryLocation(input: {
  benchmarkingId: string;
  categoryId: string;
  locationId: string;
  present: boolean;
  sqft?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();

  if (!input.present) {
    await db
      .from("benchmarking_category_locations")
      .delete()
      .eq("category_id", input.categoryId)
      .eq("location_id", input.locationId);
    return { success: true };
  }

  const { error } = await db
    .from("benchmarking_category_locations")
    .upsert(
      {
        category_id: input.categoryId,
        location_id: input.locationId,
        sqft: input.sqft ?? null,
      },
      { onConflict: "category_id,location_id" },
    );

  if (error) return { success: false, error: "Could not save that." };
  return { success: true };
}

/**
 * Who buys for this department.
 *
 * Written to the submission AND to procurement_info.category_buyers, because
 * they are the same fact and 21 stores have already answered it once. The
 * survey should be confirming that, not collecting a rival copy.
 */
export async function setCategoryBuyers(input: {
  benchmarkingId: string;
  categoryId: string;
  department: string;
  contactIds: string[];
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_categories")
    .update({ buyer_contact_ids: input.contactIds, updated_at: new Date().toISOString() })
    .eq("id", input.categoryId)
    .eq("benchmarking_id", input.benchmarkingId);
  if (error) return { success: false, error: "Could not save that." };

  const { data: org } = await db
    .from("organizations")
    .select("procurement_info")
    .eq("id", g.organizationId)
    .maybeSingle();

  const info = ((org?.procurement_info as Record<string, unknown> | null) ?? {});
  const buyers = ((info.category_buyers as { category: string; contact_ids: string[] }[] | undefined) ?? []);
  const others = buyers.filter((b) => b.category !== input.department);
  const next =
    input.contactIds.length > 0
      ? [...others, { category: input.department, contact_ids: input.contactIds }]
      : others;

  await db
    .from("organizations")
    .update({
      procurement_info: { ...info, category_buyers: next },
      updated_at: new Date().toISOString(),
    })
    .eq("id", g.organizationId);

  return { success: true };
}
