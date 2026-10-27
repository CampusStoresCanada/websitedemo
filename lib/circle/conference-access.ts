// ---------------------------------------------------------------------------
// Conference pass holders (and survey answers) → private Circle spaces
//
// Rules live in `circle_space_rules` (edited at /admin/circle/spaces; see
// lib/circle/space-rules.ts). A conference-pass rule (e.g. All Conference,
// Members Only) keeps a space's members in step with the people holding a
// matching pass:
//
//   - pass holder with a Circle account, not in the space → add_to_space
//   - someone THIS JOB added who no longer holds a pass    → remove_from_space
//   - pass holder with no Circle account                   → skipped (never created
//     here; conference-only contacts deliberately get no Circle account)
//
// Removal is limited to people this job added (its completed add_to_space rows
// in circle_sync_queue). Staff, moderators and anyone added by hand are never
// removed: the space's roster alone cannot tell them apart from a lapsed holder.
//
// It is a reconciler, not a hook on registration, because seats are assigned from
// many paths (checkout, desk sale, swaps, staff, travel import). Reading the seat
// table catches all of them, backfills, and heals a failed queue job.
//
// API cost per run: one paged roster read per space. Everything else is DB reads
// and queue rows; the circle-sync cron does the actual Circle calls.
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";
import { enqueueCircleSync } from "@/lib/circle/sync";
import { loadSeatHoldings, type SeatHolding } from "@/lib/conference/seats";
import {
  parseRuleRow,
  SPACE_RULE_COLUMNS,
  type ConferencePassRule,
  type RuleLastRun,
  type SpaceRule,
  type SpaceRuleRow,
  type SurveyAnswerRule,
} from "@/lib/circle/space-rules";

export type HolderContact = { contactId: string; email: string; circleId: string };

const IN_CHUNK = 150; // PostgREST .in() fails past ~200 ids

const addKey = (spaceId: number, contactId: string, bucket: string) =>
  `conf-space-add-${spaceId}-${contactId}-${bucket}`;
const removeKey = (spaceId: number, contactId: string, bucket: string) =>
  `conf-space-remove-${spaceId}-${contactId}-${bucket}`;

/** Contact ids holding a pass that qualifies for this rule. */
export function qualifyingContactIds(
  seats: SeatHolding[],
  rule: Pick<ConferencePassRule, "passEntityIds">
): Set<string> {
  const allowed = rule.passEntityIds ? new Set(rule.passEntityIds) : null;
  const out = new Set<string>();
  for (const s of seats) {
    if (s.entityKind !== "registration" || !s.holderContactId) continue;
    if (allowed && !allowed.has(s.entityId)) continue;
    out.add(s.holderContactId);
  }
  return out;
}

/**
 * Contacts this job currently has "in" a space: the last completed act per
 * contact, read from its own queue rows, was an add. Keys sort by the hour
 * bucket suffix, so the caller passes rows ordered oldest → newest.
 */
export function contactsWeAdded(
  rows: { idempotency_key: string | null }[],
  spaceId: number
): Set<string> {
  const addPrefix = `conf-space-add-${spaceId}-`;
  const removePrefix = `conf-space-remove-${spaceId}-`;
  const state = new Map<string, boolean>();
  for (const r of rows) {
    const k = r.idempotency_key ?? "";
    const isAdd = k.startsWith(addPrefix);
    if (!isAdd && !k.startsWith(removePrefix)) continue;
    // contact ids are uuids (36 chars) directly after the prefix
    const contactId = k.slice((isAdd ? addPrefix : removePrefix).length).slice(0, 36);
    if (contactId.length === 36) state.set(contactId, isAdd);
  }
  return new Set([...state].filter(([, added]) => added).map(([id]) => id));
}

/**
 * Who to add and who to remove. Compared on circle_id, never contact id: one
 * person can have several contacts (one per org) sharing a Circle account.
 */
