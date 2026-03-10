import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const adminClient = createAdminClient();
    const { data, error } = (await adminClient
      .from("conference_instances")
      .select("year, edition_code")
      .eq("status", "registration_open")
      .order("registration_open_at", { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { year: number; edition_code: string } | null; error: any };

    if (error || !data) {
      return NextResponse.json({ found: false }, { status: 200 });
    }

    return NextResponse.json(
      {
        found: true,
        year: String(data.year),
        edition: data.edition_code,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ found: false }, { status: 200 });
  }
}
