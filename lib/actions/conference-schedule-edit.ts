"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createEntity,
  deleteEntity,
  setEntityReferences,
  updateEntity,
  type EntityAttributes,
} from "./conference-entities";

/**
 * Schedule-tab editing over the v3 catalog. The timeline edits the same
 * entities Build does — this just bundles the catalog primitives (create/update
 * + ref replacement) into one "save a scheduled thing" call, preserving the
 * structural refs the schedule view doesn't touch (includes / involved_in /
 * instance_of) while swapping the scheduling ones (when / where / who).
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

const SCHEDULING_ROLES = new Set(["when", "where", "who"]);

export type ScheduleItemInput = {
  /** Present = update, absent = create. */
  id?: string;
  kind: string;
  name: string;
  /** `when` target — a Day (or another timed thing) the item is anchored to. */
  whenId: string | null;
  startTime: string | null; // "HH:MM"
  endTime: string | null;
  description: string | null;
  /** `where` target venue, or null to clear. */
  whereId: string | null;
  /** A new venue to create and link as `where` (used when whereId is null). */
  newVenueName?: string | null;
  /** `who` audience targets. */
  whoIds: string[];
};

export async function saveScheduleItem(
  conferenceId: string,
  input: ScheduleItemInput
): Promise<Result<{ id: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  if (!input.name.trim()) return { success: false, error: "Give the item a name." };
  if (!input.kind.trim()) return { success: false, error: "Give the item a kind." };

  const db = createAdminClient();

  // Load existing attributes + structural refs to preserve them.
  let baseAttrs: Record<string, unknown> = {};
  const preservedRefs: Array<{ toEntityId: string; role: string; quantity?: number | null }> = [];
  if (input.id) {
    const { data: ent } = await db
      .from("conference_entities")
      .select("attributes")
      .eq("id", input.id)
      .maybeSingle();
    baseAttrs = (ent?.attributes ?? {}) as Record<string, unknown>;
    const { data: refRows } = await db
      .from("conference_entity_refs")
      .select("to_entity_id, role, quantity")
      .eq("from_entity_id", input.id);
    for (const r of refRows ?? []) {
      if (SCHEDULING_ROLES.has(r.role)) continue;
      preservedRefs.push({ toEntityId: r.to_entity_id, role: r.role, quantity: r.quantity });
    }
  }

  // Merge scalar attributes (updateEntity replaces the whole bag).
  const attrs: Record<string, unknown> = { ...baseAttrs };
  if (input.startTime) attrs.start_time = input.startTime;
  else delete attrs.start_time;
  if (input.endTime) attrs.end_time = input.endTime;
  else delete attrs.end_time;
  if (input.description != null) {
    // Write back to whichever description key the item already used.
    const key = "purpose" in baseAttrs && !("notes" in baseAttrs) ? "purpose" : "notes";
    if (input.description.trim()) attrs[key] = input.description.trim();
    else delete attrs[key];
  }

  // Create or update the entity.
  let id = input.id;
  if (!id) {
    const res = await createEntity(conferenceId, {
      kind: input.kind,
      name: input.name,
      attributes: attrs as EntityAttributes,
    });
    if (!res.success) return res;
    id = res.data.id;
  } else {
    const res = await updateEntity(id, {
      kind: input.kind,
      name: input.name,
      attributes: attrs as EntityAttributes,
    });
    if (!res.success) return res;
  }

  // Resolve / create the `where` venue.
  let whereId = input.whereId;
  if (!whereId && input.newVenueName?.trim()) {
    const venueRes = await createEntity(conferenceId, {
      kind: "venue",
      name: input.newVenueName,
    });
    if (!venueRes.success) return venueRes;
    whereId = venueRes.data.id;
  }

  // Rebuild refs: preserved structural refs + the scheduling ones.
  const refs = [...preservedRefs];
  if (input.whenId) refs.push({ toEntityId: input.whenId, role: "when" });
  if (whereId) refs.push({ toEntityId: whereId, role: "where" });
  for (const whoId of input.whoIds) refs.push({ toEntityId: whoId, role: "who" });

  const refRes = await setEntityReferences(conferenceId, id, refs);
  if (!refRes.success) return refRes;

  return { success: true, data: { id } };
}

export async function deleteScheduleItem(entityId: string): Promise<Result<null>> {
  // deleteEntity already guards (requireAdmin) and cascades refs.
  return deleteEntity(entityId);
}
