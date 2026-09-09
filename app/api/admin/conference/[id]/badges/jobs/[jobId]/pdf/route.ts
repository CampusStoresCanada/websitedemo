import { NextResponse } from "next/server";
import { requireConferenceOpsAccess } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildBadgeJobDocument,
  BadgeDocumentError,
} from "@/lib/conference/badges/document";
import {
  buildReprintLabelDocument,
  LabelDocumentError,
} from "@/lib/conference/badges/label-document";

/**
 * Serve one badge job's printable document.
 *
 * Auth and the HTTP shape live here; the document itself is built by
 * lib/conference/badges/document.ts so a PDF renderer can produce the identical
 * bytes without going through a browser session.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; jobId: string }> }
) {
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
