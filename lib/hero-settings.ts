import { createAdminClient } from "@/lib/supabase/admin";
import { PUBLIC_CONFERENCE_STATUSES } from "@/lib/constants/conference";
import { fetchConferenceStartingPrices, fetchBoothCount } from "@/lib/homepage-slides";
import { HERO_KINDS, type HeroKind, type HeroKindSetting, type HeroAreaSettings } from "@/lib/hero-kinds";

// Re-exported so existing server-side callers can keep importing everything
// from this one module — only the /admin/hero-area client form needs to
// import lib/hero-kinds.ts directly, to avoid bundling this file's
// server-only Supabase admin client code.
export { HERO_KINDS, type HeroKind, type HeroKindSetting, type HeroAreaSettings };

/** Matches the DB defaults seeded in the hero_area_settings migration — used only as a defensive fallback if a row is ever missing. */
const FALLBACK_KIND_SETTING: HeroKindSetting = { enabled: true, weight: 1 };
const FALLBACK_CYCLE_INTERVAL_MS = 9000;

/**
 * Reads the admin-configurable rotation settings for the homepage hero.
 * Used both by the public homepage (app/page.tsx, to drive MapAttract's
 * actual rotation) and by the /admin/hero-area form (to populate its
 * current values). Defensive per-kind fallback if a row is somehow missing
 * — the homepage must never break because hero_slide_settings is incomplete.
 */
export async function getHeroAreaSettings(): Promise<HeroAreaSettings> {
  const db = createAdminClient();
  const [{ data: configRow }, { data: kindRows }] = await Promise.all([
    db.from("hero_area_config").select("cycle_interval_ms").limit(1).maybeSingle(),
    db.from("hero_slide_settings").select("kind, enabled, weight"),
  ]);

  const kinds = {} as Record<HeroKind, HeroKindSetting>;
  for (const kind of HERO_KINDS) {
    const row = kindRows?.find((r) => r.kind === kind);
    kinds[kind] = row ? { enabled: row.enabled, weight: row.weight } : { ...FALLBACK_KIND_SETTING };
  }

  return {
    cycleIntervalMs: configRow?.cycle_interval_ms ?? FALLBACK_CYCLE_INTERVAL_MS,
    kinds,
  };
}

export interface ConferencePricingPreview {
  conferenceId: string;
  conferenceName: string;
  boothCents: number | null;
  memberRegistrationCents: number | null;
  boothCount: number;
}

/**
 * The same conference the homepage's conference slide targets when viewed
 * by an admin (nearest conference with coordinates, admin-visible statuses
 * including draft) — plus real live pricing/capacity, for the Hero Area
 * admin form's CTA-template preview. Not exported from homepage-slides.ts's
 * fetchConferencePin() directly since that resolves ONE viewer role's CTA;
 * the admin preview needs all three roles' prices side by side.
 */
export async function getConferencePricingPreview(): Promise<ConferencePricingPreview | null> {
  const db = createAdminClient();
  const { data } = await db
    .from("conference_instances")
    .select("id, name")
    .in("status", [...PUBLIC_CONFERENCE_STATUSES, "draft"])
    .not("location_latitude", "is", null)
    .not("location_longitude", "is", null)
    .order("start_date", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const [prices, boothCount] = await Promise.all([
    fetchConferenceStartingPrices(db, data.id),
    fetchBoothCount(db, data.id),
  ]);

  return {
    conferenceId: data.id,
    conferenceName: data.name,
    boothCents: prices.boothCents,
    memberRegistrationCents: prices.memberRegistrationCents,
    boothCount,
  };
}
