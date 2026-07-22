/**
 * Pure constants/types for the homepage hero's rotation kinds — kept in
 * their own file with zero other imports so client components (the
 * /admin/hero-area form) can import HERO_KINDS as a runtime value without
 * pulling in lib/hero-settings.ts's server-only Supabase admin client code.
 */
export const HERO_KINDS = ["story", "conference", "personalized", "newest_org", "sponsor"] as const;
export type HeroKind = (typeof HERO_KINDS)[number];

export interface HeroKindSetting {
  enabled: boolean;
  weight: number;
}

export interface HeroAreaSettings {
  cycleIntervalMs: number;
  kinds: Record<HeroKind, HeroKindSetting>;
}
