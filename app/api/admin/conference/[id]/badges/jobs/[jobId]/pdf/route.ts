import { NextResponse } from "next/server";
import { requireConferenceDeskAccess, requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildBadgeJobDocument,
  BadgeDocumentError,
} from "@/lib/conference/badges/document";
import {
  buildReprintLabelDocument,
  combineStickerDocuments,
  LabelDocumentError,
} from "@/lib/conference/badges/label-document";
import { stickersFor, type ReprintPlan } from "@/lib/conference/badges/reprint-plan";

/**
 * Serve one badge job's printable document.
 *
 * Auth and the HTTP shape live here; the document itself is built by
 * lib/conference/badges/document.ts so a PDF renderer can produce the identical
 * bytes without going through a browser session.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; jobId: string }> }
) {
  // ── The QL sticker(s) for an on-site reprint (?side=front|back|schedule|all) ─
  // ⛔ The label renderer was written and never served: this route imported it
  // and only ever returned the full colour badge, which a QL cannot print.
  // Desk staff may open their own conference's reprint labels (the builder
  // refuses any other job); the full badge below stays admin-only.
  const url = new URL(request.url);
  const side = url.searchParams.get("side");
  if (side === "front" || side === "back" || side === "schedule" || side === "all") {
    const { id: labelConferenceId, jobId: labelJobId } = await context.params;
    const deskAuth = await requireConferenceDeskAccess(labelConferenceId);
    if (!deskAuth.ok) return NextResponse.json({ error: deskAuth.error }, { status: 403 });
    try {
      const db = createAdminClient();
      let html: string;
      if (side === "all") {
        // ⛔ One print job, every sticker at its own length — see
        // combineStickerDocuments. The job's plan says which stickers.
        const { data: job } = await db
          .from("badge_print_jobs")
          .select("metadata")
          .eq("id", labelJobId)
          .eq("conference_id", labelConferenceId)
          .maybeSingle();
        const sides = stickersFor((job?.metadata as { reprint_plan?: ReprintPlan } | null)?.reprint_plan);
        if (sides.length === 0) throw new LabelDocumentError("This reprint is a full badge, not stickers.");
        const docs = [];
        for (const one of sides) {
          docs.push(await buildReprintLabelDocument({ db, conferenceId: labelConferenceId, jobId: labelJobId, side: one }));
        }
        html = combineStickerDocuments(docs);
      } else {
        html = (await buildReprintLabelDocument({ db, conferenceId: labelConferenceId, jobId: labelJobId, side })).html;
      }
      // `print=1`: "Print now" on the device in hand. Open the print dialog as
      // soon as the sticker has drawn (AirPrint on an iPad or iPhone, the
      // Brother driver on a laptop).
      const autoPrint =
        url.searchParams.get("print") === "1"
          ? `<script>addEventListener("load",function(){setTimeout(function(){print()},400)})</script>`
          : "";
      const body = html.includes("</body>") ? html.replace("</body>", `${autoPrint}</body>`) : html + autoPrint;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `inline; filename="label-${labelJobId}-${side}.html"`,
        },
      });
    } catch (error) {
      if (error instanceof LabelDocumentError) {
        return NextResponse.json({ error: error.message }, { status: 422 });
      }
      throw error;
    }
  }

  const auth = await requireConferenceOpsAccess();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 403 });

  const { id: conferenceId, jobId } = await context.params;

  try {
    const { html } = await buildBadgeJobDocument({
      db: createAdminClient(),
      conferenceId,
      jobId,
    });
    return new NextResponse(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-disposition": `inline; filename="badge-job-${jobId}.html"`,
      },
    });
  } catch (error) {
    if (error instanceof BadgeDocumentError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
