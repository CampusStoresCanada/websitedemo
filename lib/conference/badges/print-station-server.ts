import "server-only";

/**
 * What a print station (the laptop beside the QL) can do, on the server.
 *
 * ⛔ Authenticated by its OWN key (print-station.ts), never a session: a laptop
 * left at a desk for four days must not hold somebody's login. The key reaches
 * exactly one conference's queued print jobs — reprint stickers, and documents
 * an admin sent from the War Room — and nothing else.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { claimExpired, hashPrintStationKey, keyFromAuthorization } from "@/lib/conference/badges/print-station";
import { stickersFor, type ReprintPlan, type StickerSide } from "@/lib/conference/badges/reprint-plan";
import { parseConferenceDocuments, pdfSourceUrl } from "@/lib/conference-documents";

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

/**
 * A claimed job. `kind` is new with documents: a station that predates it reads
 * only `stickers`, and is never handed a document (see `acceptsDocuments`).
 */
export type ClaimedJob =
  | { jobId: string; kind: "stickers"; personName: string; stickers: StickerSide[] }
  | { jobId: string; kind: "document"; title: string };

/** The queue's two kinds of job: a reprint's stickers, and a document to print on paper. */
const STATION_PIPELINES = ["onsite_reprint", "document"] as const;

/**
 * Take the oldest queued job for this station's conference.
 *
 * ⛔ ATOMIC: the claim is an update guarded on the status and timestamp just
 * read, so two stations polling at once can never both print one job. A claim
 * nobody reported back on goes back to the queue after CLAIM_EXPIRES_SECONDS.
 *
 * Documents (War Room → Send to printer) go only to a station that says it can
 * print them: one running the older app would read a document as a sticker job
 * with no stickers and fail it.
 */
export async function claimNextJob(
  station: PrintStation,
  options: { acceptsDocuments?: boolean } = {}
): Promise<ClaimedJob | null> {
  const db = createAdminClient();
  const { data: candidates, error } = await db
    .from("badge_print_jobs")
    .select("id, person_id, status, updated_at, metadata, pipeline_type")
    .eq("conference_id", station.conferenceId)
    .in("pipeline_type", options.acceptsDocuments ? [...STATION_PIPELINES] : ["onsite_reprint"])
    .eq("transport_method", "printer_bridge")
    .in("status", ["sent_to_printer", "rendering"])
    .order("updated_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);

  for (const job of candidates ?? []) {
    if (job.status === "rendering" && !claimExpired(job.updated_at as string)) continue;
    const isDocument = job.pipeline_type === "document";
    const stickers = isDocument
      ? []
      : stickersFor((job.metadata as { reprint_plan?: ReprintPlan } | null)?.reprint_plan);
    const { data: claimed } = await db
      .from("badge_print_jobs")
      .update({ status: "rendering", printer_bridge_state: "healthy", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", job.status as string)
      .eq("updated_at", job.updated_at as string)
      .select("id")
      .maybeSingle();
    if (!claimed) continue; // another station got it first

    if (isDocument) {
      const title = (job.metadata as { label?: string } | null)?.label ?? "Document";
      return { jobId: job.id as string, kind: "document", title };
    }

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
      kind: "stickers",
      personName: (person?.display_name as string | null) ?? "",
      stickers,
    };
  }
  return null;
}

/** Is this one of the station's conference's queued jobs it may read? */
export async function stationMayReadJob(station: PrintStation, jobId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from("badge_print_jobs")
    .select("id")
    .eq("id", jobId)
    .eq("conference_id", station.conferenceId)
    .in("pipeline_type", [...STATION_PIPELINES])
    .maybeSingle();
  return Boolean(data);
}

/** A document job's file could not become a PDF — retrying will not help. */
export class DocumentNotPrintable extends Error {}

const PDF_MAGIC = "%PDF";

/**
 * A queued document, as the PDF the station sends to the paper printer.
 *
 * Fetched HERE, not by the laptop: the station's key reaches this site and
 * nothing else, and a stored file needs signing that only the server can do.
 * Only the documents admins attached on the conference's Documents page can be
 * queued, so this reads no address a station chose.
 */
export async function documentPdfForJob(station: PrintStation, jobId: string): Promise<{ bytes: ArrayBuffer; title: string }> {
  const db = createAdminClient();
  const [{ data: job }, { data: conference }] = await Promise.all([
    db
      .from("badge_print_jobs")
      .select("metadata")
      .eq("id", jobId)
      .eq("conference_id", station.conferenceId)
      .eq("pipeline_type", "document")
      .maybeSingle(),
    db.from("conference_instances").select("documents").eq("id", station.conferenceId).maybeSingle(),
  ]);
  const documentId = (job?.metadata as { document_id?: string } | null)?.document_id;
  if (!documentId) throw new DocumentNotPrintable("This print job names no document.");
  const doc = parseConferenceDocuments(conference?.documents).find((d) => d.id === documentId);
  if (!doc) throw new DocumentNotPrintable("That document is no longer on the conference's Documents page.");

  let bytes: ArrayBuffer;
  if (doc.storage_path) {
    const { data, error } = await db.storage.from("conference-documents").download(doc.storage_path);
    if (error || !data) throw new Error(`Could not read the stored file: ${error?.message ?? "missing"}`);
    bytes = await data.arrayBuffer();
  } else if (doc.url) {
    const response = await fetch(pdfSourceUrl(doc.url), { redirect: "follow", cache: "no-store" });
    if (!response.ok) throw new Error(`The document's address answered ${response.status}.`);
    bytes = await response.arrayBuffer();
  } else {
    throw new DocumentNotPrintable("This document has neither a file nor a link.");
  }

  // A Google Doc nobody shared publicly answers with a sign-in PAGE, not an
  // error, so the bytes are the only honest test.
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== PDF_MAGIC) {
    throw new DocumentNotPrintable(
      doc.url
        ? `"${doc.label}" didn't come back as a PDF. If it's a Google Doc, share it as "anyone with the link can view".`
        : `"${doc.label}" isn't a PDF. Upload it as a PDF to print it.`
    );
  }
  return { bytes, title: doc.label };
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
  await db.from("badge_print_events").insert({
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
}
