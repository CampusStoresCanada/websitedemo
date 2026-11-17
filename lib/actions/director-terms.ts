"use server";

/**
 * Recording what the association already knows about who has served.
 *
 * The term-limit check refuses to guess: countConsecutiveTerms returns null
 * when a person has no recorded history, and a nomination then reports that the
 * limit "cannot be checked" rather than quietly passing. That is the right
 * behaviour, and it left the Executive Director looking at a flag with nothing
 * to press — the history exists, on paper, with no way into the system.
 *
 * ⛔ This is a control for a human to enter a declared fact, never a place to
 * infer one. Nothing here derives a term from an election result or from a
 * name appearing on an old slate. Who served, for how long, and whether a
 * mid-term appointment counts against the cap are all judgements the board
 * made; the software records them and does not reconstruct them.
 *
 * ⚠️ `term_end` is EXCLUSIVE. A two-year term beginning 2026-01-01 ends
 * 2028-01-01, not 2027-12-31, and the existing 19 rows are written that way.
 * The editor says so out loud, because an off-by-one here silently changes
 * whether somebody has reached the four-term limit.
 */

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticated, isGlobalAdmin } from "@/lib/auth/guards";

export interface TermResult {
  success: boolean;
  error?: string;
}

async function requireAdmin(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const auth = await requireAuthenticated();
  if (!auth.ok) return { ok: false, error: "Not signed in" };
  if (!isGlobalAdmin(auth.ctx.globalRole))
    return { ok: false, error: "Administrator access required" };
  return { ok: true, userId: auth.ctx.userId };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function addDirectorTerm(input: {
  bodyId: string;
  personContactId: string;
  personProfileId: string | null;
  organizationId: string | null;
  termStart: string;
  termEnd: string;
  countsTowardCap: boolean;
  notes: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  if (!ISO.test(input.termStart) || !ISO.test(input.termEnd))
    return { success: false, error: "Both dates are needed, as YYYY-MM-DD." };
  if (input.termEnd <= input.termStart)
    return {
      success: false,
      error:
        "The end date must be after the start. It is exclusive, so a term running through 2027 ends 2028-01-01.",
    };

  const db = createAdminClient();
  const { error } = await db.from("governance_role_assignments").insert({
    body_id: input.bodyId,
    person_contact_id: input.personContactId,
    person_profile_id: input.personProfileId,
    organization_id: input.organizationId,
    role_key: "director",
    term_start: input.termStart,
    term_end: input.termEnd,
    counts_toward_cap: input.countsTowardCap,
    notes: input.notes.trim() || null,
  });
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}

/**
 * "We checked, and they have not served before."
 *
 * A zero-length row that does not count toward the cap, which is the shape
 * countConsecutiveTerms was written to expect — its own docstring calls for
 * "an explicit zero-length history row set by the admin UI, not an absence".
 * With it the count reads 0 instead of null, and a first-time nominee stops
 * being unverifiable.
 */
export async function recordNoPriorService(input: {
  bodyId: string;
  personContactId: string;
  personProfileId: string | null;
  asOf: string;
  notes: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  if (!ISO.test(input.asOf)) return { success: false, error: "A date is needed." };

  const db = createAdminClient();
  const { error } = await db.from("governance_role_assignments").insert({
    body_id: input.bodyId,
    person_contact_id: input.personContactId,
    person_profile_id: input.personProfileId,
    role_key: "director",
    term_start: input.asOf,
    term_end: input.asOf,
    counts_toward_cap: false,
    notes: input.notes.trim() || "No prior service on this body, checked when recorded.",
  });
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}

/**
 * Remove a row entered in error.
 *
 * ⛔ Scoped to `role_key = 'director'` on the id, so this control can never
 * delete an office or a committee appointment that happens to share a table.
 */
export async function removeDirectorTerm(input: {
  assignmentId: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const db = createAdminClient();
  const { error } = await db
    .from("governance_role_assignments")
    .delete()
    .eq("id", input.assignmentId)
    .eq("role_key", "director");
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}

/* ------------------------------------------------------------------------- *
 * Terms that come out of an election, and changes between elections.
 *
 * Everything above records history somebody is typing in from paper. The three
 * below record what the association does to its own board: elects it, loses a
 * member of it, and fills the seat that leaves.
 *
 * ⛔ The no-inference rule at the top of this file still holds, and these do
 * not break it. None of them runs by itself. Each is a control an administrator
 * presses, having been shown exactly what will be written, and the judgements
 * the software cannot make — whether a term counts against the cap, what
 * authorised an appointment — are fields on the form, not defaults buried here.
 * ------------------------------------------------------------------------- */

/**
 * Write the terms of the directors an election elected.
 *
 * The gap this closes: `certifyElection` establishes the result and writes
 * `election_certifications`, but never touched the register, so a newly elected
 * director held the role on no date at all. The board mailing list, the
 * term-limit check and every "who is on the board" reader go to
 * `governance_role_assignments`, and nothing was putting them there.
 *
 * Refuses before certification. Until the result is certified there is no
 * elected director to record, and By-Law Part V S3(e) has the members elect AT
 * the meeting — writing terms off an uncertified count would put people on the
 * board who are not on it yet.
 *
 * Idempotent by `elected_at_election_id`: certifying or pressing twice adds
 * nothing. That stamp is also the provenance — the column has existed on the
 * table since it was created and has never held a value, because nothing wrote
 * the link it was made for.
 */
export async function recordElectedTerms(input: {
  slug: string;
  /**
   * Nomination ids the administrator un-ticked. A seat filled for the
   * remainder of somebody else's term does not count against the four-term
   * cap, and only a person knows that is what happened.
   */
  notCountingNominationIds?: string[];
  revalidate?: string;
}): Promise<TermResult & { written?: number; skipped?: number }> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  const { getElectedTermsProposal } = await import("@/lib/elections/service");

  const proposal = await getElectedTermsProposal(input.slug);
  if (!proposal) return { success: false, error: "That election could not be read." };

  const { election, terms: proposed } = proposal;
  if (election.status !== "certified")
    return {
      success: false,
      error: `Terms are written once the result is certified — this election is "${election.status}".`,
    };
  if (proposed.length === 0)
    return { success: false, error: "Nobody was elected, so there is no term to record." };

  const db = createAdminClient();

  const notCounting = new Set(input.notCountingNominationIds ?? []);
  const toWrite = proposed.filter((p) => !p.alreadyRecorded);
  const skipped = proposed.length - toWrite.length;

  if (toWrite.length === 0)
    return { success: true, written: 0, skipped };

  const { error } = await db.from("governance_role_assignments").insert(
    toWrite.map((p) => ({
      body_id: election.bodyId,
      person_contact_id: p.personContactId,
      person_profile_id: p.personProfileId,
      organization_id: p.organizationId,
      role_key: "director",
      term_start: p.termStart,
      term_end: p.termEnd,
      counts_toward_cap: notCounting.has(p.nominationId) ? false : p.countsTowardCap,
      elected_at_election_id: election.id,
      notes: `Elected at the ${election.cycleYear} annual general meeting; recorded when the result was certified.`,
    }))
  );
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true, written: toWrite.length, skipped };
}

/**
 * A director leaves before their term is up.
 *
 * Shortens the term rather than deleting it: they did serve, the minutes say
 * so, and a removed row would take the service with it. `term_end` is
 * EXCLUSIVE, so `effectiveOn` is the first day they no longer hold the seat.
 *
 * Whether the shortened term still counts against the cap is a board
 * judgement and so a field, not a default. The two precedents in this register
 * both went the other way — a part term completed FOR someone does not count —
 * but a resignation part-way through a term served is a different question and
 * the software has no business answering it.
 */
export async function resignDirector(input: {
  assignmentId: string;
  effectiveOn: string;
  countsTowardCap: boolean;
  /** The minute, resolution or letter. Required: a seat changing hands needs a why. */
  note: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };
  if (!ISO.test(input.effectiveOn))
    return { success: false, error: "An effective date is needed, as YYYY-MM-DD." };
  if (!input.note.trim())
    return {
      success: false,
      error: "Record what this came from — the minute, resolution or letter of resignation.",
    };

  const db = createAdminClient();
  const { data: row } = await db
    .from("governance_role_assignments")
    .select("id, term_start, term_end, notes")
    .eq("id", input.assignmentId)
    .eq("role_key", "director")
    .maybeSingle();
  if (!row) return { success: false, error: "That term is not on the register." };

  if (input.effectiveOn <= (row.term_start as string))
    return {
      success: false,
      error:
        "The effective date is on or before the term started. If they never took the seat, remove the term instead of ending it.",
    };
  if (row.term_end && input.effectiveOn >= (row.term_end as string))
    return {
      success: false,
      error: `That term already ends ${row.term_end as string}, which is on or before the date given. Nothing to shorten.`,
    };

  const existingNote = ((row.notes as string | null) ?? "").trim();
  // Shortening the term overwrites the date the seat was due to run to, and
  // that date is exactly what whoever fills the vacancy needs — an appointee
  // serves the UNEXPIRED remainder, not a fresh term. Keep it in the note
  // before it is lost; it is a fact about the term, not a judgement about it.
  const wouldHaveRun = row.term_end
    ? ` The term would otherwise have run to ${row.term_end as string}.`
    : "";
  const { error } = await db
    .from("governance_role_assignments")
    .update({
      term_end: input.effectiveOn,
      counts_toward_cap: input.countsTowardCap,
      notes: [
        existingNote,
        `Left the board effective ${input.effectiveOn}. ${input.note.trim()}${wouldHaveRun}`,
      ]
        .filter(Boolean)
        .join(" "),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.assignmentId)
    .eq("role_key", "director");
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}

/**
 * The board fills a seat for the unexpired part of a term.
 *
 * By-Law Part IV: a vacancy is filled by the board, and the appointee serves
 * what is left rather than starting a fresh term — which is why `termEnd` is
 * the vacated term's end and the default for `countsTowardCap` is FALSE. Both
 * precedents in this register say so in their own notes: Sean Bell completed
 * Mike Clark's term and Shawn Davies completed Madeleine Miller's, and neither
 * part term counted. It is still a field, because the next board may decide
 * differently and that decision is theirs.
 *
 * `appointing_resolution` is the authority. The column has been on this table
 * from the start and 30 rows already use it.
 */
export async function appointToVacancy(input: {
  bodyId: string;
  personContactId: string;
  personProfileId: string | null;
  organizationId: string | null;
  termStart: string;
  termEnd: string;
  countsTowardCap: boolean;
  /** The board resolution that made the appointment. */
  appointingResolution: string;
  revalidate?: string;
}): Promise<TermResult> {
  const admin = await requireAdmin();
  if (!admin.ok) return { success: false, error: admin.error };

  if (!ISO.test(input.termStart) || !ISO.test(input.termEnd))
    return { success: false, error: "Both dates are needed, as YYYY-MM-DD." };
  if (input.termEnd <= input.termStart)
    return {
      success: false,
      error:
        "The end date must be after the start. It is exclusive, so a term running through 2027 ends 2028-01-01.",
    };
  if (!input.appointingResolution.trim())
    return {
      success: false,
      error: "Record the board resolution that made this appointment.",
    };

  const db = createAdminClient();
  const { error } = await db.from("governance_role_assignments").insert({
    body_id: input.bodyId,
    person_contact_id: input.personContactId,
    person_profile_id: input.personProfileId,
    organization_id: input.organizationId,
    role_key: "director",
    term_start: input.termStart,
    term_end: input.termEnd,
    counts_toward_cap: input.countsTowardCap,
    appointing_resolution: input.appointingResolution.trim(),
    notes: "Appointed by the board to an unexpired term.",
  });
  if (error) return { success: false, error: error.message };

  if (input.revalidate) revalidatePath(input.revalidate);
  return { success: true };
}
