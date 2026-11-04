import { NextRequest, NextResponse } from "next/server";
import { requireConferenceDeskAccess } from "@/lib/auth/guards";
import { shipmentPinFor } from "@/lib/conference/shipping";
import { fetchLabels } from "@/lib/purolator/shipping";

export const dynamic = "force-dynamic";

/**
 * A shipment's labels: Purolator's 4x6 thermal PDF, one page per box. Fetched
 * from Purolator on each request, never stored. Read-only, so safe on GET.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string; shipmentId: string }> }
) {
  const { id: conferenceId, shipmentId } = await context.params;
  const auth = await requireConferenceDeskAccess(conferenceId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const pin = await shipmentPinFor(conferenceId, shipmentId);
  if (!pin) return NextResponse.json({ error: "No labels for that shipment." }, { status: 404 });

  try {
    const pdf = await fetchLabels(pin);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="purolator-${pin}.pdf"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
