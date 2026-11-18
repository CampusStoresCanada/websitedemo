import { NextRequest, NextResponse } from "next/server";
import { getOptionalAuthContext, isGlobalAdmin } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { listDirectoryContacts } from "@/lib/contacts/directory";
import { PROSPECT_ORG_TYPES } from "@/lib/constants/org-types";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const auth = await getOptionalAuthContext();
  if (!auth) return NextResponse.json([], { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json([]);

  const db = createAdminClient();
  // A prospect company and its people are staff-only (see app/org/[slug]).
  const staff = isGlobalAdmin(auth.globalRole);
  const prospectList = `(${PROSPECT_ORG_TYPES.map((t) => `"${t}"`).join(",")})`;

  let orgQuery = db
    .from("organizations")
    .select("id, name, slug, type")
    .ilike("name", `%${q}%`)
    .not("slug", "is", null)
    .eq("is_test", false);
  if (!staff) orgQuery = orgQuery.not("type", "in", prospectList);

  const [orgsResult, rawContactRows] = await Promise.all([
    orgQuery.limit(5),
    listDirectoryContacts<{
      id: string;
      name: string | null;
      organization_id: string | null;
      role_title: string | null;
    }>({
      nameSearch: q,
      fields: "id, name, organization_id, role_title",
      limit: 5,
    }),
  ]);

  let contactRows = rawContactRows;
  if (!staff) {
    const orgIds = [...new Set(rawContactRows.map((c) => c.organization_id).filter((id): id is string => !!id))];
    if (orgIds.length > 0) {
      const { data: prospects } = await db
        .from("organizations")
        .select("id")
        .in("id", orgIds)
        .in("type", [...PROSPECT_ORG_TYPES]);
      const hidden = new Set((prospects ?? []).map((o) => o.id as string));
      contactRows = rawContactRows.filter((c) => !c.organization_id || !hidden.has(c.organization_id));
    }
  }

  const orgs = (orgsResult.data ?? []).map((o) => ({
    id: `org:${o.id}`,
    label: o.name,
    sublabel: o.type ?? "",
    href: `/org/${o.slug}`,
    type: "org" as const,
  }));

  const contacts = contactRows.map((c) => ({
    id: `contact:${c.id}`,
    label: c.name ?? "Unnamed",
    sublabel: c.role_title ?? "",
    href: `/contact/${c.id}`,
    type: "contact" as const,
  }));

  return NextResponse.json([...orgs, ...contacts]);
}
