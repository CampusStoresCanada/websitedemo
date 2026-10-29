import "server-only";

/**
 * What a print station (the laptop beside the QL) can do, on the server.
 *
 * ⛔ Authenticated by its OWN key (print-station.ts), never a session: a laptop
 * left at a desk for four days must not hold somebody's login. The key reaches
 * exactly one conference's on-site reprint stickers and nothing else.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { claimExpired, hashPrintStationKey, keyFromAuthorization } from "@/lib/conference/badges/print-station";
import { stickersFor, type ReprintPlan, type StickerSide } from "@/lib/conference/badges/reprint-plan";

export type PrintStation = {
  id: string;
  conferenceId: string;
  label: string;
  createdBy: string | null;
};

/** The station behind `Authorization: Bearer <key>`, or null. Revoked keys fail. */
export async function authenticatePrintStation(request: Request): Promise<PrintStation | null> {
  const key = keyFromAuthorization(request.headers.get("authorization"));
  if (!key) return null;
  const { data } = await createAdminClient()
    .from("print_stations")
    .select("id, conference_id, label, created_by, revoked_at")
    .eq("key_hash", hashPrintStationKey(key))
    .maybeSingle();
  if (!data || data.revoked_at) return null;
  return {
    id: data.id as string,
    conferenceId: data.conference_id as string,
    label: data.label as string,
    createdBy: (data.created_by as string | null) ?? null,
  };
}

/** "I'm here, and this is what the printer last said." */
export async function recordHeartbeat(
  station: PrintStation,
  printer: { status: string | null; media: string | null }
): Promise<{ conferenceName: string }> {
  const db = createAdminClient();
  await db
    .from("print_stations")
    .update({
      last_seen_at: new Date().toISOString(),
      printer_status: printer.status?.slice(0, 200) ?? null,
      printer_media: printer.media?.slice(0, 200) ?? null,
    })
    .eq("id", station.id);
  const { data } = await db.from("conference_instances").select("name").eq("id", station.conferenceId).maybeSingle();
  return { conferenceName: (data?.name as string | null) ?? "Conference" };
}

export type ClaimedJob = { jobId: string; personName: string; stickers: StickerSide[] };

/**
 * Take the oldest queued sticker job for this station's conference.
 *
 * ⛔ ATOMIC: the claim is an update guarded on the status and timestamp just
 * read, so two stations polling at once can never both print one job. A claim
 * nobody reported back on goes back to the queue after CLAIM_EXPIRES_SECONDS.
 */
export async function claimNextJob(station: PrintStation): Promise<ClaimedJob | null> {
  const db = createAdminClient();
  const { data: candidates, error } = await db
    .from("badge_print_jobs")
    .select("id, person_id, status, updated_at, metadata")
    .eq("conference_id", station.conferenceId)
    .eq("pipeline_type", "onsite_reprint")
    .eq("transport_method", "printer_bridge")
    .in("status", ["sent_to_printer", "rendering"])
    .order("updated_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(error.message);

  for (const job of candidates ?? []) {
    if (job.status === "rendering" && !claimExpired(job.updated_at as string)) continue;
    // ⛔ A job routed to another desk's printer is not ours (sendReprintToQueue).
    const target = (job.metadata as { print_station_id?: string } | null)?.print_station_id;
    if (target && target !== station.id) continue;
    const stickers = stickersFor((job.metadata as { reprint_plan?: ReprintPlan } | null)?.reprint_plan);
    const { data: claimed } = await db
      .from("badge_print_jobs")
      .update({ status: "rendering", printer_bridge_state: "healthy", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", job.status as string)
      .eq("updated_at", job.updated_at as string)
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // another station got it first

    if (stickers.length === 0) {
      // A full colour badge is not a QL job: nothing this station can print.
      await finishJob(station, job.id as string, job.person_id as string | null, {
        ok: false,
        retry: false,
        error: "This reprint is a full colour badge, not stickers.",
      });
      continue;
    }
    const { data: person } = await db
      .from("conference_people")
      .select("display_name")
      .eq("id", job.person_id as string)
      .maybeSingle();
    return {
      jobId: job.id as string,
      personName: (person?.display_name as string | null) ?? "",
      stickers,
    };
  }
  return null;
}

/** Is this one of the station's conference's on-site reprints it may read? */
export async function stationMayReadJob(station: PrintStation, jobId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("badge_print_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("conference_id", station.conferenceId)
    .eq("pipeline_type", "onsite_reprint")
    .maybeSingle();
  return Boolean(data);
}

/**
 * The station's report. Printed → done. A PRINTER problem (wrong roll, out of
 * film, lid open) → back to the queue to print when it is fixed (`retry`).
 * A STICKER problem (cannot be drawn) → failed, so it does not loop forever.
 */
export async function finishJob(
  station: PrintStation,
  jobId: string,
  personId: string | null,
  result: { ok: boolean; retry: boolean; error?: string | null }
): Promise<void> {
  const db = createAdminClient();
  const now = new Date().toISOString();
  const status = result.ok ? "printed" : result.retry ? "sent_to_printer" : "failed";
  await db
    .from("badge_print_jobs")
    .update({
      status,
      printer_bridge_state: result.ok ? "healthy" : "degraded",
      completed_at: result.ok ? now : null,
      // The reason lives on the job's event history (badge_print_events) below.
      updated_at: now,
    })
    .eq("id", jobId)
    .eq("conference_id", station.conferenceId);
  const { error: eventError } = await db.from("badge_print_events").insert({
    job_id: jobId,
    conference_id: station.conferenceId,
    person_id: personId,
    event_type: result.ok ? "printed" : "print_station_error",
    event_status: result.ok ? "success" : "error",
    message: result.ok
      ? `Printed at print station "${station.label}".`
      : `Print station "${station.label}": ${result.error ?? "printing failed"}${result.retry ? " (will retry)" : ""}`,
    actor_id: station.createdBy,
    payload: { stationId: station.id },
  });
  // The failure reason exists nowhere else, so losing this insert loses it.
  if (eventError) {
    console.error(`[print-station] event for job ${jobId} not saved: ${eventError.message}`);
  }
}
