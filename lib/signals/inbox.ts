import "server-only";

/**
 * The only door into the signal system.
 *
 * ⛔ THE ACTOR IS NEVER TAKEN FROM THE CALLER.
 *
 * Every function here derives who acted from the server session. If an org id or
 * contact id could be passed in — even by an internal caller, even "just for
 * tests" — then any request that reaches this code can forge "Algonquin searched
 * for X", and the entire behavioural record becomes unusable as evidence of
 * anything. The parameter simply does not exist, so it cannot be supplied.
 *
 * `import "server-only"` makes bundling this into a client component a build
 * error rather than a leak.
 *
 * ── If nothing drains, it accumulates ───────────────────────────────────────
 *
 * Writes go to `public.signal_inbox` and stop there. The Mac drains it when it
 * next runs; until then rows sit with `drained_at` null. The Mac can be asleep
 * for a week and nothing is lost — that is the designed behaviour, and the only
 * thing worth watching is queue depth, not liveness.
 */

import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerAuthState } from "@/lib/auth/server";
import { isKnownVerb } from "./ingest";
import type { SignalSource, SignalVerb, SignalObjectType } from "./types";

/**
 * The act, as observed. No actor — that is resolved here.
 *
 * Deliberately carries NO resolved terms. Resolution happens on the Mac where
 * the resolver version is authoritative and can be re-run across history;
 * resolving at the edge would bake today's vocabulary into a permanent record.
 */
export interface ObservedAct {
  source: SignalSource;
  verb: SignalVerb;
  /** The act's own time. Defaults to now, which is right for live web events. */
  occurredAt?: Date;
  objectType?: SignalObjectType | null;
  /** When the act was toward another org — a profile view, a catalogue click. */
  objectOrgId?: string | null;
  objectRef?: string | null;
  /** The query string, filter label, or excerpt. Kept verbatim, always. */
  rawText?: string | null;
  /**
   * ⚠️ Keyed on the ACT, never the object. Required for anything replayable.
   * `circle:like:{post}:{member}`, not `circle:post:{id}`.
   *
   * Only needs to be unique WITHIN one organisation — `recordAct` prefixes the
   * acting org id, because the caller never learns who the actor is.
   */
  dedupeKey?: string | null;
}

/**
 * ⛔ NEVER RETURN THIS TO A CLIENT.
 *
 * `duplicate` vs `queued` discloses whether a given dedupe_key already exists,
 * which turns any route that forwards it into an oracle: probe a key, learn
 * whether that act happened. `reason` is worse — it carries database messages.
 *
 * Callers log it or ignore it. The HTTP response for recording a signal is the
 * same regardless of outcome, and recording must never change what the user
 * sees, because that difference IS the leak.
 */
export type EnqueueResult =
  | { status: "queued" }
  /** Already seen — a retry, a double-fired effect, a redelivered webhook. */
  | { status: "duplicate" }
  /** Stored, but with no org attached. Still counts as demand; just not as a profile. */
  | { status: "queued-unattributed" }
  /** Refused. `reason` is for logs, never for a response body. */
  | { status: "rejected"; reason: string };

/**
 * The acting person, as a contact at THIS org.
 *
 * ⚠️ Keyed on (profile, organization) — never on profile alone.
 * `contacts.profile_id` is NOT unique: one person can be a contact at more than
 * one org, and collapsing them would attribute a member's search to whichever
 * row happened to come back first.
 *
 * Memoised per request, so a page that records several acts pays for one lookup.
 * Returns null freely — the contact id only enables distinct-person counts, and
 * an act attributed to the org alone is still perfectly good signal.
 */
const contactIdForRequest = cache(
  async (profileId: string, organizationId: string): Promise<string | null> => {
    try {
      const db = createAdminClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (db as any)
        .from("contacts")
        .select("id")
        .eq("profile_id", profileId)
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      return (data as { id?: string } | null)?.id ?? null;
    } catch {
      return null;
    }
  }
);

/** Longest raw string we will store. A query is a phrase, not a document. */
const MAX_RAW_TEXT = 500;

const KNOWN_SOURCES = new Set<string>(["website", "circle", "email", "conference", "print"]);

/**
 * Record one act.
 *
 * ⚠️ NEVER throws and never blocks the caller's real work. A page must still
 * render if the queue is unavailable; losing a signal row is acceptable, failing
 * a member's search because analytics is down is not.
 */
