"use server";

import { requireAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConferenceCatalogReadiness } from "@/lib/actions/conference-entities";
import {
  computeAnnounceReadiness,
  computeLaunchReadiness,
  type AnnounceReadiness,
  type LaunchReadiness,
  type LaunchReadinessInput,
} from "@/lib/conference/launch-readiness";

/**
 * Assembles the launch-readiness input from the database and runs the pure
 * engine. Consumed by the Overview checklist UI and by
 * transitionConferenceStatus (the go-on-sale gate) — one model, no drift.
 * See docs/CONFERENCE_V2_BLUEPRINT.md.
 */

type Result<T> = { success: true; data: T } | { success: false; error: string };

export async function loadLaunchReadinessInput(
  conferenceId: string
): Promise<Result<LaunchReadinessInput>> {
  const db = createAdminClient();

  const [conferenceRes, daysRes, legalRes, catalogReadinessRes] = await Promise.all([
    db
      .from("conference_instances")
      .select(
        "start_date, end_date, registration_open_at, registration_close_at, tax_rate_pct, stripe_tax_rate_id"
      )
      .eq("id", conferenceId)
      .single(),
    db.from("conference_days").select("id", { count: "exact", head: true }).eq("conference_id", conferenceId),
    db
      .from("conference_legal_versions")
      .select("id", { count: "exact", head: true })
      .eq("conference_id", conferenceId),
    getConferenceCatalogReadiness(conferenceId),
  ]);

  if (conferenceRes.error || !conferenceRes.data) {
    return { success: false, error: conferenceRes.error?.message ?? "Conference not found." };
  }

  const conference = conferenceRes.data;

  return {
    success: true,
    data: {
      startDate: conference.start_date,
      endDate: conference.end_date,
      registrationOpenAt: conference.registration_open_at,
      registrationCloseAt: conference.registration_close_at,
      dayCount: daysRes.count ?? 0,
      taxRatePct: conference.tax_rate_pct,
      stripeTaxRateId: conference.stripe_tax_rate_id,
      legalVersionCount: legalRes.count ?? 0,
      v3ThingCount: catalogReadinessRes.success ? catalogReadinessRes.data.thingCount : 0,
      v3OpenQuestionCount: catalogReadinessRes.success ? catalogReadinessRes.data.openQuestionCount : 0,
      v3ForSaleCount: catalogReadinessRes.success ? catalogReadinessRes.data.forSaleCount : 0,
    },
  };
}

export type ConferenceStatusReadiness = {
  announce: AnnounceReadiness;
  launch: LaunchReadiness;
};

/**
 * The one readiness loader for the conference lifecycle — covers both gated
 * transitions (draft → announced, announced → registration_open) from a
 * single DB round-trip. Consumed by ConferenceLifecycle, the single control
 * component shared by the Overview and Status admin pages, and mirrors
 * exactly what performConferenceStatusTransition itself gates on — one
 * model, no drift between what the UI shows and what the server allows.
 */
export async function getConferenceStatusReadiness(
  conferenceId: string
): Promise<Result<ConferenceStatusReadiness>> {
  const auth = await requireAdmin();
  if (!auth.ok) return { success: false, error: auth.error };

  const input = await loadLaunchReadinessInput(conferenceId);
  if (!input.success) return input;
  return {
    success: true,
    data: {
      announce: computeAnnounceReadiness(input.data),
      launch: computeLaunchReadiness(input.data),
    },
  };
}
