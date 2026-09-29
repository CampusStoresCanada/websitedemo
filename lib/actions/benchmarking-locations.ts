"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

/**
 * Square footage, asked per location.
 *
 * It used to be four boxes for the whole store plus a total, which asked a
 * multi-site store to add its own sites together before answering and then
 * asked for the total again separately. Now each location is a row, each
 * carries its own measurements, and the store-level sqft_* columns are the
 * ROLL-UP rather than the question — so every existing reader (sales per square
 * foot, the comparison cuts, the exports) keeps working untouched.
 *
 * Location names are INTERNAL. "Interurban" and "Lansdowne" mean something to
 * Camosun and nothing to anyone else; they appear in that store's own results
 * and on no public page, and the form says so.
 */

export interface OtherSpace {
  id: string;
  description: string;
  sqft: number | null;
}

// ⛔ LocationKind and LOCATION_KINDS live in lib/benchmarking/location-kinds.ts.
// This file is "use server" and may only export async functions — a const here
// type-checks, passes every test, and 500s the survey page at runtime.
import type { LocationKind } from "@/lib/benchmarking/location-kinds";
import type { LocationHours } from "@/lib/benchmarking/key-dates";

export interface SurveyLocation {
  id: string;
  name: string;
  kind: LocationKind | null;
  kindOther: string | null;
  /** Permanent locations only — a seasonal pop-up's hours describe nothing. */
  hours: LocationHours | null;
  hoursVarySeasonally: boolean | null;
  salesFloor: number | null;
  storage: number | null;
  office: number | null;
  otherSpaces: OtherSpace[];
}

export async function loadLocations(benchmarkingId: string): Promise<SurveyLocation[]> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return [];

  const db = createAdminClient();
  const { data } = await db
    .from("benchmarking_locations")
    .select(
      "id, name, kind, kind_other, hours, hours_vary_seasonally, sqft_salesfloor, sqft_storage, sqft_office, position, benchmarking_location_other_spaces(id, description, sqft, position)",
    )
    .eq("benchmarking_id", benchmarkingId)
    .order("position");

  return (data ?? []).map((l) => ({
    id: l.id as string,
    name: (l.name as string) ?? "",
    kind: ((l.kind as string | null) ?? null) as LocationKind | null,
    kindOther: (l.kind_other as string | null) ?? null,
    hours: ((l.hours as LocationHours | null) ?? null),
    hoursVarySeasonally: (l.hours_vary_seasonally as boolean | null) ?? null,
    salesFloor: (l.sqft_salesfloor as number | null) ?? null,
    storage: (l.sqft_storage as number | null) ?? null,
    office: (l.sqft_office as number | null) ?? null,
    otherSpaces: (
      (l.benchmarking_location_other_spaces ?? []) as unknown as {
        id: string;
        description: string;
        sqft: number | null;
        position: number;
      }[]
    )
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, description: o.description ?? "", sqft: o.sqft ?? null })),
  }));
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

  if (isGlobalAdmin(auth.ctx.globalRole)) {
    return { ok: true, organizationId: row.organization_id as string };
  }
  // The delegate named on this submission may edit it — same rule the survey
  // page uses to let them in at all.
  if (row.respondent_delegate_profile_id === auth.ctx.userId) {
    return { ok: true, organizationId: row.organization_id as string };
  }

  const { data: link } = await db
    .from("user_organizations")
    .select("role")
    .eq("user_id", auth.ctx.userId)
    .eq("organization_id", row.organization_id as string)
    .eq("status", "active")
    .maybeSingle();

  if (link?.role !== "org_admin") return { ok: false, error: "Not your store." };
  return { ok: true, organizationId: row.organization_id as string };
}

/**
 * Push the per-location figures up into the store-level columns.
 *
 * Everything downstream — sales per square foot, the comparison cuts, the
 * exports, the printable worksheet — reads sqft_salesfloor and friends on
 * `benchmarking`. Keeping them as a derived roll-up means none of that has to
 * know locations exist, and a single-site store's numbers are identical either
 * way.
 */
