import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/admin/comms/conditions/conferences — options for the "which
 * conference" reference picker when a condition's subject is Conference
 * Purchase (see resolve.ts's conference_entity_ownership case, which checks
 * owns_booth/owns_registration against whichever conference is referenced).
 */
export async function GET() {
  const db = createAdminClient();
  const { data, error } = await db.from("conference_instances").select("id, name, year").order("year", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const options = (data ?? []).map((c) => ({ id: c.id, title: `${c.name} (${c.year})` }));
  return NextResponse.json({ options });
}
