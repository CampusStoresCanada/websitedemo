import { NextRequest, NextResponse } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";

export const dynamic = "force-dynamic";

// Generous timeout — each contact requires a Circle API search call
export const maxDuration = 60;

/**
 * POST /api/admin/circle/link-existing
 * Body: { email?: string; limit?: number; dryRun?: boolean }
 *
 * Looks up unlinked contacts in Circle by email and sets contacts.circle_id.
 * - email: target a single contact by email (omit for batch mode)
 * - limit: max contacts to process in batch mode (default 50)
 * - dryRun: report matches without writing
 *
 * Requires super_admin.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await getServerAuthState();
  if (!auth.user || auth.globalRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!isCircleConfigured()) {
    return NextResponse.json(
      { error: "Circle not configured — CIRCLE_API_KEY / CIRCLE_COMMUNITY_ID missing" },
      { status: 503 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const targetEmail: string | undefined = body.email;
  const limit: number = typeof body.limit === "number" ? Math.min(body.limit, 200) : 50;
  const dryRun: boolean = Boolean(body.dryRun);

  const db = createAdminClient();
  const circleClient = getCircleClient()!;

  // Fetch unlinked contacts (or single target)
  let query = db
    .from("contacts")
    .select("id, email, name, organization_id")
    .is("circle_id", null)
    .not("email", "is", null);

  if (targetEmail) {
    query = query.eq("email", targetEmail) as typeof query;
  }

  const { data: contacts, error } = await query.limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!contacts || contacts.length === 0) {
    return NextResponse.json({ checked: 0, linked: 0, notFound: 0, errors: [], dryRun });
  }

  const results = {
    checked: 0,
    linked: 0,
    notFound: 0,
    errors: [] as string[],
    dryRun,
  };

  // Fetch all Circle members once and build an email map — Circle's API
  // ignores server-side email filters so we must match client-side.
  let emailMap: Map<string, { id: number }>;
  try {
    emailMap = await circleClient.buildEmailMap();
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch Circle members: ${err instanceof Error ? err.message : err}` },
      { status: 502 }
    );
  }

  for (const contact of contacts) {
    if (!contact.email) continue;
    results.checked++;

    const circleMember = emailMap.get(contact.email.toLowerCase());

    if (!circleMember) {
      results.notFound++;
      continue;
    }

    const circleId = circleMember.id;

    if (!dryRun) {
      const { error: updateErr } = await db
        .from("contacts")
        .update({
          circle_id: String(circleId),
          synced_to_circle_at: new Date().toISOString(),
        })
        .eq("id", contact.id);

      if (updateErr) {
        results.errors.push(`${contact.email}: ${updateErr.message}`);
        continue;
      }
    }

    results.linked++;
  }

  return NextResponse.json(results);
}
