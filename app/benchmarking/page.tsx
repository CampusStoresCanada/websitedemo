import BenchmarkingLanding from "@/components/benchmarking/BenchmarkingLanding";
import { getOptionalAuthContext } from "@/lib/auth/guards";

export const metadata = {
  title: "Benchmarking | Campus Stores Canada",
  description: "Annual benchmarking survey for CSC member stores.",
};

export default async function BenchmarkingPage() {
  const auth = await getOptionalAuthContext();
  const supabase = auth?.supabase;
  const userId = auth?.userId;

  if (!supabase) {
    return <BenchmarkingLanding surveys={[]} userOrgInfo={null} existingDraft={null} />;
  }

  // Fetch open/recent survey config
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: surveys } = (await (supabase as any)
    .from("benchmarking_surveys")
    .select("*")
    .order("fiscal_year", { ascending: false })
    .limit(2)) as { data: any[] | null };

  // If logged in, check their org role and survey status
  let userOrgInfo: {
    organizationId: string;
    organizationName: string;
    orgSlug: string;
    isOrgAdmin: boolean;
  } | null = null;

  let existingDraft: {
    id: string;
    status: string;
    fiscalYear: number;
    updatedAt: string | null;
  } | null = null;

  if (userId) {
    // Find user's primary member org
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: userOrgs } = (await (supabase as any)
      .from("user_organizations")
      .select(
        `
        organization_id,
        role,
        organization:organizations(id, name, slug, type)
      `
      )
      .eq("user_id", userId)
      .eq("status", "active")) as { data: any[] | null };

    const memberOrg = userOrgs?.find(
      (uo) => {
        const org = uo.organization as unknown as { type: string } | null;
        return org?.type === "Member";
      }
    );

    if (memberOrg) {
      const org = memberOrg.organization as unknown as {
        id: string;
        name: string;
        slug: string;
      };
      userOrgInfo = {
        organizationId: org.id,
        organizationName: org.name,
        orgSlug: org.slug,
        isOrgAdmin: memberOrg.role === "org_admin",
      };

      // Check for existing draft/submission for current survey year
      const activeSurvey = surveys?.find(
        (s) => s.status === "open" || s.status === "draft"
      );

      if (activeSurvey) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: draft } = (await (supabase as any)
          .from("benchmarking")
          .select("id, status, fiscal_year, updated_at")
          .eq("organization_id", org.id)
          .eq("fiscal_year", activeSurvey.fiscal_year)
          .single()) as { data: any };

        if (draft) {
          existingDraft = {
            id: draft.id,
            status: draft.status ?? "draft",
            fiscalYear: draft.fiscal_year,
            updatedAt: draft.updated_at,
          };
        }
      }
    }
  }

  return (
    <BenchmarkingLanding
      surveys={surveys ?? []}
      userOrgInfo={userOrgInfo}
      existingDraft={existingDraft}
    />
  );
}
