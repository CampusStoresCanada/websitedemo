import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { badgeScanUrl, tokenFromScannedValue } from "@/lib/conference/badges/tokens";
import { resolveSelfCheckIn } from "@/lib/conference/self-check-in-server";
import { selfCheckInEnabled } from "@/lib/conference/self-check-in";

export const dynamic = "force-dynamic";

/**
 * The attendee's check-in QR, as an image for their email. Gmail and Outlook
 * do not show a QR embedded in the message itself, so it is a link.
 *
 * ⛔ A GET that WRITES NOTHING: Outlook's Safe Links opens it before the
 * attendee does. It draws the badge's own code and only for a person whose
 * conference has self check-in on, so it is not an open QR generator.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token: raw } = await context.params;
  const token = tokenFromScannedValue(raw.replace(/\.png$/i, ""));
  const ctx = token ? await resolveSelfCheckIn(token) : null;
  if (!ctx || !selfCheckInEnabled(ctx.settings)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const png = await QRCode.toBuffer(badgeScanUrl(token), {
    type: "png",
    errorCorrectionLevel: "M",
    margin: 2,
    width: 480,
  });
  return new NextResponse(new Uint8Array(png), {
    headers: {
      "content-type": "image/png",
      // The code never changes for a token; a revoked one 404s on its next fetch.
      "cache-control": "private, max-age=86400",
    },
  });
}
