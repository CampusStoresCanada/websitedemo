import type { Metadata } from "next";
import CircleAnnouncementFeed from "@/components/circle/CircleAnnouncementFeed";
import ThreeDoors from "@/components/resources/ThreeDoors";
import { getSiteContent } from "@/lib/data";
import { fieldProps } from "@/lib/editable-fields";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic"; // auth-aware, can't statically cache

export const metadata: Metadata = {
  title: "Resources | Campus Stores Canada",
  description:
    "Benchmarking data, peer network, and advocacy resources for campus store professionals.",
};

export default async function ResourcesPage() {
  const [heroContent, authCtx] = await Promise.all([
    getSiteContent("resources_hero"),
    getOptionalAuthContext(),
  ]);

  const hero       = heroContent[0] ?? null;
  const userId     = authCtx?.userId ?? null;
  const globalRole = (authCtx as any)?.globalRole ?? null;
  const isAdmin    = globalRole === "super_admin" || globalRole === "admin";

  // ── Viewer-dependent data ──────────────────────────────────────────────────
  let userOrgType: string | null   = null;
  let userOrgSlug: string | null   = null;
  let userOrgId:   string | null   = null;
  let hasSubmission                = false;
  let activeSurvey: { fiscal_year: number } | null = null;

  if (userId) {
    const db  = createAdminClient();
    const now = new Date().toISOString();

    const [membershipResult, surveyResult] = await Promise.all([
      db
        .from("user_organizations")
        .select("organization_id, organizations(id, slug, type)")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      db
        .from("benchmarking_surveys")
        .select("fiscal_year")
        .eq("status", "open")
        .lte("opens_at", now)
        .gte("closes_at", now)
        .limit(1)
        .maybeSingle(),
    ]);

    const org = (membershipResult.data?.organizations as { id: string; slug: string; type: string } | null);
    userOrgId   = membershipResult.data?.organization_id ?? null;
    userOrgSlug = org?.slug ?? null;
    userOrgType = org?.type ?? null;
    activeSurvey = surveyResult.data ?? null;

    // Check if this org has a completed benchmarking submission
    if (userOrgId) {
      const { data: submission } = await db
        .from("benchmarking")
        .select("id")
        .eq("organization_id", userOrgId)
        .in("status", ["submitted", "verified"])
        .order("fiscal_year", { ascending: false })
        .limit(1)
        .maybeSingle();
      hasSubmission = !!submission;
    }
  }

  return (
    <div>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="bg-[#1A1A1A] py-16 md:py-20">
        <div className="max-w-7xl mx-auto px-6">
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">
            Campus Stores Canada
          </p>
          <h1
            className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4 max-w-2xl"
            {...(hero ? fieldProps("site_content", "title", hero.id) : {})}
          >
            {hero?.title ?? "Resources"}
          </h1>
          <p
            className="text-lg text-[#9B9B9B] max-w-xl leading-relaxed"
            {...(hero ? fieldProps("site_content", "body", hero.id) : {})}
          >
            {hero?.body ??
              "Data, connections, and support for campus store professionals — whether you're building a case, looking for peers, or navigating a challenge."}
          </p>
        </div>
      </section>

      {/* ── Three Doors ───────────────────────────────────────────────────── */}
      <ThreeDoors
        isLoggedIn={!!userId}
        isAdmin={isAdmin}
        userOrgType={userOrgType}
        userOrgSlug={userOrgSlug}
        hasSubmission={hasSubmission}
        activeSurvey={activeSurvey}
      />

      {/* ── Community Feed ────────────────────────────────────────────────── */}
      <CircleAnnouncementFeed />
    </div>
  );
}
