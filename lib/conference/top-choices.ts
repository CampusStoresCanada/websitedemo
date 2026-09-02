import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-conference expressions of interest: who an org wants to meet.
 *
 * The counterpart to `lib/org/meeting-refusals.ts`, and deliberately shaped like
 * it — one module owns the reads so there is a single answer to "who chose
 * whom", rather than one answer per consumer.
 *
 * ⛔ AN EXPRESSION OF INTEREST, NOT A GUARANTEE. The ED: "Top 5 isn't a
 * guarantee, it is an expression of interest we should attempt to accommodate."
 * Nothing here reserves a meeting. The scheduler weighs it against everything
 * else and may not manage it — and a member who was promised a meeting and did
 * not get one is a worse outcome than one who was never promised.
 *
 * ⛔ TWO GRAINS, because a trade show has two kinds of attendee. A DELEGATE
 * attends as a person and picks their own five — three buyers from one store
 * legitimately want three different sets of meetings. An EXHIBITOR attends as a
 * company; the suite meets whoever walks in, so the org has one list.
 *
 * `declaringContactId` null means the org is the subject, set means a person is
 * — the same convention `match_edges.subject_contact_id` uses, so the engine
 * reads it without translation. This is not a special case bolted on; it is the
 * delegate/exhibitor structure of the event, which is already derived elsewhere
 * from whether a registration `requires_ownership_of` a booth.
 *
 * ⛔ It is also NOT the opposite of a refusal, even though they look symmetrical.
 * A refusal is a standing relationship fact reaffirmed annually; a top choice is
 * scoped to one conference because you pick from who is actually present. They
 * are two different kinds of statement and they live in two different tables.
 *
 * ⚠️ Reads go through the admin client. The table has RLS enabled with no
 * policies, so a session client returns zero rows and a null error — which reads
 * as "nobody chose anybody" rather than as a failure. Every caller here is a
 * server action that has already checked who is asking.
 */

/** How many an org may express per conference. The "5" in "top 5". */
export const TOP_CHOICE_LIMIT = 5;

export type TopChoice = {
  declaringOrgId: string;
  /** Whose list this is. Null = the org's own (exhibitor side). */
  declaringContactId: string | null;
  chosenOrgId: string;
  /** 1..TOP_CHOICE_LIMIT when they ordered them; null when it is just a set. */
  rank: number | null;
  declaredByContactId: string | null;
};

type ChoiceRow = {
  declaring_org_id: string;
  declaring_contact_id: string | null;
  chosen_org_id: string;
  rank: number | null;
  declared_by_contact_id: string | null;
};

/**
 * The generated types do not know this table yet. A narrow shim rather than a
 * blanket ts-expect-error: it states exactly what this call returns and stops
 * compiling the moment the shape changes. Same pattern as meeting-refusals.ts —
 * delete both at the next coordinated regen of lib/database.types.ts.
 */
type ChoiceDb = {
  from: (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    select: (columns: string) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    insert: (values: unknown) => any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete: () => any;
  };
};

/** Every choice declared for one conference, both directions. */
export async function loadTopChoices(conferenceId: string): Promise<TopChoice[]> {
  const db = createAdminClient() as unknown as ChoiceDb;
  const { data, error } = await db
    .from("conference_top_choices")
    .select("declaring_org_id, declaring_contact_id, chosen_org_id, rank, declared_by_contact_id")
    .eq("conference_id", conferenceId);

  // Never swallow this. An unreadable preference list is not an empty one, and
  // treating it as empty silently discards what people asked for.
  if (error) throw new Error(`Could not load top choices: ${error.message}`);

  return ((data ?? []) as ChoiceRow[]).map((row) => ({
    declaringOrgId: row.declaring_org_id,
    declaringContactId: row.declaring_contact_id,
    chosenOrgId: row.chosen_org_id,
    rank: row.rank,
    declaredByContactId: row.declared_by_contact_id,
  }));
}

export type TopChoiceLookup = {
  /** Did `declaringOrgId` choose `chosenOrgId`? */
  chose: (declaringOrgId: string, chosenOrgId: string) => boolean;
  /**
   * Did they choose EACH OTHER? A mutual choice is a far stronger signal than a
   * one-way one, and it is invisible unless both directions live in one table.
   */
  mutual: (orgA: string, orgB: string) => boolean;
  /** The rank one org gave another, when they ordered their picks. */
  rankOf: (declaringOrgId: string, chosenOrgId: string) => number | null;
  /** An ORG's own list — exhibitor side, declaringContactId null. */
  chosenBy: (declaringOrgId: string) => TopChoice[];
  /** One PERSON's list — delegate side. */
  chosenByContact: (declaringContactId: string) => TopChoice[];
};

