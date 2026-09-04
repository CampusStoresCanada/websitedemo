import "server-only";

/**
 * Who to email about an open question, from the match engine's ranking.
 *
 * ── What this tool is actually for ──────────────────────────────────────────
 *
 * Not a Q&A matcher. An ENTICEMENT. Steve: "I'm taking people who aren't
 * answering questions in Circle and forcing the email into their inbox telling
 * them to go answer it. If they never sign in they never get the notification,
 * if they never get the notification they never get curious about what we're
 * doing as a group... I'm using that space as a carrot — here's the sale, go
 * get it."
 *
 * So the question is two-fold, and the second half is what a relevance ranking
 * alone can never answer:
 *
 *     who is best able to answer this
 *     who is NOT ALREADY ANSWERING IN CIRCLE
 *
 * An already-active candidate is a wasted send. They would have seen the ask
 * anyway, and the email buys nothing.
 *
 * ── ⛔ The engine is not changed to do this ─────────────────────────────────
 *
 * `ask_recommendations` ranks the whole community on relevance and knows nothing
 * about who we want to email. Silence is stored beside the score as a FACT —
 * `candidate_last_spoke_at`, null meaning never — and filtered HERE, at the
 * surface that has a reason to care.
 *
 * Folding dormancy into the similarity would make "they are quiet" and "they
 * are a good fit" the same number, and no screen could then say which it was
 * reacting to. Same split as blackouts, the new-partner spotlight, and top
 * choices: the engine ranks, the surface filters.
 *
 * ── The scale of the thing ──────────────────────────────────────────────────
 *
 * 70 of 80 partner orgs have never posted or commented in Circle, once, ever.
 * That silence is the product this tool exists to attack, not a data gap.
 */

import { createAdminClient } from "@/lib/supabase/admin";

export type AskAudience = "silent-partners" | "silent" | "everyone";

export interface AskCandidate {
  contactId: string | null;
  orgId: string;
  orgName: string;
  orgType: string;
  personName: string | null;
  email: string | null;
  rank: number;
  similarity: number;
  /** The single act that best matched — why this candidate, in their own words. */
  reason: string | null;
  /** Null means they have NEVER spoken in Circle. That is the point, not a gap. */
  lastSpokeAt: string | null;
  /** They already replied to this question; emailing them is noise. */
  answeredThisAsk: boolean;
  /**
   * ⚠️ True when the engine ranked the ORG and we picked the person to write to.
   *
   * The distinction is not cosmetic. A person-grain match means this individual's
   * own writing matched the question; an org-grain match means the company's
   * description did, and the human named is simply whoever answers the door. The
   * screen must not present the second as the first — the operator is deciding
   * whether this person can plausibly answer, and "we chose them, not the
   * engine" changes that judgement.
   */
  viaOrgContact: boolean;
}

/**
 * Fill in a person to write to for candidates the engine ranked at ORG grain.
 *
 * Silent partners are exactly the orgs that place at org grain — nobody there
 * has written anything for the engine to place individually, which is why they
 * are on this list at all. Without this hop the audience that most needs the
 * email is the one with no address attached, and the screen shows an empty list
 * while the ranking sits right there.
 *
 * ⛔ Picks ONE contact and never merges rows. Primary first, then a deterministic
 * fallback by name so two runs cannot disagree — 2 of the 12 orgs here have an
 * emailable contact with no primary flagged, and dropping them to avoid a choice
 * would silence a real recommendation over a missing checkbox. The name and
 * address are shown on the screen before anything sends, so the pick is a human's
 * to overrule. See [[feedback_never_merge_identities]].
 */
async function attachOrgContacts(
  db: ReturnType<typeof createAdminClient>,
  rows: { orgId: string; contactId: string | null }[]
): Promise<Map<string, { id: string; name: string | null; email: string | null }>> {
  const orgIds = [...new Set(rows.filter((r) => !r.contactId).map((r) => r.orgId))];
  const out = new Map<string, { id: string; name: string | null; email: string | null }>();
  if (!orgIds.length) return out;

  const { data } = await db
    .from("contacts")
    .select("id, name, email, work_email, is_primary, organization_id")
    .in("organization_id", orgIds)
    .is("archived_at", null);

  type C = {
    id: string; name: string | null; email: string | null; work_email: string | null;
    is_primary: boolean | null; organization_id: string;
  };

  const byOrg = new Map<string, C[]>();
  for (const c of ((data ?? []) as C[])) {
    if (!(c.work_email || c.email)) continue;
    const list = byOrg.get(c.organization_id);
    if (list) list.push(c);
    else byOrg.set(c.organization_id, [c]);
  }

  for (const [orgId, list] of byOrg) {
    // Primary first, then name, then id — every tier deterministic, so the same
    // data always names the same person.
    list.sort(
      (a, b) =>
        Number(Boolean(b.is_primary)) - Number(Boolean(a.is_primary)) ||
        (a.name ?? "").localeCompare(b.name ?? "") ||
        a.id.localeCompare(b.id)
    );
    const pick = list[0];
    out.set(orgId, { id: pick.id, name: pick.name, email: pick.work_email || pick.email });
  }
  return out;
}

