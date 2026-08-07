import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/lib/email/send";

/**
 * POST /api/admin/comms/test-send
 * Actually delivers a rendered campaign/template via Resend to a single
 * address of the admin's choosing — unlike /api/admin/comms/preview, which
 * only renders HTML for an iframe. Two real production bugs (missing
 * unsubscribe footer, missing header logo) only ever showed up in an actual
 * delivered email, never in the preview iframe — this is what catches that
 * class of issue before a real campaign goes out.
 *
 * Subject is always prefixed "[TEST]" so a test send is never mistaken for
 * the real thing in an inbox. Not tracked as a campaign/recipient/delivery —
 * this is a one-off, not part of send analytics.
 */
export async function POST(request: NextRequest) {
  const { body_html, subject, variables = {}, is_transactional = false, to } = (await request.json()) as {
    body_html: string;
    subject: string;
    variables?: Record<string, string>;
    is_transactional?: boolean;
    to: string;
  };

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ error: "Enter a valid email address to send the test to." }, { status: 400 });
  }

  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host = request.headers.get("host") ?? "localhost:3000";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;

  // Same as the preview route: no real recipient to evaluate {{#if}}
  // conditions against, so conditional blocks render unwrapped (as if true).
  const unwrapConditionals = (template: string): string =>
    template.replace(/\{\{#if\s+[a-zA-Z0-9_-]+\}\}([\s\S]*?)\{\{\/if\}\}/g, "$1");

  const substitute = (template: string): string =>
    unwrapConditionals(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
      key in variables && variables[key] ? variables[key] : `[${key}]`
    );

  const manageUrl = is_transactional ? undefined : `${baseUrl}/email-preferences/preview`;
  const renderedHtml = substitute(body_html ?? "");
  const renderedSubject = substitute(subject ?? "");

  const result = await sendEmail({
    to,
    subject: `[TEST] ${renderedSubject}`,
    html: renderedHtml,
    manageUrl,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error ?? "Send failed" }, { status: 500 });
  }

  return NextResponse.json({ success: true, messageId: result.messageId });
}
