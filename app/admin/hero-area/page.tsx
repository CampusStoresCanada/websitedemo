import { redirect } from "next/navigation";
import { requireSuperAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import HeroAreaForm from "@/components/admin/hero-area/HeroAreaForm";
import { getHeroAreaSettings, getConferencePricingPreview } from "@/lib/hero-settings";
import { formatCtaPrice } from "@/lib/homepage-slides";

export const metadata = {
  title: "Hero Area | Admin | Campus Stores Canada",
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HeroAreaPage() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) redirect("/admin");

  const db = createAdminClient();

  const [heroSettings, pricingPreview, { data: contentRows }] = await Promise.all([
    getHeroAreaSettings(),
    getConferencePricingPreview(),
    db
      .from("site_content")
      .select("section, title, subtitle, body")
      .in("section", [
        "conference_slide",
        "conference_slide_stats",
        "conference_slide_included",
        "conference_slide_cta_admin",
        "conference_slide_cta_partner",
        "conference_slide_cta_member",
      ]),
  ]);

  const bySection = Object.fromEntries((contentRows ?? []).map((r) => [r.section, r]));

  const conferenceContent = {
    title: bySection["conference_slide"]?.title ?? "",
    statValue: bySection["conference_slide_stats"]?.title ?? "",
    statLabel: bySection["conference_slide_stats"]?.subtitle ?? "",
    includedItems: (bySection["conference_slide_included"]?.body ?? "")
      .split("\n")
      .map((s: string) => s.trim())
      .filter(Boolean),
    ctaTemplates: {
      admin: bySection["conference_slide_cta_admin"]?.body ?? "",
      partner: bySection["conference_slide_cta_partner"]?.body ?? "",
      member: bySection["conference_slide_cta_member"]?.body ?? "",
    },
  };

  return (
    <main>
      <AdminPageHeader
        title="Hero Area"
        description="Controls for the homepage's rotating map hero — how often each slide type appears, and the conference slide's marketing content."
      />

      <HeroAreaForm
        heroSettings={heroSettings}
        conferenceContent={conferenceContent}
        pricingPreview={
          pricingPreview
            ? {
                boothPriceLabel: pricingPreview.boothCents != null ? formatCtaPrice(pricingPreview.boothCents) : null,
                memberRegistrationPriceLabel:
                  pricingPreview.memberRegistrationCents != null ? formatCtaPrice(pricingPreview.memberRegistrationCents) : null,
              }
            : null
        }
      />
    </main>
  );
}