/**
 * Did the most recent completed run look at this ask?
 *
 * ⛔ Read from the run's OWN record of what it considered, never derived by
 * comparing the ask's publish date against the run's clock. A derivation would be
 * a guess about what a job did, and it goes wrong in exactly the case that
 * matters: an ask posted before a run that skipped it reads as considered, so the
 * screen reports "nobody matched" about a question nothing has ever read.
 *
 * ⚠️ Falls back to `false` for runs written before this was recorded. That errs
 * toward "we have not looked", which sends a human to check rather than telling
 * them a silence is meaningful.
 */
async function runConsidered(
  db: ReturnType<typeof createAdminClient>,
  askRef: string
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (db as any)
    .from("match_runs")
    .select("counts")
    .eq("status", "complete")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const considered = (data?.counts as { asksConsidered?: unknown } | null)?.asksConsidered;
  return Array.isArray(considered) && considered.map(String).includes(askRef);
}

export interface AskCandidateSet {
  /**
   * ⚠️ Whether the engine has looked at this ask AT ALL, which is a different
   * fact from finding nobody and must never be collapsed into one empty list.
   *
   *   scored: false   we have not looked yet — tonight's run will
   *   scored: true, candidates: []   we looked, and nobody qualified
   *
   * The screen says two different sentences, and an operator who cannot tell
   * these apart will either wait for a list that is already in front of them or
   * conclude the engine has no opinion when it has a firm one.
   */
  scored: boolean;
  candidates: AskCandidate[];
  /** Ranked but filtered out by the audience — the size of what is hidden. */
  filtered: number;
}

/**
 * Ranked candidates for one ask, filtered to the audience worth emailing.
 *
 * ⚠️ `scored: false` when the nightly run has not reached this ask yet — a
 * question posted this morning is scored tonight. That is the accepted trade for
 * keeping member conversation on one machine rather than at an embedding vendor,
 * and saying so plainly is honest: we have not looked at it yet.
 *
 * ⛔ Never falls back to the old word matcher. It scored "self-duplicating
 * notebooks" by counting the word "book", returned two vendors listed six times,
 * and its own comments record it matching every Books-category partner. A silent
 * fallback to it would be worse than an empty list, because nobody would know
 * which engine produced the names in front of them. `matchPartnersToAsk` still
 * exists as the BASELINE in `scripts/cluster-bench/ask-compare.mts` — that is
 * its only remaining job, and it must not be wired to a screen again.
 */
