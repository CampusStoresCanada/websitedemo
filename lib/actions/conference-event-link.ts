"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { createEvent, updateEvent } from "@/lib/actions/events";
import { buildEntityGraph, ENTITY_SELECT } from "@/lib/conference/entity-rows";
import { effectiveAttributes, effectiveRefs } from "@/lib/conference/entity-graph";
import { zonedWallTimeToUtcIso } from "@/lib/conference/tz";
import { deriveDefaultAudienceMode } from "@/lib/events/conference-link";

/**
 * Links a conference catalog entity (event/session/meeting/networking) to
 * the general Events system for RSVP, waitlist, check-in, and Circle sync —
 * see the plan doc for why this exists. Both authoring directions (Build
 * tool and the Events admin form) converge on the same `conference_entity_id`
 * column; neither system's data is duplicated.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

const LINKABLE_KINDS = ["event", "session", "meeting", "networking"];

async function loadEntityGraph(conferenceId: string) {
  const db = createAdminClient();
  const [{ data: entityRows }, { data: refRows }] = await Promise.all([
    db.from("conference_entities").select(ENTITY_SELECT).eq("conference_id", conferenceId),
    db
      .from("conference_entity_refs")
      .select("from_entity_id, to_entity_id, role, quantity")
      .eq("conference_id", conferenceId),
  ]);
  return buildEntityGraph(entityRows ?? [], refRows ?? []);
}

/** Build tool → Events. Auto-fills a new draft Events row from a catalog entity's own fields. */
export async function createLinkedEventFromEntity(
  conferenceEntityId: string
): Promise<Result<{ eventId: string; slug: string }>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: row } = await db
    .from("conference_entities")
    .select("id, conference_id, kind")
    .eq("id", conferenceEntityId)
    .maybeSingle();
  if (!row) return { success: false, error: "Entity not found" };
  if (!LINKABLE_KINDS.includes(row.kind)) {
    return { success: false, error: `Kind "${row.kind}" can't be linked to Events` };
  }

  const entities = await loadEntityGraph(row.conference_id);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const entity = byId.get(conferenceEntityId);
  if (!entity) return { success: false, error: "Entity not found in graph" };

  const attrs = effectiveAttributes(entity, byId);
  const refs = effectiveRefs(entity, byId);

  const dayRef = refs.find((r) => r.role === "when");
  const dayEntity = dayRef ? byId.get(dayRef.toEntityId) : undefined;
  const dateYmd = dayEntity ? effectiveAttributes(dayEntity, byId).date : null;
  if (!dateYmd || typeof dateYmd !== "string") {
    return { success: false, error: "This needs a When (day) reference before it can become an RSVPable event." };
  }

  const { data: conference } = await db
    .from("conference_instances")
    .select("timezone")
    .eq("id", row.conference_id)
    .maybeSingle();
  const timeZone = conference?.timezone?.trim() || "America/Toronto";

  const startTime = typeof attrs.start_time === "string" ? attrs.start_time : "00:00";
  const endTime = typeof attrs.end_time === "string" ? attrs.end_time : undefined;

  const startsAt = zonedWallTimeToUtcIso(dateYmd, startTime, timeZone);
  const endsAt = endTime ? zonedWallTimeToUtcIso(dateYmd, endTime, timeZone) : undefined;

  const whereRef = refs.find((r) => r.role === "where");
  const whoNames = refs.filter((r) => r.role === "who").map((r) => r.toName);
  const virtualLink = typeof attrs.virtual_link === "string" ? attrs.virtual_link.trim() : "";

  const result = await createEvent({
    title: entity.name,
    description: typeof attrs.summary === "string" ? attrs.summary : undefined,
    body_html: typeof attrs.purpose === "string" ? attrs.purpose : undefined,
    starts_at: startsAt,
    ends_at: endsAt,
    location: whereRef?.toName ?? undefined,
    virtual_link: virtualLink || undefined,
    is_virtual: Boolean(virtualLink),
    audience_mode: deriveDefaultAudienceMode(whoNames),
    conference_entity_id: conferenceEntityId,
  });

  if (!result.success) return result;
  return { success: true, data: { eventId: result.data.id, slug: result.data.slug } };
}

/** Events form → Build tool. Links an already-existing Events row to a catalog entity. */
export async function linkExistingEventToEntity(eventId: string, conferenceEntityId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await updateEvent(eventId, { conference_entity_id: conferenceEntityId });
  if (!result.success) return result;
  return { success: true, data: null };
}

export async function unlinkEvent(eventId: string): Promise<Result<null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };
  const result = await updateEvent(eventId, { conference_entity_id: null });
  if (!result.success) return result;
  return { success: true, data: null };
}

/** Entities eligible for the Events-form picker — not already linked to a *different* event. */
export async function listLinkableConferenceEntities(
  conferenceId: string,
  currentEventId?: string
): Promise<Result<Array<{ id: string; name: string; kind: string }>>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const [{ data: entityRows }, { data: linkedRows }] = await Promise.all([
    db.from("conference_entities").select("id, name, kind").eq("conference_id", conferenceId).in("kind", LINKABLE_KINDS),
    db.from("events").select("id, conference_entity_id").not("conference_entity_id", "is", null),
  ]);

  const linkedElsewhereIds = new Set(
    (linkedRows ?? []).filter((r) => r.id !== currentEventId).map((r) => r.conference_entity_id).filter(Boolean)
  );

  const data = (entityRows ?? [])
    .filter((e) => !linkedElsewhereIds.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, kind: e.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { success: true, data };
}

/** For displaying an already-linked event's "linked to X in Y" state in the Events form. */
export async function getLinkedConferenceEntityInfo(
  conferenceEntityId: string
): Promise<Result<{ conferenceId: string; conferenceName: string; entityName: string; entityKind: string } | null>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data: entity } = await db
    .from("conference_entities")
    .select("name, kind, conference_id")
    .eq("id", conferenceEntityId)
    .maybeSingle();
  if (!entity) return { success: true, data: null };

  const { data: conference } = await db
    .from("conference_instances")
    .select("name, year")
    .eq("id", entity.conference_id)
    .maybeSingle();

  return {
    success: true,
    data: {
      conferenceId: entity.conference_id,
      conferenceName: conference ? `${conference.name} (${conference.year})` : "Unknown conference",
      entityName: entity.name,
      entityKind: entity.kind,
    },
  };
}

export async function listConferencesForLinking(): Promise<Result<Array<{ id: string; name: string }>>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const db = createAdminClient();
  const { data, error } = await db
    .from("conference_instances")
    .select("id, name, year")
    .order("year", { ascending: false });

  if (error) return { success: false, error: error.message };
  return { success: true, data: (data ?? []).map((c) => ({ id: c.id, name: `${c.name} (${c.year})` })) };
}
