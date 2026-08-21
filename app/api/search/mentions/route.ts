import { NextRequest, NextResponse } from "next/server";
import { getOptionalAuthContext } from "@/lib/auth/guards";
import { createAdminClient } from "@/lib/supabase/admin";
import { listDirectoryContacts } from "@/lib/contacts/directory";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  const auth = await getOptionalAuthContext();
  if (!auth) return NextResponse.json([], { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) return NextResponse.json([]);

  const db = createAdminClient();

  const [orgsResult, contactRows] = await Promise.all([
    db
      .from("organizations")
      .select("id, name, slug, type")
      .ilike("name", `%${q}%`)
      .not("slug", "is", null)
      .eq("is_test", false)
      .limit(5),
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