export function diffSpace(
  wanted: HolderContact[],
  rosterCircleIds: Set<string>,
  addedByUs: HolderContact[]
): { toAdd: HolderContact[]; toRemove: HolderContact[] } {
  const wantedCircleIds = new Set(wanted.map((w) => w.circleId));
  const seen = new Set<string>();
  const toAdd: HolderContact[] = [];
  for (const w of wanted) {
    if (rosterCircleIds.has(w.circleId) || seen.has(w.circleId)) continue;
    seen.add(w.circleId);
    toAdd.push(w);
  }
  const removing = new Set<string>();
  const toRemove: HolderContact[] = [];
  for (const a of addedByUs) {
    if (wantedCircleIds.has(a.circleId) || !rosterCircleIds.has(a.circleId) || removing.has(a.circleId)) continue;
    removing.add(a.circleId);
    toRemove.push(a);
  }
  return { toAdd, toRemove };
}

type SpaceResult = {
  conference: string;
  label: string;
  spaceId: number;
  holders: number;
  noCircleAccount: number;
  inSpace: number;
  queuedAdds: number;
  /** Refused by Circle in the last day (usually an unaccepted invite). */
  waitingOnInvite: number;
  queuedRemoves: number;
};

type Db = ReturnType<typeof createAdminClient>;

async function loadContacts(
  db: Db,
  ids: string[]
): Promise<Map<string, HolderContact> | string> {
  const out = new Map<string, HolderContact>();
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const { data, error } = await db
      .from("contacts")
      .select("id, email, circle_id")
      .in("id", ids.slice(i, i + IN_CHUNK));
    if (error) return error.message;
    for (const c of data ?? []) {
      if (c.email && c.circle_id) out.set(c.id, { contactId: c.id, email: c.email, circleId: String(c.circle_id) });
    }
  }
  return out;
}

type Ctx = {
  db: Db;
  client: NonNullable<ReturnType<typeof getCircleClient>>;
  bucket: string;
  result: { spaces: SpaceResult[]; errors: string[] };
};

/**
 * Save what a rule did on this run, so /admin/circle/spaces can show it. A
 * failed write only costs the screen its numbers, never the sync itself.
 */
async function recordRun(ctx: Ctx, rule: SpaceRule, lastRun: RuleLastRun): Promise<void> {
  const { error } = await ctx.db
    .from("circle_space_rules")
    .update({ last_run: lastRun, last_run_at: new Date().toISOString() })
    .eq("id", rule.id);
  if (error) ctx.result.errors.push(`${rule.label}: could not record the run: ${error.message}`);
}

async function failRule(ctx: Ctx, rule: SpaceRule, message: string): Promise<void> {
  ctx.result.errors.push(message);
  await recordRun(ctx, rule, { error: message });
}

/**
 * Bring one space in step with the contacts who qualify for it. Shared by every
 * source of "who belongs here" (conference passes, survey answers): only the
 * qualifying list differs, the add/remove ledger is the same.
 */
