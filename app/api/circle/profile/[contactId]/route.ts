import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { CircleMemberClient } from "@/lib/circle/member-proxy";

const COMMUNITY_URL = process.env.NEXT_PUBLIC_CIRCLE_COMMUNITY_URL ?? "https://memberspace.campusstores.ca";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  const supabase = createAdminClient();
  const { data: contact } = await supabase
    .from("contacts")
    .select("email, circle_id")
    .eq("id", contactId)
    .single();

  if (!contact?.email) {
    return NextResponse.redirect(`${COMMUNITY_URL}/members`);
  }

  try {
    const token = await mintMemberToken({ email: contact.email });
    const memberClient = new CircleMemberClient(token.access_token);
    const profile = await memberClient.getProfile();
    if (profile?.public_uid) {
      return NextResponse.redirect(`${COMMUNITY_URL}/u/${profile.public_uid}`);
    }
  } catch (err) {
    console.error("[circle/profile] error:", err instanceof Error ? err.message : err);
  }

  return NextResponse.redirect(`${COMMUNITY_URL}/members`);
}