export async function askCandidates(
  askRef: string,
  audience: AskAudience = "silent-partners",
  limit = 12
): Promise<AskCandidateSet> {
  const db = createAdminClient();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("ask_recommendations")
    .select(
      "candidate_org_id, candidate_contact_id, rank, similarity, reason, " +
      "candidate_last_spoke_at, answered_this_ask, " +
      "organizations!inner(id, name, type, archived_at, is_test), " +
      // ⛔ Name the constraint. This table has TWO foreign keys to `contacts` —
      // `candidate_contact_id` and `selected_by` — so a bare `contacts(...)`
      // cannot be resolved and PostgREST refuses the whole query. The failure is
      // invisible from the outside: no rows come back, and an unscored ask looks
      // exactly the same. It rendered "Not scored yet" over twelve live
      // recommendations until this was pinned down.
      "contacts!ask_recommendations_candidate_contact_id_fkey(id, name, email, work_email)"
    )
    .eq("ask_ref", askRef)
    .eq("recommended", true)
    .order("rank", { ascending: true });

  // ⚠️ A query error and an unscored ask both arrive as "no rows", but only one
  // of them is our fault. Distinguished so a broken read never quietly presents
  // itself as "the run hasn't got to it yet" and waits forever.
  if (error) {
    console.warn(`[ask-candidates] read FAILED for ask ${askRef}: ${error.message}`);
    return { scored: false, candidates: [], filtered: 0 };
  }

  if (!data || data.length === 0) {
    // ⛔ No rows does NOT mean the engine has not looked. Three of nine open asks
    // score to zero candidates — the run considered them and nobody matched. Ask
    // the run what it looked at rather than inferring it from the wreckage.
    return {
      scored: await runConsidered(db, askRef),
      candidates: [], filtered: 0,
    };
  }

  type Row = {
    candidate_org_id: string; candidate_contact_id: string | null;
    rank: number; similarity: number; reason: string | null;
    candidate_last_spoke_at: string | null; answered_this_ask: boolean;
    organizations: { name: string; type: string; archived_at: string | null; is_test: boolean | null };
    contacts: { name: string | null; email: string | null; work_email: string | null } | null;
  };

  const rows = (data as Row[])
    // An org archived since last night's run must not be emailed, even though
    // the run legitimately scored it.
    .filter((r) => !r.organizations.archived_at && r.organizations.is_test !== true)
    // ⛔ Always drop anyone who already answered. Whatever the audience, "go
    // answer this" to somebody who already did is the one unambiguous mistake.
    .filter((r) => !r.answered_this_ask);

  const inAudience = (r: Row) => {
    if (audience === "everyone") return true;
    // Silence is the qualifier: never spoken at all.
    const silent = r.candidate_last_spoke_at === null;
    if (audience === "silent") return silent;
    return silent && r.organizations.type === "Vendor Partner";
  };
  const wanted = rows.filter(inAudience);

  const top = wanted.slice(0, limit);

  // Org-grain rankings carry no person. Resolve one before returning, because a
  // candidate with no address is not a candidate — it is an empty row that makes
  // the engine look like it found nothing.
  const orgContacts = await attachOrgContacts(
    db,
    top.map((r) => ({
      orgId: r.candidate_org_id,
      contactId: r.candidate_contact_id,
    }))
  );

  const shape = (r: Row) => {
    const viaOrg = !r.candidate_contact_id;
    const fallback = viaOrg ? orgContacts.get(r.candidate_org_id) : undefined;
    return {
      contactId: r.candidate_contact_id ?? fallback?.id ?? null,
      orgId: r.candidate_org_id,
      orgName: r.organizations.name,
      orgType: r.organizations.type,
      personName: r.contacts?.name ?? fallback?.name ?? null,
      email: r.contacts?.work_email || r.contacts?.email || fallback?.email || null,
      rank: r.rank,
      similarity: Number(r.similarity),
      reason: r.reason,
      lastSpokeAt: r.candidate_last_spoke_at,
      answeredThisAsk: r.answered_this_ask,
      viaOrgContact: viaOrg,
    };
  };
  const candidates = top.map(shape);

  // Counted against everything the engine ranked, not against `wanted`, so the
  // screen can say how much the audience filter is hiding rather than implying
  // the engine only found this many.
  return {
    scored: true,
    candidates,
    filtered: rows.length - candidates.length,
  };
}

/**
 * The contact row to credit a selection to, or null if we cannot be certain.
 *
 * ⛔ Returns null when a profile has MORE THAN ONE contact row. `contacts` is per
 * (person, org) and `profile_id` is not unique, so one human running two stores
 * has two rows and there is no fact here that says which hat they had on. Naming
 * the wrong (person, org) is worse than naming nobody: the log is evidence about
 * who exercised judgement, and a confident wrong attribution is unfalsifiable
 * later. See [[feedback_email_is_not_an_identity_key]].
 */
export async function resolveActingContact(profileId: string | null): Promise<string | null> {
  if (!profileId) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("contacts")
    .select("id")
    .eq("profile_id", profileId)
    .is("archived_at", null)
    .limit(2);
  const rows = (data ?? []) as { id: string }[];
  return rows.length === 1 ? rows[0].id : null;
}

/**
 * The identity of one candidate: an org, optionally narrowed to a person.
 *
 * ⛔ ONE function, used for both sides of every comparison. Two call sites each
 * building this string by hand is precisely how it broke: the stored side joined
 * with an invisible U+001F and the chosen side joined with nothing, so no key
 * ever matched, every selection was filed as a human correction, and the table
 * built to measure the engine recorded only its failures. Nothing looked wrong -
 * the separator cannot be seen in an editor or a diff.
 *
 * A separator is still required. Without one, org "ab" + contact "c" and org "a"
 * + contact "bc" collide. It is simply a VISIBLE one now, using a character that
 * cannot occur in a UUID.
 */
