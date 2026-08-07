import { NextRequest, NextResponse } from "next/server";
import { wrapEmailBody } from "@/lib/email/layout";

/**
 * POST /api/admin/comms/preview
 * Renders a full branded email preview for the template editor and campaign pages.
 * Accepts { body_html, subject, variables } — unknown {{keys}} rendered as [key] placeholders.
 */
export async function POST(request: NextRequest) {
  const { body_html, subject, variables = {}, is_transactional = false } = (await request.json()) as {
    body_html: string;
    subject: string;
    variables?: Record<string, string>;
    is_transactional?: boolean;
  };

  // Derive base URL from the request so assets resolve in dev and prod
  // without requiring NEXT_PUBLIC_APP_URL to be set.
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  const host  = request.headers.get("host") ?? "localhost:3000";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? `${proto}://${host}`;

  // app_url is the one system variable every real send auto-fills regardless
  // of recipient (see send.ts) — unlike recipient-scoped ones (org_name,
  // conference_year, ...), which genuinely can't be known without a chosen
  // recipient and are correctly left as [key] placeholders here. Filling
  // this one in by default is what lets templates use {{app_url}}/... links
  // safely (the domain-migration-safe way) instead of admins hardcoding the
  // literal domain just to make preview/test-send render a working link.
  const effectiveVariables: Record<string, string> = { app_url: baseUrl, ...variables };

  // Preview has no real recipient to evaluate conditions against, so
  // {{#if}} blocks are shown unwrapped (as if true) — this is purely for
  // authoring, not a preview of what any specific person would see.
  const unwrapConditionals = (template: string): string =>
    template.replace(/\{\{#if\s+[a-zA-Z0-9_-]+\}\}([\s\S]*?)\{\{\/if\}\}/g, "$1");

  const substitute = (template: string): string =>
    unwrapConditionals(template).replace(/\{\{(\w+)\}\}/g, (_, key) =>
      key in effectiveVariables && effectiveVariables[key] ? effectiveVariables[key] : `[${key}]`
    );

  // Real sends always pass a per-delivery manageUrl (CASL unsubscribe/
  // preferences link) unless the template is transactional (see send.ts) —
  // there's no real delivery to link to here, so a placeholder stands in
  // just to make the footer preview match what a recipient actually gets.
  const manageUrl = is_transactional ? undefined : `${baseUrl}/email-preferences/preview`;
  const html = wrapEmailBody(substitute(body_html ?? ""), baseUrl, manageUrl);
  const renderedSubject = substitute(subject ?? "");

  return NextResponse.json({ html, subject: renderedSubject });
}
