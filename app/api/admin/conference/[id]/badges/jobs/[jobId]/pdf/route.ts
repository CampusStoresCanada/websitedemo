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
          docs.push(await buildReprintLabelDocument({ db, conferenceId: labelConferenceId, jobId: labelJobId, side: one, forBrowserPrint: true }));
        }
        html = combineStickerDocuments(docs);
      } else {
        html = (await buildReprintLabelDocument({ db, conferenceId: labelConferenceId, jobId: labelJobId, side, forBrowserPrint: true })).html;
      }
      // `print=1`: "Print now" on the device in hand. Open the print dialog as
      // soon as the sticker has drawn (AirPrint on an iPad or iPhone, the
      // Brother driver on a laptop).
      // `print=1`: a PERSON tapped "Print now". ⛔ Safari (above all on an iPad)
      // ignores a print() that no tap started, so the auto-print alone can do
      // nothing at all. A big Print button — a tap — always works; the
      // auto-print stays for browsers that allow it. The bar never prints.
      const forPerson = url.searchParams.get("print") === "1";
      const printBar = forPerson
        ? `<style>@media print{.no-print{display:none!important}}</style>` +
          `<div class="no-print" style="position:fixed;top:0;left:0;right:0;z-index:9;display:flex;gap:12px;align-items:center;` +
          `padding:12px;background:#111;color:#fff;font:16px -apple-system,Helvetica,Arial,sans-serif;">` +
          `<button onclick="print()" style="font-size:18px;font-weight:600;padding:12px 28px;border-radius:8px;border:0;background:#fff;color:#000;">Print stickers</button>` +
          `<span>Choose the Brother QL printer, 62 mm roll, at 100%.</span></div>`
        : "";
      const autoPrint = forPerson
        ? `<script>addEventListener("load",function(){setTimeout(function(){try{print()}catch(e){}},400)})</script>`
        : "";
      const withBar = html.includes("<body>") ? html.replace("<body>", `<body>${printBar}`) : printBar + html;
      const body = withBar.includes("</body>") ? withBar.replace("</body>", `${autoPrint}</body>`) : withBar + autoPrint;
      return new NextResponse(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `inline; filename="label-${labelJobId}-${side}.html"`,
        },
      });
    } catch (error) {
      // ⛔ Say WHY, in words. A bare error page after "Print now" is
      // indistinguishable from "nothing happened". The print station reads the
      // JSON; a person who tapped Print now gets a page.
      const message = error instanceof Error ? error.message : "The sticker could not be drawn.";
      const status = error instanceof LabelDocumentError ? 422 : 500;
      if (url.searchParams.get("print") === "1") {
        const safe = message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
        return new NextResponse(
          `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
            `<body style="font:18px -apple-system,Helvetica,Arial,sans-serif;padding:24px;"><h1 style="font-size:22px;">This sticker can't print</h1><p>${safe}</p></body></html>`,
          { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
        );
      }
      return NextResponse.json({ error: message }, { status });
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
