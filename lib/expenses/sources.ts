import type { AuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { canFillBursaryRequest } from "@/lib/conference/bursary-access";

/**
 * What the record that entitled a claim has to say about it.
 *
 * A claim may point at the record that entitled it (expense_claims.source_table
 * / source_id). That record decides two things the expense module can't know
 * on its own: who besides the organization's admins may fill the claim in, and
 * which of the program's slots this claim may use. One entry per source table;
 * a claim with no source falls back to the organization's admins and every
 * slot.
 */
export type ClaimSource = {
  /** May this person fill in the claim? Admins of the organization always may. */
  canEdit: (ctx: AuthContext, claim: { organization_id: string }) => Promise<boolean>;
  /** The program slots open to this claim. Null means all of them. */
  allowedKeys: () => readonly string[] | null;
  /** The page the claimant files this claim on, from the site root. Emails link to it. */
  path: string;
};

type SourceResolver = (sourceId: string) => Promise<ClaimSource | null>;

const SOURCES: Record<string, SourceResolver> = {
  /**
   * The travel bursary: the school's approved request. Its people file the
   * claim, and the claim covers what the request asked for: hotel, travel
   * (airfare, train or mileage), or both.
   */
  conference_bursary_applications: async (sourceId) => {
    const { data } = await createAdminClient()
      .from("conference_bursary_applications")
      .select("conference_id, organization_id, covers_hotel, covers_travel, conference:conference_instances(year, edition_code)")
      .eq("id", sourceId)
      .maybeSingle();
    if (!data) return null;
    const keys = [...(data.covers_hotel ? ["hotel"] : []), ...(data.covers_travel ? ["airfare", "train", "mileage"] : [])];
    return {
      canEdit: (ctx) => canFillBursaryRequest(ctx, data.conference_id, data.organization_id),
      allowedKeys: () => keys,
      path: data.conference ? `/conference/${data.conference.year}/${data.conference.edition_code}/bursary` : "/",
    };
  },
};

export async function resolveClaimSource(
  sourceTable: string | null,
  sourceId: string | null
): Promise<ClaimSource | null> {
  if (!sourceTable || !sourceId) return null;
  const resolver = SOURCES[sourceTable];
  return resolver ? resolver(sourceId) : null;
}
