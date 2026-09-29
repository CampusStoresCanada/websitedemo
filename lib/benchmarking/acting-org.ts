import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which store is this page about?
 *
 * The survey and the gathering worksheet both have to answer it, and both had
 * answered it themselves with the same broken filter:
 *
 *   org.type === "Member" && (role === "org_admin" || isAdmin)
 *
 * `isAdmin` relaxes WHICH ROLE is needed at a member store. It does nothing
 * about the requirement to be attached to one, and every CSC staffer is linked
 * to the Staff org — so the list came back empty and the page bounced them to
 * the landing page. Fixing that in the survey and leaving the worksheet alone
 * is how the two drift apart; a worksheet for a different store than the form
 * is worse than no worksheet.
 *
 * ⛔ It never guesses a store for an admin. `?org=` names it and the roster is
 * offered when it is absent — same ?org= pattern /org/billing and the
 * conference cart already drive.
 */

export interface ActingOrg {
  id: string;
  name: string;
  slug: string;
  type: string;
  province: string;
}

export interface OrgResolution {
  /** The store this page is about, or null when an admin has not picked one. */
  organization: ActingOrg | null;
  /** Stores an admin may choose between. Empty for non-admins. */
  adminOrgOptions: { id: string; name: string }[];
  /** An admin is looking at a store that is not their own. */
  isActingAsOther: boolean;
}

/**
 * @param surveyId  Roster source. The survey's recipient list is the right set
 *                  of stores — `type = "Member" AND archived_at IS NULL` returns
 *                  80, of which 25 are cancelled, and archived_at is not
 *                  membership. Pass null to fall back to paid-up member stores.
 */
export async function resolveActingOrg(input: {
  userOrgs: Array<{
    role: string | null;
    organization: unknown;
  }> | null;
  isAdmin: boolean;
  requestedOrgId: string | null;
  surveyId: string | null;
  /**
   * Preview mode: pin to the test store and ignore ?org= entirely.
   *
   * Walking the survey is how staff check the wording and the controls, and it
   * WRITES — a draft row, a respondent stamp, a disclosure choice, and on
   * submit an FTE sync and a receipt to the store's contact. Doing that against
   * a real member store is how a $0 draft ended up on MacEwan and how someone
   * could put a submission receipt in a bookseller's inbox for a survey that is
   * not open.
   *
   * So preview does not offer a choice. Opening another store's live submission
   * is still possible and still supported — it is just not what "preview" does.
   */
  pinToTestStore?: boolean;
}): Promise<OrgResolution> {
  const { userOrgs, isAdmin, requestedOrgId, surveyId } = input;

  if (input.pinToTestStore && isAdmin) {
    const db = createAdminClient();
    const { data: testOrg } = await db
      .from("organizations")
      .select("id, name, slug, type, province")
      .eq("type", "Member")
      .eq("is_test", true)
      .is("archived_at", null)
      .order("name")
      .limit(1)
      .maybeSingle();

    if (testOrg) {
      return {
        organization: testOrg as unknown as ActingOrg,
        // No switcher in preview: the whole point is that it cannot wander
        // into a real store's submission.
        adminOrgOptions: [],
        isActingAsOther: true,
      };
    }
    // No test store configured — fall through rather than silently previewing
    // against a real one.
  }

  /*
    A person can hold roles at more than one member store — someone who moved
    institutions, or who covers two campuses. Prefer the store where they are
    actually org_admin, then name order, so the same person lands on the same
    store every request rather than whichever row the database returned first.
  */
  const ownOrg =
    ((userOrgs ?? [])
      .filter((uo) => {
        const org = uo.organization as { type?: string } | null;
        return org?.type === "Member" && (uo.role === "org_admin" || isAdmin);
      })
      .sort((a, b) => {
        const adminFirst =
          Number(b.role === "org_admin") - Number(a.role === "org_admin");
        if (adminFirst !== 0) return adminFirst;
        const an = (a.organization as { name?: string } | null)?.name ?? "";
        const bn = (b.organization as { name?: string } | null)?.name ?? "";
        return an.localeCompare(bn);
      })[0]?.organization as ActingOrg | undefined) ?? null;

  if (!isAdmin) {
    return { organization: ownOrg, adminOrgOptions: [], isActingAsOther: false };
  }

  const db = createAdminClient();
  let roster: ActingOrg[] = [];

  if (surveyId) {
    const { data: recipientRows } = await db
      .from("benchmarking_recipients")
      .select("organization:organizations(id, name, slug, type, province)")
      .eq("survey_id", surveyId);

    roster = (recipientRows ?? [])
      .map((r) => (r as { organization: unknown }).organization as ActingOrg | null)
      .filter((o): o is ActingOrg => Boolean(o));
  }

  // No recipient list yet — the state between creating a survey and inviting
  // anyone. Paid-up member stores is the closest true answer.
  if (roster.length === 0) {
    const { data: memberOrgs } = await db
      .from("organizations")
      .select("id, name, slug, type, province")
      .eq("type", "Member")
      .in("membership_status", ["active", "grace"])
      .is("archived_at", null)
      .order("name");
    roster = (memberOrgs ?? []) as unknown as ActingOrg[];
  }

  roster.sort((a, b) => a.name.localeCompare(b.name));

  const actingAsOrg = requestedOrgId
    ? (roster.find((o) => o.id === requestedOrgId) ?? null)
    : null;

  // A deliberate ?org= wins over the admin's own membership, so an admin who
  // does run a store can still look at someone else's.
  const organization = actingAsOrg ?? ownOrg;

  return {
    organization,
    adminOrgOptions: roster.map((o) => ({ id: o.id, name: o.name })),
    isActingAsOther: Boolean(actingAsOrg && actingAsOrg.id !== ownOrg?.id),
  };
}