function candidateKey(orgId: string, contactId: string | null): string {
  return `${orgId}::${contactId ?? ""}`;
}

/**
 * Record what the admin actually picked.
 *
 * ⛔ This is the half that makes the recommender testable, and it is the reason
 * the table exists at all:
 *
 *     shown     the engine surfaced these
 *     chosen    the admin picked a subset      ← a human judging our list
 *     replied   some of them answered          ← the outcome
 *
 * ⛔ A candidate the admin adds that we NEVER SURFACED is written with
 * `recommended: false` and no rank or score. That row is a labelled miss — the
 * engine was wrong and a human corrected it — and it is worth more than every
 * hit in the table. Recorded at selection time, never derived later: re-running
 * the engine tomorrow must not retroactively turn a human's correction into
 * something we take credit for.
 */
export async function recordAskSelection(params: {
  askRef: string;
  selectedBy: string | null;
  chosen: { orgId: string; contactId: string | null }[];
}): Promise<{ recorded: number; corrections: number }> {
  const db = createAdminClient();
  const now = new Date().toISOString();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: existingError } = await (db as any)
    .from("ask_recommendations")
    .select("candidate_org_id, candidate_contact_id")
    .eq("ask_ref", params.askRef);

  /**
   * ⛔ Bail rather than guess. If this read fails, every candidate looks
   * unsurfaced, and the whole selection is written as human corrections — the
   * table's strongest signal, fabricated wholesale, in the one place we go to
   * decide whether the engine is any good. Recording nothing is recoverable;
   * recording confident lies about our own misses is not.
   */
  if (existingError) {
    console.warn(
      `[ask-candidates] cannot read prior recommendations for ask ${params.askRef}: ` +
        `${existingError.message} — selection NOT logged`
    );
    return { recorded: 0, corrections: 0 };
  }

  const surfaced = new Set(
    ((existing ?? []) as { candidate_org_id: string; candidate_contact_id: string | null }[])
      .map((r) => candidateKey(r.candidate_org_id, r.candidate_contact_id))
  );

  if (params.chosen.length === 0) return { recorded: 0, corrections: 0 };

  const key = (c: { orgId: string; contactId: string | null }) =>
    candidateKey(c.orgId, c.contactId);
  const known = params.chosen.filter((c) => surfaced.has(key(c)));
  const added = params.chosen.filter((c) => !surfaced.has(key(c)));

  let recorded = 0;
  const fail = (what: string, msg: string) =>
    // ⚠️ Never throw. Losing the log must not stop a human sending the email they
    // came here to send — but it must be visible, because a silent gap in the
    // evaluation data looks exactly like an admin who chose nobody.
    console.warn(`[ask-candidates] ${what} FAILED for ask ${params.askRef}: ${msg}`);

  /**
   * ⛔ UPDATE for candidates we surfaced, never upsert.
   *
   * An upsert that omits `recommended` builds an insert tuple with NULL in a NOT
   * NULL column, and Postgres rejects that BEFORE it ever looks for a conflict.
   * Verified against the live schema rather than reasoned about:
   *
   *   null value in column "recommended" ... violates not-null constraint
   *
   * So the upsert form failed on the ORDINARY path — every already-surfaced
   * candidate — while succeeding on corrections. Combined with the warn-and-carry-on
   * above, this table would have filled with nothing but the engine's misses and
   * read as though it never got anything right.
   *
   * ⛔ Restating `recommended`/`rank`/`similarity` to satisfy the insert is not the
   * fix either. Those are the engine's record of what it said at the time, and a
   * surface allowed to re-assert them is a surface that can quietly rewrite them.
   */
  for (const c of known) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (db as any)
      .from("ask_recommendations")
      .update({ selected_at: now, selected_by: params.selectedBy })
      .eq("ask_ref", params.askRef)
      .eq("candidate_org_id", c.orgId);
    // ⚠️ `.eq(col, null)` never matches NULL in PostgREST — it needs `.is`. Most
    // rows here are org-grain with a null contact, so the wrong operator would
    // update nothing and report success.
    q = c.contactId ? q.eq("candidate_contact_id", c.contactId) : q.is("candidate_contact_id", null);

    const { error } = await q;
    if (error) fail("selection update", error.message);
    else recorded++;
  }

  if (added.length) {
    // Never surfaced: rank and similarity stay null, and the table's check
    // constraint enforces that shape so a correction can never be mistaken for a
    // recommendation later.
    const rows = added.map((c) => ({
      ask_ref: params.askRef,
      candidate_org_id: c.orgId,
      candidate_contact_id: c.contactId,
      recommended: false,
      rank: null,
      similarity: null,
      selected_at: now,
      selected_by: params.selectedBy,
    }));
    /**
     * ⛔ INSERT, never upsert.
     *
     * An upsert here is a loaded gun pointed at the engine's own record: on
     * conflict it would DO UPDATE and overwrite a real recommendation with
     * `recommended:false, rank:null, similarity:null`. A scratch probe did
     * exactly that — a seeded row at rank 4 came back as a human correction with
     * no rank at all. The engine's account of what it said would be erased by the
     * screen meant to grade it, and the grading would then flatter the erasure.
     *
     * A conflict here means our `surfaced` read missed something, which is a bug
     * to hear about, not a row to overwrite.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("ask_recommendations").insert(rows);
    if (error) fail("correction insert", error.message);
    else recorded += rows.length;
  }

  return { recorded, corrections: added.length };
}

// ── Human verdicts on the engine's rankings ────────────────────────────────

export type Verdict = "good" | "bad" | "unsure";

export interface Judgement {
  verdict: Verdict;
  judgedAt: string;
}

/**
 * The latest verdict per candidate for one ask, keyed by `candidateKey`.
 *
 * ⚠️ Latest, not only. The table is append-only — a changed mind is a new row —
 * so a screen shows the most recent while the history stays intact. How often a
 * verdict flips, and after how long, is worth more than the current value alone.
 */
export async function loadJudgements(askRef: string): Promise<Map<string, Judgement>> {
  const db = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (db as any)
    .from("ask_judgements")
    .select("candidate_org_id, candidate_contact_id, verdict, judged_at")
    .eq("ask_ref", askRef)
    .order("judged_at", { ascending: false });

  const out = new Map<string, Judgement>();
  if (error) {
    // ⚠️ Never throw — a screen that cannot show past verdicts is still usable
    // for making new ones. Silence here would look like "nothing judged yet".
    console.warn(`[ask-candidates] judgement read failed for ${askRef}: ${error.message}`);
    return out;
  }
  type R = {
    candidate_org_id: string; candidate_contact_id: string | null;
    verdict: Verdict; judged_at: string;
  };
  // Newest first, so the first row seen for a candidate is the current verdict.
  for (const r of ((data ?? []) as R[])) {
    const k = candidateKey(r.candidate_org_id, r.candidate_contact_id);
    if (!out.has(k)) out.set(k, { verdict: r.verdict, judgedAt: r.judged_at });
  }
  return out;
}

/**
 * Record one human verdict.
 *
 * ⛔ INSERT, always. Never an upsert on (ask, candidate): that would overwrite
 * the previous verdict and destroy the only record of a human changing their
 * mind. Append-only is the point, not an implementation detail.
 *
 * ⛔ Captures `run_id` and `rank_at_judgement` at write time. A verdict is about
 * what the engine said THAT night at THAT position — without them, tonight's
 * re-rank would silently reattribute an old judgement to a new opinion, and the
 * evaluation would credit the engine for a call it never made. Provenance at
 * write time, never derived. See [[feedback_downstream_of_our_own_decision]].
 */
export async function recordJudgement(params: {
  askRef: string;
  orgId: string;
  contactId: string | null;
  rank: number | null;
  verdict: Verdict;
  judgedBy: string | null;
}): Promise<{ ok: boolean }> {
  const db = createAdminClient();

  // The run whose ranking is on screen right now.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: run } = await (db as any)
    .from("match_runs")
    .select("id")
    .eq("status", "complete")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (db as any).from("ask_judgements").insert({
    ask_ref: params.askRef,
    candidate_org_id: params.orgId,
    candidate_contact_id: params.contactId,
    run_id: run?.id ?? null,
    rank_at_judgement: params.rank,
    verdict: params.verdict,
    judged_by: params.judgedBy,
  });

  if (error) {
    console.warn(`[ask-candidates] judgement write failed for ${params.askRef}: ${error.message}`);
    return { ok: false };
  }
  return { ok: true };
}
