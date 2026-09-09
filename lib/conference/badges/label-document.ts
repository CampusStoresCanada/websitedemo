/**
 * Build the reprint label for one job — the pipeline entry point.
 *
 * ⛔ This module exists because the label renderer had ZERO callers. It was real
 * code with real tests reading live config, and it was an island: nothing in the
 * application could produce a label, and the only thing that ever called it was
 * a scratch script. Demonstrating it that way is showing the island as if it
 * were the road.
 *
 * Same shape as buildBadgeJobDocument: takes a job id, returns HTML the print
 * endpoint serves.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeBadgeTemplateConfig, resolveBadgeVariant } from "@/lib/conference/badges/template";
import { renderReprintLabel } from "@/lib/conference/badges/label-html";
import { reservedPlatesFromOverlay } from "@/lib/conference/badges/label-placement";
import { normalizeBadgePrintStock } from "@/lib/conference/badges/print-stock";
import QRCode from "qrcode";
import {
  badgeScanUrl, deriveBadgeToken, BADGE_TOKEN_FORMAT,
} from "@/lib/conference/badges/tokens";
import { DEFAULT_REPRINT_STOCK, type ReprintPlan } from "@/lib/conference/badges/reprint-plan";

export class LabelDocumentError extends Error {}

/**
 * ⚠️ The overlay a variant prints on decides which plates are reserved, and the
 * two overlays differ: the exhibitor one has a QR plate, the delegate one does
 * not. Choosing by `front_qr` in the layer order rather than by a name keeps
 * this correct for a conference whose registration types are called something
 * else entirely.
 */
async function platesForVariant(front: { layerOrder: string[] }, canvasWidthPx: number) {
  const file = front.layerOrder.includes("front_qr")
    ? "exhibitor-front-overlay-v2.svg"
    : "delegate-front-overlay-v2.svg";
  try {
    const svg = await readFile(path.join(process.cwd(), "public", "badges", file), "utf8");
    return reservedPlatesFromOverlay(svg, canvasWidthPx);
  } catch {
    // ⛔ No plates is NOT the same as no constraint. Returning [] would let a
    // label size itself over a QR. Refuse instead: a badge that stops scanning
    // fails at a door, silently, in front of somebody.
    throw new LabelDocumentError(
      `Could not read the badge overlay (${file}); refusing to place a label without knowing what it must stay clear of.`
    );
  }
}

/**
 * The person's badge QR, derived the same way the printed badge derives it.
 *
 * ⛔ From the token ROW ID through deriveBadgeToken — not re-minted, not the
 * person id. A second derivation rule would produce a code that scans to
 * nothing while looking perfectly valid.
 *
 * ⚠️ Returns null when the person has no token row, and the caller must treat
 * that as "no back label" rather than printing an empty sticker.
 */
async function personQrDataUri(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any, conferenceId: string, personId: string
): Promise<string | null> {
  const { data: row } = await db
    .from("conference_badge_tokens")
    .select("id, token_format, revoked_at")
    .eq("conference_id", conferenceId)
    .eq("person_id", personId)
    .maybeSingle();
  if (!row || row.revoked_at) return null;
  if (row.token_format !== BADGE_TOKEN_FORMAT) return null;
  const svg = await QRCode.toString(badgeScanUrl(deriveBadgeToken(conferenceId, row.id as string)), {
    type: "svg", errorCorrectionLevel: "M", margin: 0,
  });
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

export async function buildReprintLabelDocument(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  jobId: string;
  /** Which sticker. A reprint onto a blank needs both. */
  side?: "front" | "back";
}): Promise<{ html: string; widthMm: number; heightMm: number; side: "front" | "back" }> {
  const { db, conferenceId, jobId } = params;

  const { data: job } = await db
    .from("badge_print_jobs")
    .select("id, person_id, pipeline_type, metadata, template_version")
    .eq("id", jobId)
    .eq("conference_id", conferenceId)
    .maybeSingle();
  if (!job) throw new LabelDocumentError("That print job does not exist.");
  if (job.pipeline_type !== "onsite_reprint") {
    throw new LabelDocumentError("Only an on-site reprint produces a label.");
  }

  // ⛔ The plan is read from the JOB, not recomputed. What the desk had in hand
  // is a fact about that moment — blanks get used up — so re-deriving it later
  // would describe a different card from the one that was printed.
  const plan = (job.metadata as Record<string, unknown> | null)?.reprint_plan as ReprintPlan | undefined;
  if (!plan) throw new LabelDocumentError("This job carries no reprint plan; it predates label printing.");
  if (plan.transport !== "ql_label") {
    throw new LabelDocumentError("This reprint is a full badge, not a label.");
  }

  const { data: person } = await db
    .from("conference_people")
    .select("id, display_name, role_title, organization_id, organizations(name)")
    .eq("id", job.person_id)
    .maybeSingle();
  if (!person) throw new LabelDocumentError("That person is no longer on this conference.");

  const { data: seat } = await db
    .from("entity_balance_seats")
    .select("entity_id")
    .eq("holder_person_id", job.person_id)
    .eq("conference_id", conferenceId)
    .limit(1)
    .maybeSingle();

  const { data: tplRow } = await db
    .from("badge_template_configs")
    .select("field_mapping")
    .eq("conference_id", conferenceId)
    .order("config_version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const template = normalizeBadgeTemplateConfig(tplRow?.field_mapping);

  // ⛔ Same resolver the badge printer uses. A label resolved any other way is a
  // second answer to "what does this person's badge look like".
  const { front } = resolveBadgeVariant(template, { variantKey: seat?.entity_id ?? null });

  const display = String(person.display_name ?? "").trim();
  const gap = display.lastIndexOf(" ");
  const stock = plan.stockSpec ?? DEFAULT_REPRINT_STOCK;

  const side = params.side ?? "front";
  const qrDataUri = side === "back"
    ? await personQrDataUri(db, conferenceId, job.person_id as string)
    : null;
  if (side === "back" && !qrDataUri) {
    throw new LabelDocumentError(
      "No usable badge token for this person, so there is no back label to print. " +
      "A back sticker with no QR would look like a finished reprint and scan as nothing."
    );
  }
  const out = renderReprintLabel({
    side,
    qrDataUri,
    person: {
      firstName: gap > 0 ? display.slice(0, gap) : display,
      lastName: gap > 0 ? display.slice(gap + 1) : "",
      roleTitle: String(person.role_title ?? ""),
      organizationName: (person.organizations as { name?: string } | null)?.name ?? "",
    },
    template: { ...template, front },
    delta: plan.delta,
    stock,
    anchorTextToEdge: true,
    reserved: await platesForVariant(front, template.canvas.widthIn * template.canvas.dpi),
  });

  if (!out.html) throw new LabelDocumentError("There is nothing to print on this label.");
  return { html: out.html, widthMm: out.widthMm, heightMm: out.heightMm, side };
}

/** So the print stock policy stays one normalizer. */
export { normalizeBadgePrintStock };
