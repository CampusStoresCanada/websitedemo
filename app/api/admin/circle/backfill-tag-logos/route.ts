import { NextRequest, NextResponse } from "next/server";
import { getServerAuthState } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleClient } from "@/lib/circle/client";

export async function GET(req: NextRequest) {
  const auth = await getServerAuthState();
  if (!auth.globalRole || !["super_admin", "admin"].includes(auth.globalRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const circleClient = getCircleClient();
  if (!circleClient) return NextResponse.json({ error: "Circle not configured" }, { status: 500 });
  const search = req.nextUrl.searchParams.get("search") ?? "";
  const tags = await circleClient.listTags();
  const filtered = search
    ? tags.filter(t => t.name.toLowerCase().includes(search.toLowerCase()))
    : tags;
  return NextResponse.json({ count: filtered.length, tags: filtered });
}

export async function POST(req: NextRequest) {
  const auth = await getServerAuthState();
  if (!auth.globalRole || !["super_admin", "admin"].includes(auth.globalRole)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dryRun === true;

  const circleClient = getCircleClient();
  if (!circleClient) {
    return NextResponse.json({ error: "Circle not configured" }, { status: 500 });
  }

  const adminClient = createAdminClient();
  const { data: orgs, error } = await adminClient
    .from("organizations")
    .select("id, name, circle_tag_id, logo_url")
    .not("circle_tag_id", "is", null)
    .not("logo_url", "is", null);

  if (error || !orgs) {
    return NextResponse.json({ error: "Failed to fetch orgs" }, { status: 500 });
  }

  const results: { orgId: string; name: string; tagId: string; ok: boolean; error?: string }[] = [];

  for (const org of orgs) {
    if (dryRun) {
      results.push({ orgId: org.id, name: org.name, tagId: org.circle_tag_id!, ok: true });
      continue;
    }
    try {
      await circleClient.updateTag(Number(org.circle_tag_id), {
        name: org.name,
        color: "#ffffff",
        display_format: "label",
        is_background_enabled: false,
        custom_emoji_url: org.logo_url!,
      });
      results.push({ orgId: org.id, name: org.name, tagId: org.circle_tag_id!, ok: true });
    } catch (err) {
      results.push({
        orgId: org.id,
        name: org.name,
        tagId: org.circle_tag_id!,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  const firstError = results.find(r => !r.ok)?.error ?? null;
  return NextResponse.json({ dryRun, total: orgs.length, succeeded, failed, firstError, results });
}
