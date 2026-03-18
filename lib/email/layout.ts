// ─────────────────────────────────────────────────────────────────
// Branded email layout wrapper
// Email-safe: table-based, fully inline styles, no external CSS
//
// Assets live in /public/email/ (see /public/email/background.png etc.)
// Background image: 1201×161px @2x → displayed at 600×80
// Wordmark logo:    381×108px  @2x → displayed at 190×54
// Logo mark:        1000×1000px @2x → displayed at 40×40 in footer
//
// Outlook (Windows) does not support CSS background-image.
// We use: bgcolor attribute + CSS background-image for modern clients.
// The background is purely decorative — email is fully functional without it.
// ─────────────────────────────────────────────────────────────────

const BRAND_NAVY = "#163D6D";
const BRAND_RED  = "#EE2A2E";
const FONT = "Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif";
const TEXT_PRIMARY = "#1A1A1A";
const TEXT_MUTED   = "#6B7280";
const HEADER_BG    = "#F5F4F1"; // fallback when bg image doesn't load
const FOOTER_BG    = "#F5F4F1";
const BODY_BG      = "#EEEDE9";
const MAILING_ADDRESS = "P.O. Box 71157 Silver Springs, Calgary, Alberta, Canada";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

/**
 * Wraps a raw HTML content block in the branded CSC email layout.
 * Applied at send time — templates store only their content body.
 *
 * @param baseUrl  Override the base URL for asset paths (e.g. from request
 *                 headers). Falls back to NEXT_PUBLIC_APP_URL env var.
 */
export function wrapEmailBody(contentHtml: string, baseUrl?: string): string {
  const base        = baseUrl ?? APP_URL;
  const bgUrl       = base ? `${base}/email/background.png`    : "";
  const wordmarkUrl = base ? `${base}/email/logo-wordmark.png` : "";
  const markUrl     = base ? `${base}/email/logo-mark.png`     : "";

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="x-apple-disable-message-reformatting" />
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings>
    <o:PixelsPerInch>96</o:PixelsPerInch>
  </o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BODY_BG};font-family:${FONT};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!-- Preheader (hidden preview text suppressor) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:${BODY_BG};">&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

  <!-- ── Outer wrapper ── -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background-color:${BODY_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <!-- ── Email card (600px) ── -->
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
               style="max-width:600px;width:100%;">

          <!-- ════ Header ════ -->
          <!-- background attr = legacy/Outlook attribute fallback         -->
          <!-- CSS background-image = modern email clients (Gmail, Apple)  -->
          <!-- bgcolor attr = colour fallback when image is blocked        -->
          <tr>
            <td bgcolor="${HEADER_BG}"
                ${bgUrl ? `background="${bgUrl}"` : ""}
                style="${bgUrl
                  ? `background-image:url('${bgUrl}');background-size:cover;background-position:center center;`
                  : ""}background-color:${HEADER_BG};border-radius:8px 8px 0 0;padding:18px 32px;height:80px;vertical-align:middle;">

              ${wordmarkUrl
                ? `<!--[if !mso]><!-->
              <img src="${wordmarkUrl}"
                   alt="Campus Stores Canada"
                   width="190" height="54"
                   style="display:block;border:0;outline:none;text-decoration:none;max-width:190px;height:auto;" />
              <!--<![endif]-->
              <!--[if mso]>
              <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:${BRAND_NAVY};">Campus Stores Canada</span>
              <![endif]-->`
                : `<span style="font-family:${FONT};font-size:20px;font-weight:700;color:${BRAND_NAVY};">Campus Stores Canada</span>`}

            </td>
          </tr>

          <!-- ════ Content ════ -->
          <tr>
            <td style="background-color:#FFFFFF;padding:36px 40px 40px;border-left:1px solid #E0DDD8;border-right:1px solid #E0DDD8;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family:${FONT};font-size:15px;line-height:1.75;color:${TEXT_PRIMARY};">
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ════ Footer ════ -->
          <tr>
            <td align="center" style="background-color:${FOOTER_BG};border:1px solid #E0DDD8;border-top:none;border-radius:0 0 8px 8px;padding:18px 32px 22px;text-align:center;">
              ${markUrl
                ? `<img src="${markUrl}" alt="" width="40" height="40"
                       style="display:block;margin:0 auto 8px;border:0;outline:none;text-decoration:none;width:40px;height:40px;" />`
                : ""}
              <p style="margin:0 0 3px;font-family:${FONT};font-size:12px;font-weight:700;color:${BRAND_NAVY};letter-spacing:0.1px;">
                Campus Stores Canada
              </p>
              <p style="margin:0;font-family:${FONT};font-size:11px;color:${TEXT_MUTED};line-height:1.5;">
                ${MAILING_ADDRESS}
              </p>
            </td>
          </tr>

        </table>
        <!-- /email card -->

      </td>
    </tr>
  </table>

</body>
</html>`;
}