export function indexTopChoices(choices: readonly TopChoice[]): TopChoiceLookup {
  const byPair = new Map<string, TopChoice>();
  const byDeclaring = new Map<string, TopChoice[]>();
  const byContact = new Map<string, TopChoice[]>();

  for (const choice of choices) {
    if (choice.declaringContactId) {
      const list = byContact.get(choice.declaringContactId) ?? [];
      list.push(choice);
      byContact.set(choice.declaringContactId, list);
    } else {
      byPair.set(`${choice.declaringOrgId}|${choice.chosenOrgId}`, choice);
      const list = byDeclaring.get(choice.declaringOrgId) ?? [];
      list.push(choice);
      byDeclaring.set(choice.declaringOrgId, list);
    }
    // An org "chose" a vendor if it did, or if any of its people did — which is
    // what a scheduler weighing org-level interest should see.
    const anyKey = `${choice.declaringOrgId}|${choice.chosenOrgId}`;
    if (!byPair.has(anyKey)) byPair.set(anyKey, choice);
  }

  const rank = (choice: TopChoice) => choice.rank ?? TOP_CHOICE_LIMIT + 1;

  const chose = (declaringOrgId: string, chosenOrgId: string) =>
    byPair.has(`${declaringOrgId}|${chosenOrgId}`);

  return {
    chose,
    mutual: (orgA, orgB) => chose(orgA, orgB) && chose(orgB, orgA),
    rankOf: (declaringOrgId, chosenOrgId) =>
      byPair.get(`${declaringOrgId}|${chosenOrgId}`)?.rank ?? null,
    chosenBy: (declaringOrgId) =>
      [...(byDeclaring.get(declaringOrgId) ?? [])].sort((l, r) => rank(l) - rank(r)),
    chosenByContact: (declaringContactId) =>
      [...(byContact.get(declaringContactId) ?? [])].sort((l, r) => rank(l) - rank(r)),
  };
}

/**
 * Replace one org's choices for a conference, wholesale.
 *
 * Wholesale rather than add/remove because that is what the interface actually
 * does — someone edits their five and saves. Doing it as deltas would leave the
 * stored set able to disagree with what they were just looking at.
 *
 * ⛔ Refuses more than TOP_CHOICE_LIMIT rather than silently truncating. A
 * caller that sends six has a bug, and quietly dropping the sixth would drop
 * whichever one the sort happened to put last.
 */
export async function replaceTopChoices(params: {
  conferenceId: string;
  declaringOrgId: string;
  /** Set for a delegate's own list; null when the org itself is choosing. */
  declaringContactId?: string | null;
  declaredByContactId: string | null;
  /** Chosen orgs in preference order; rank comes from position. */
  chosenOrgIds: readonly string[];
}): Promise<void> {
  const unique = [...new Set(params.chosenOrgIds.filter(Boolean))];

  if (unique.length > TOP_CHOICE_LIMIT) {
    throw new Error(
      `A conference top-choice list holds at most ${TOP_CHOICE_LIMIT}; received ${unique.length}.`
    );
  }
  if (unique.includes(params.declaringOrgId)) {
    throw new Error("An organization cannot choose itself.");
  }

  const db = createAdminClient() as unknown as ChoiceDb;

  // Clear only THIS subject's rows — a delegate saving their five must not
  // erase a colleague's, and neither may touch the org-level list.
  let clear = db
    .from("conference_top_choices")
    .delete()
    .eq("conference_id", params.conferenceId)
    .eq("declaring_org_id", params.declaringOrgId);
  clear = params.declaringContactId
    ? clear.eq("declaring_contact_id", params.declaringContactId)
    : clear.is("declaring_contact_id", null);
  const { error: deleteError } = await clear;
  if (deleteError) throw new Error(`Could not clear top choices: ${deleteError.message}`);

  if (unique.length === 0) return;

  /**
   * ⛔ INSERT, not upsert. The subject's rows were just deleted above, so there
   * is nothing to conflict with — and ON CONFLICT could not work here anyway:
   * both unique indexes are PARTIAL (one for org-level rows, one for
   * person-level), and Postgres will not match a partial index from a bare
   * column list. It fails at runtime with "no unique or exclusion constraint
   * matching the ON CONFLICT specification", which is exactly what a delegate
   * saving their first list hit.
   */
  const { error: insertError } = await db.from("conference_top_choices").insert(
    unique.map((chosenOrgId, index) => ({
      conference_id: params.conferenceId,
      declaring_org_id: params.declaringOrgId,
      declaring_contact_id: params.declaringContactId ?? null,
      chosen_org_id: chosenOrgId,
      declared_by_contact_id: params.declaredByContactId,
      rank: index + 1,
      updated_at: new Date().toISOString(),
    }))
  );
  if (insertError) throw new Error(`Could not save top choices: ${insertError.message}`);
}
