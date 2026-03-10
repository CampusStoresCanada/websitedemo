import { NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { CircleMemberClient } from "@/lib/circle/member-proxy";
import { resolveUserCircleId } from "@/lib/circle/member-link";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isCircleConfigured()) {
    return NextResponse.json({ notifications: [], replies: [], linked: false }, { status: 200 });
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const circleId = await resolveUserCircleId(auth.ctx.userId);
    if (!circleId) {
      return NextResponse.json({ notifications: [], replies: [], linked: false }, { status: 200 });
    }

    const token = await mintMemberToken({ community_member_id: circleId });
    const memberClient = new CircleMemberClient(token.access_token);
    const feed = await memberClient.listNotificationsSummary({ per_page: 20 });

    const notifications = feed
      .filter((item) => item.category === "notification")
      .slice(0, 10)
      .map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        href: item.href,
        createdAt: item.created_at,
      }));

    const replies = feed
      .filter((item) => item.category === "reply")
      .slice(0, 10)
      .map((item) => ({
        id: item.id,
        title: item.title,
        message: item.message,
        href: item.href,
        createdAt: item.created_at,
      }));

    return NextResponse.json({ notifications, replies, linked: true }, { status: 200 });
  } catch (error) {
    console.error(
      "[api/circle/notifications] Failed to fetch Circle notifications:",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json({ notifications: [], replies: [], linked: true }, { status: 200 });
  }
}
