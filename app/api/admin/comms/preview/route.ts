import { NextRequest, NextResponse } from "next/server";
import { wrapEmailBody } from "@/lib/email/layout";

/**
 * POST /api/admin/comms/preview
 * Renders a full branded email preview for the template editor and campaign pages.
 * Accepts { body_html, subject, variables } — unknown {{keys}} rendered as [key] placeholders.
 */
export async function POST(request: NextRequest) {
  const { body_html, subject, variables = {} } = (await request.json()) as {
    body_html: string;
    subject: string;
    variables?: Record<string, string>;
  };

  // Derive base URL from the request so assets resolve in dev and prod
  // without requiring NEXT_PUBLIC_APP_URL to be set.
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host  = request.headers.get("host") ?? "localhost:3000";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;

  const substitute = (template: string): string =>
    template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
      key in variables && variables[key] ? variables[key] : `[${key}]`
    );

  const html = wrapEmailBody(substitute(body_html ?? ""), baseUrl);
  const renderedSubject = substitute(subject ?? "");

  return NextResponse.json({ html, subject: renderedSubject });
}