async function rollUp(benchmarkingId: string): Promise<void> {
  const db = createAdminClient();
  const { data: locations } = await db
    .from("benchmarking_locations")
    .select("id, sqft_salesfloor, sqft_storage, sqft_office")
    .eq("benchmarking_id", benchmarkingId);

  const ids = (locations ?? []).map((l) => l.id as string);
  const { data: others } = ids.length
    ? await db
        .from("benchmarking_location_other_spaces")
        .select("sqft")
        .in("location_id", ids)
    : { data: [] as { sqft: number | null }[] };

  const sum = (ns: (number | null | undefined)[]) => {
    const present = ns.filter((n): n is number => typeof n === "number");
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
  };

  const salesfloor = sum((locations ?? []).map((l) => l.sqft_salesfloor as number | null));
  const storage = sum((locations ?? []).map((l) => l.sqft_storage as number | null));
  const office = sum((locations ?? []).map((l) => l.sqft_office as number | null));
  const other = sum((others ?? []).map((o) => o.sqft as number | null));

  const parts = [salesfloor, storage, office, other];
  const total = parts.some((p) => p !== null) ? sum(parts) : null;

  await db
    .from("benchmarking")
    .update({
      sqft_salesfloor: salesfloor,
      sqft_storage: storage,
      sqft_office: office,
      sqft_other: other,
      total_square_footage: total,
      /*
        Counted, not declared.

        This was briefly a question the store answered, with a cross-check
        against the rows. That only earned its keep while the locations block
        was buried and easy to miss; now that describing them IS the section,
        stating a number as well is asking twice for the same fact — and the
        answer that matters is the one backed by a described location.
      */
      num_store_locations: (locations ?? []).length || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", benchmarkingId);
}

export async function addLocation(
  benchmarkingId: string,
  name: string,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const g = await guard(benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!name.trim()) return { success: false, error: "Give the location a name." };

  const db = createAdminClient();
  const { count } = await db
    .from("benchmarking_locations")
    .select("id", { count: "exact", head: true })
    .eq("benchmarking_id", benchmarkingId);

  const { data, error } = await db
    .from("benchmarking_locations")
    .insert({ benchmarking_id: benchmarkingId, name: name.trim(), position: count ?? 0 })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add that location." };
  await rollUp(benchmarkingId);
  return { success: true, id: data.id as string };
}

export async function updateLocation(input: {
  benchmarkingId: string;
  locationId: string;
  name?: string;
  kind?: LocationKind | null;
  kindOther?: string | null;
  hours?: LocationHours | null;
  hoursVarySeasonally?: boolean | null;
  salesFloor?: number | null;
  storage?: number | null;
  office?: number | null;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.kind !== undefined) patch.kind = input.kind;
  if (input.kindOther !== undefined) patch.kind_other = input.kindOther?.trim() || null;
  if (input.hours !== undefined) patch.hours = input.hours;
  if (input.hoursVarySeasonally !== undefined)
    patch.hours_vary_seasonally = input.hoursVarySeasonally;
  if (input.salesFloor !== undefined) patch.sqft_salesfloor = input.salesFloor;
  if (input.storage !== undefined) patch.sqft_storage = input.storage;
  if (input.office !== undefined) patch.sqft_office = input.office;

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_locations")
    .update(patch)
    .eq("id", input.locationId)
    .eq("benchmarking_id", input.benchmarkingId);

  if (error) return { success: false, error: "Could not save that." };
  await rollUp(input.benchmarkingId);
  return { success: true };
}

export async function removeLocation(
  benchmarkingId: string,
  locationId: string,
): Promise<{ success: boolean; error?: string }> {
  const g = await guard(benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_locations")
    .delete()
    .eq("id", locationId)
    .eq("benchmarking_id", benchmarkingId);

  if (error) return { success: false, error: "Could not remove that location." };
  await rollUp(benchmarkingId);
  return { success: true };
}

export async function upsertOtherSpace(input: {
  benchmarkingId: string;
  locationId: string;
  otherSpaceId?: string;
  description: string;
  sqft: number | null;
}): Promise<{ success: boolean; error?: string; id?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };
  if (!input.description.trim()) {
    return { success: false, error: "Say what the space is used for." };
  }

  const db = createAdminClient();

  if (input.otherSpaceId) {
    const { error } = await db
      .from("benchmarking_location_other_spaces")
      .update({ description: input.description.trim(), sqft: input.sqft })
      .eq("id", input.otherSpaceId)
      .eq("location_id", input.locationId);
    if (error) return { success: false, error: "Could not save that." };
    await rollUp(input.benchmarkingId);
    return { success: true, id: input.otherSpaceId };
  }

  const { count } = await db
    .from("benchmarking_location_other_spaces")
    .select("id", { count: "exact", head: true })
    .eq("location_id", input.locationId);

  const { data, error } = await db
    .from("benchmarking_location_other_spaces")
    .insert({
      location_id: input.locationId,
      description: input.description.trim(),
      sqft: input.sqft,
      position: count ?? 0,
    })
    .select("id")
    .single();

  if (error || !data) return { success: false, error: "Could not add that space." };
  await rollUp(input.benchmarkingId);
  return { success: true, id: data.id as string };
}

export async function removeOtherSpace(input: {
  benchmarkingId: string;
  otherSpaceId: string;
}): Promise<{ success: boolean; error?: string }> {
  const g = await guard(input.benchmarkingId);
  if (!g.ok) return { success: false, error: g.error };

  const db = createAdminClient();
  const { error } = await db
    .from("benchmarking_location_other_spaces")
    .delete()
    .eq("id", input.otherSpaceId);

  if (error) return { success: false, error: "Could not remove that." };
  await rollUp(input.benchmarkingId);
  return { success: true };
}