export async function recordAct(act: ObservedAct): Promise<EnqueueResult> {
  try {
    if (!KNOWN_SOURCES.has(act.source)) {
      console.warn(`[signal-inbox] REJECTED unknown source "${act.source}" — signal dropped.`);
      return { status: "rejected", reason: `unknown source "${act.source}"` };
    }

    // ⛔ The VERB is checked at runtime too, and the source check above was not
    // enough on its own. The TypeScript union guards nothing at this boundary: a
    // producer reaching here through a cast, from JavaScript, or with a typo
    // writes a verb nobody defined and the row lands looking perfectly real. It
    // then fails much later in `VERB_PROFILES[verb]` during scoring, a long way
    // from the code that caused it — or, if a future reader guards that lookup,
    // the act silently weighs nothing while the producer appears to work.
    //
    // Rejecting here is the whole point of a single door: a bad row never
    // becomes durable, and the producer is told immediately.
    if (!isKnownVerb(act.verb)) {
      // ⚠️ LOUD, because the caller cannot hear this. Every producer treats
      // recordAct as fire-and-forget and `void`s the result — correctly, since a
      // dropped signal must never break the page a human was actually using. So
      // a rejection is invisible from the producer's side: their emission simply
      // stops existing, and the first sign is an empty table months later.
      //
      // The badge-scan session raised exactly this after the verb check landed:
      // the guard protects the data and hides the mistake. Rejecting silently is
      // worse than not checking, so the check has to announce itself somewhere a
      // human looks.
      console.warn(
        `[signal-inbox] REJECTED unknown verb "${act.verb}" from source "${act.source}" — ` +
        `the producer is emitting a verb that is not in ALL_VERBS and its signal is being dropped.`
      );
      return { status: "rejected", reason: `unknown verb "${act.verb}"` };
    }

    // ── Attribution. Server session only, and OPTIONAL. ────────────────────
    //
    // ⛔ An earlier version returned here without storing anything when nobody
    // was signed in. That threw away most of the traffic on the theory that an
    // unattributed row is noise — but a human still searched for something, and
    // "how many people wanted this" is answerable without knowing who they were.
    // Unattributed rows never reach the org rollups, so they cost the scoring
    // nothing and remain the least sensitive rows in the table.
    const auth = await getServerAuthState();
    const actorOrgId = auth.user ? (auth.organizations[0]?.organization_id ?? null) : null;

    const actorContactId =
      auth.profile?.id && actorOrgId
        ? await contactIdForRequest(auth.profile.id, actorOrgId)
        : null;

    const rawText = act.rawText?.trim().slice(0, MAX_RAW_TEXT) || null;

    // Nothing to score now and nothing to re-resolve later.
    if (!rawText && !act.objectOrgId) {
      return { status: "rejected", reason: "no raw text and no object org" };
    }
    // An org acting on itself is not an affinity — it is someone editing their
    // own profile.
    if (actorOrgId && act.objectOrgId === actorOrgId) {
      return { status: "rejected", reason: "self-directed act" };
    }

    const occurredAt = act.occurredAt ?? new Date();
    // A future timestamp is clock skew or a caller passing ingestion time.
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) {
      return { status: "rejected", reason: "occurredAt is in the future" };
    }

    const db = createAdminClient();
    // `signal_inbox` is not in database.types.ts until the migration lands and
    // types are regenerated — same pattern the rest of lib/actions uses.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("signal_inbox").insert({
      kind: "signal",
      actor_org_id: actorOrgId,
      actor_contact_id: actorContactId,
      // ⛔ Scoped to the acting org, always.
      //
      // The caller cannot do this itself — it never learns who the actor is,
      // because attribution happens here on purpose. So a caller-supplied key
      // like `search:partners:2026-09-01T17:hoodie` is only unique WITHIN one
      // org; unscoped, the first store to search "hoodie" that hour would
      // silently suppress every other store's identical search, and the loss
      // would look exactly like nobody else searching.
      // Scoped to the actor so one org's key cannot suppress another's. An
      // unattributed act is scoped to "anon" — which does mean anonymous
      // searches collapse together within their window, and that is the right
      // trade: without it a single popular query would be recorded once per
      // visitor and drown everything else.
      dedupe_key: act.dedupeKey ? `${actorOrgId ?? "anon"}:${act.dedupeKey}` : null,
      payload: {
        source: act.source,
        verb: act.verb,
        occurred_at: occurredAt.toISOString(),
        object_type: act.objectType ?? null,
        object_org_id: act.objectOrgId ?? null,
        object_ref: act.objectRef ?? null,
        raw_text: rawText,
      },
    });

    if (error) {
      // 23505 — the unique dedupe_key already exists. That is the mechanism
      // working, not a failure.
      if (error.code === "23505") return { status: "duplicate" };
      return { status: "rejected", reason: error.message };
    }

    return actorOrgId ? { status: "queued" } : { status: "queued-unattributed" };
  } catch (e) {
    // Swallowed on purpose. See the warning on this function.
    return { status: "rejected", reason: (e as Error).message };
  }
}

/**
 * How full the queue is, how stale, and whether anyone unexpected drained it.
 *
 * Accumulation is fine; *silent* accumulation is not — a drain that stopped
 * three weeks ago looks exactly like a quiet month unless someone watches the
 * oldest row's age.
 *
 * ⚠️ `claimedBy` is a TRIPWIRE, not diagnostics. Every row present is pending,
 * because a drained row is deleted; a `claimed_by` value that is not the known
 * drain machine means a second party holds a working credential and is reading
 * this queue. That is the signal a stolen credential produces, and it is the
 * only one this design gets for free.
 */
export async function inboxDepth(): Promise<{
  pending: number;
  oldestPendingAt: string | null;
  claimedBy: string[];
}> {
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = db as any;

  const [{ count: pending }, { data: oldest }, { data: claimers }] = await Promise.all([
    q.from("signal_inbox").select("id", { count: "exact", head: true }),
    q
      .from("signal_inbox")
      .select("received_at")
      .order("received_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    q.from("signal_inbox").select("claimed_by").not("claimed_by", "is", null).limit(1000),
  ]);

  const claimedBy = [
    ...new Set(
      ((claimers ?? []) as { claimed_by: string | null }[])
        .map((r) => r.claimed_by)
        .filter((v): v is string => !!v)
    ),
  ];

  return {
    pending: pending ?? 0,
    oldestPendingAt: (oldest as { received_at?: string } | null)?.received_at ?? null,
    claimedBy,
  };
}
