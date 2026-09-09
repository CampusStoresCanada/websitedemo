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

export async function buildReprintLabelDocument(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- admin or service-role client
  db: any;
  conferenceId: string;
  jobId: string;
}): Promise<{ html: string; widthMm: number; heightMm: number }> {
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

  const out = renderReprintLabel({
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
  return { html: out.html, widthMm: out.widthMm, heightMm: out.heightMm };
}

/** So the print stock policy stays one normalizer. */
export { normalizeBadgePrintStock };