async function syncOneSpace(
  ctx: Ctx,
  source: string,
  rule: SpaceRule,
  qualifying: Set<string>,
  contacts: Map<string, HolderContact>
): Promise<void> {
  const { db, client, bucket, result } = ctx;
  const where = `${source} / ${rule.label}`;
  const wanted: HolderContact[] = [];
  let noCircleAccount = 0;
  for (const id of qualifying) {
    const c = contacts.get(id);
    if (c) wanted.push(c);
    else noCircleAccount++;
  }

  let roster: Set<string>;
  try {
    roster = new Set((await client.listSpaceMemberIds(rule.spaceId)).map(String));
  } catch (e) {
    // Never diff against a roster we could not read: it would re-add everyone.
    await failRule(ctx, rule, `${where}: roster read failed: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const { data: ours, error: oursErr } = await db
    .from("circle_sync_queue")
    .select("idempotency_key")
    .eq("status", "completed")
    .like("idempotency_key", `conf-space-%-${rule.spaceId}-%`)
    .order("created_at", { ascending: true });
  if (oursErr) {
    await failRule(ctx, rule, `${where}: could not read past adds: ${oursErr.message}`);
    return;
  }
  const addedIds = [...contactsWeAdded(ours ?? [], rule.spaceId)];
  const added = await loadContacts(db, addedIds);
  if (typeof added === "string") {
    await failRule(ctx, rule, `${where}: could not load past adds: ${added}`);
    return;
  }

  const { toAdd: diffAdds, toRemove } = diffSpace(wanted, roster, [...added.values()]);

  // Circle refuses (422) to add someone who never accepted their community
  // invite. Retrying every hour just repeats the refusal, so after one, wait a
  // day: once they accept, the next day's run adds them.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: refused, error: refusedErr } = await db
    .from("circle_sync_queue")
    .select("entity_id")
    .eq("status", "failed")
    .eq("operation", "add_to_space")
    .like("idempotency_key", `conf-space-add-${rule.spaceId}-%`)
    .gte("created_at", since);
  if (refusedErr) {
    await failRule(ctx, rule, `${where}: could not read recent refusals: ${refusedErr.message}`);
    return;
  }
  const recentlyRefused = new Set((refused ?? []).map((r) => r.entity_id));
  const toAdd = diffAdds.filter((w) => !recentlyRefused.has(w.contactId));

  for (const w of toAdd) {
    await enqueueCircleSync({
      operation: "add_to_space",
      entityType: "contact",
      entityId: w.contactId,
      payload: { spaceId: rule.spaceId, email: w.email },
      idempotencyKey: addKey(rule.spaceId, w.contactId, bucket),
    });
  }
  for (const r of toRemove) {
    await enqueueCircleSync({
      operation: "remove_from_space",
      entityType: "contact",
      entityId: r.contactId,
      payload: { spaceId: rule.spaceId, email: r.email },
      idempotencyKey: removeKey(rule.spaceId, r.contactId, bucket),
    });
  }

  const counts = {
    holders: qualifying.size,
    noCircleAccount,
    inSpace: roster.size,
    queuedAdds: toAdd.length,
    waitingOnInvite: diffAdds.length - toAdd.length,
    queuedRemoves: toRemove.length,
  };
  result.spaces.push({ conference: source, label: rule.label, spaceId: rule.spaceId, ...counts });
  await recordRun(ctx, rule, counts);
}

// ---------------------------------------------------------------------------
// Survey-answer spaces: everyone at a school whose latest submitted benchmarking
// answer includes a value (e.g. Bookware users). Read-only on benchmarking.
// ---------------------------------------------------------------------------

/** Current members. Deliberately narrower than ACCESS_ACTIVE_STATUSES: no grace. */
const CURRENT_MEMBER_STATUSES = ["active", "reactivated"] as const;

/**
 * Orgs whose most recent submitted (non-draft) survey answer includes the value.
 * A school that answers something else in a newer survey drops out, so its
 * people are removed on the next run.
 */
export function orgsMatchingLatestAnswer(
  rows: { organization_id: string | null; fiscal_year: number | null; status: string | null; answer: string[] | null }[],
  value: string
): Set<string> {
  const latest = new Map<string, { year: number; answer: string[] | null }>();
  for (const r of rows) {
    if (!r.organization_id || r.fiscal_year == null || r.status === "draft" || r.answer == null) continue;
    const cur = latest.get(r.organization_id);
    if (!cur || r.fiscal_year > cur.year) latest.set(r.organization_id, { year: r.fiscal_year, answer: r.answer });
  }
  return new Set([...latest].filter(([, l]) => l.answer?.includes(value)).map(([org]) => org));
}

async function syncSurveySpace(ctx: Ctx, rule: SurveyAnswerRule): Promise<void> {
  const { db } = ctx;
  // rule.field is one of SURVEY_ARRAY_FIELDS (checked by parseRuleRow).
  const { data: rows, error } = await db
    .from("benchmarking")
    .select(`organization_id, fiscal_year, status, answer:${rule.field}`);
  if (error) {
    await failRule(ctx, rule, `Survey / ${rule.label}: could not read answers: ${error.message}`);
    return;
  }
  const answered = [...orgsMatchingLatestAnswer((rows ?? []) as never, rule.value)];

  // Current members only: a school that cancels or lapses drops out of the
  // space even if its survey answer still says it uses the system.
  const orgIds: string[] = [];
  for (let i = 0; i < answered.length; i += IN_CHUNK) {
    const { data, error: oErr } = await db
      .from("organizations")
      .select("id")
      .in("id", answered.slice(i, i + IN_CHUNK))
      .in("membership_status", CURRENT_MEMBER_STATUSES);
    if (oErr) {
      await failRule(ctx, rule, `Survey / ${rule.label}: could not load schools: ${oErr.message}`);
      return;
    }
    orgIds.push(...(data ?? []).map((o) => o.id));
  }

  const qualifying = new Set<string>();
  const contacts = new Map<string, HolderContact>();
  for (let i = 0; i < orgIds.length; i += IN_CHUNK) {
    const { data, error: cErr } = await db
      .from("contacts")
      .select("id, email, circle_id")
      .in("organization_id", orgIds.slice(i, i + IN_CHUNK))
      .is("archived_at", null);
    // A partial list would read as "these people left" and remove them.
    if (cErr) {
      await failRule(ctx, rule, `Survey / ${rule.label}: could not load contacts: ${cErr.message}`);
      return;
    }
    for (const c of data ?? []) {
      qualifying.add(c.id);
      if (c.email && c.circle_id) contacts.set(c.id, { contactId: c.id, email: c.email, circleId: String(c.circle_id) });
    }
  }

  await syncOneSpace(ctx, "Survey", rule, qualifying, contacts);
}

async function syncConferenceSpaces(ctx: Ctx, rules: ConferencePassRule[]): Promise<void> {
  const { db } = ctx;
  const byConference = new Map<string, ConferencePassRule[]>();
  for (const r of rules) byConference.set(r.conferenceId, [...(byConference.get(r.conferenceId) ?? []), r]);
  if (byConference.size === 0) return;

  const { data: confs, error } = await db
    .from("conference_instances")
    .select("id, name, end_date")
    .in("id", [...byConference.keys()]);
  if (error) {
    for (const r of rules) await failRule(ctx, r, `Could not load conferences: ${error.message}`);
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  for (const conf of confs ?? []) {
    const confRules = byConference.get(conf.id) ?? [];
    // An ended conference's spaces are left as they are: nobody is added or removed.
    if (conf.end_date && conf.end_date < today) {
      for (const r of confRules) await recordRun(ctx, r, { error: `${conf.name} has ended; the space is no longer synced.` });
      continue;
    }

    let seats: SeatHolding[];
    try {
      ({ seats } = await loadSeatHoldings(db, {
        conferenceId: conf.id,
        assigned: true,
        entityKinds: ["registration"],
      }));
    } catch (e) {
      for (const r of confRules) await failRule(ctx, r, `${conf.name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    const holderIds = [...new Set(seats.map((s) => s.holderContactId).filter((x): x is string => !!x))];
    const holders = await loadContacts(db, holderIds);
    // A partial contact list would read as "these people left" and remove them.
    if (typeof holders === "string") {
      for (const r of confRules) await failRule(ctx, r, `${conf.name}: could not load holder contacts: ${holders}`);
      continue;
    }

    for (const rule of confRules) {
      await syncOneSpace(ctx, conf.name, rule, qualifyingContactIds(seats, rule), holders);
    }
  }
}

export async function runConferenceCircleAccessSync(): Promise<{
  spaces: SpaceResult[];
  errors: string[];
}> {
  const result = { spaces: [] as SpaceResult[], errors: [] as string[] };
  if (!isCircleConfigured()) return result;
  const client = getCircleClient();
  if (!client) return result;

  const db = createAdminClient();
  // Hour bucket: a pending job blocks a duplicate within the hour, but a person
  // removed and later re-added can still be queued again.
  const ctx: Ctx = { db, client, bucket: new Date().toISOString().slice(0, 13), result };

  const { data: rows, error } = await db.from("circle_space_rules").select(SPACE_RULE_COLUMNS);
  if (error) {
    result.errors.push(`Could not load space rules: ${error.message}`);
    return result;
  }

  const conferenceRules: ConferencePassRule[] = [];
  const surveyRules: SurveyAnswerRule[] = [];
  for (const row of (rows ?? []) as SpaceRuleRow[]) {
    const rule = parseRuleRow(row);
    if (typeof rule === "string") {
      result.errors.push(`${row.label}: ${rule}`);
      continue;
    }
    if (rule.kind === "conference_passes") conferenceRules.push(rule);
    else surveyRules.push(rule);
  }

  await syncConferenceSpaces(ctx, conferenceRules);
  for (const rule of surveyRules) await syncSurveySpace(ctx, rule);
  return result;
}
