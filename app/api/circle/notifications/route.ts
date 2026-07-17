import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { getCircleClientForUser } from "@/lib/circle/member-session";
import { TTLCache } from "@/lib/cache/ttl-cache";

export const dynamic = "force-dynamic";

// Header.tsx polls this route every ~90s (and it's cheap for other callers
// to hit within that window too) — cache the summary payload briefly rather
// than re-minting a Circle token and re-listing notifications/rooms each time.
const SUMMARY_CACHE_TTL_MS = 30_000;
type NotificationsSummaryPayload = {
  notifications: unknown[];
  replies: unknown[];
  dms?: unknown[];
  linked: boolean;
  unreadCount?: number;
  dmUnreadCount?: number;
};
const notificationsSummaryCache = new TTLCache<NotificationsSummaryPayload>(SUMMARY_CACHE_TTL_MS);

function summaryCacheKey(userId: string): string {
  return `notifications-summary:${userId}`;
}

export async function POST(request: NextRequest) {
  if (!isCircleConfigured()) return NextResponse.json({ ok: false }, { status: 200 });

  const auth = await requireAuthenticated();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const client = await getCircleClientForUser(auth.ctx.userId, auth.ctx.userEmail);
    if (!client) return NextResponse.json({ ok: false }, { status: 200 });

    let body: { notificationId?: string } = {};
    try { body = await request.json(); } catch { /* no body */ }

    if (body.notificationId) {
      await client.markNotificationRead(body.notificationId);
    } else {
      await client.markAllNotificationsRead();
    }

    // The cached summary would otherwise still show this as unread until
    // its TTL expires — invalidate so the next poll reflects the change.
    notificationsSummaryCache.delete(summaryCacheKey(auth.ctx.userId));

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[api/circle/notifications] mark-read failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

export async function GET() {
  if (!isCircleConfigured()) {
    return NextResponse.json({ notifications: [], replies: [], linked: false }, { status: 200 });
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const cacheKey = summaryCacheKey(auth.ctx.userId);
  const cached = notificationsSummaryCache.get(cacheKey);
  if (cached) return NextResponse.json(cached, { status: 200 });

  try {
    const client = await getCircleClientForUser(auth.ctx.userId, auth.ctx.userEmail);
    if (!client) {
      const payload: NotificationsSummaryPayload = { notifications: [], replies: [], linked: false };
      notificationsSummaryCache.set(cacheKey, payload);
      return NextResponse.json(payload, { status: 200 });
    }

    const [feed, rooms] = await Promise.all([
      client.listNotificationsSummary({ per_page: 20 }),
      client.listChatRooms(),
    ]);

    const unreadCount = feed.filter((item) => item.is_unread).length;

    const mapItem = (item: typeof feed[0]) => ({
      id: item.id,
      title: item.title,
      message: item.message,
      href: item.href,
      createdAt: item.created_at,
      isRead: !item.is_unread,
    });

    const notifications = feed.filter((item) => item.category === "notification").slice(0, 10).map(mapItem);
    const replies = feed.filter((item) => item.category === "reply").slice(0, 10).map(mapItem);

    const communityUrl = process.env.NEXT_PUBLIC_CIRCLE_COMMUNITY_URL ?? "https://memberspace.campusstores.ca";
    const dms = rooms.slice(0, 10).map((room) => {
      const currentId = room.current_participant?.community_member_id;
      const others = room.other_participants_preview.filter(
        (p) => p.community_member_id !== currentId
      );
      const displayName = others[0]?.name ?? room.chat_room_name;
      const avatarUrl = others[0]?.avatar_url ?? null;
      return {
        uuid: room.uuid,
        name: displayName,
        kind: room.chat_room_kind,
        unreadCount: room.unread_messages_count,
        lastMessage: room.last_message?.body ?? null,
        lastSender: room.last_message?.sender?.name ?? null,
        avatarUrl,
        href: `${communityUrl}/messages/${room.uuid}`,
      };
    });

    const dmUnreadCount = rooms.reduce((sum, r) => sum + r.unread_messages_count, 0);

    const payload: NotificationsSummaryPayload = { notifications, replies, dms, linked: true, unreadCount, dmUnreadCount };
    notificationsSummaryCache.set(cacheKey, payload);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("[api/circle/notifications] fetch failed:", error instanceof Error ? error.message : error);
    // Deliberately not cached — an error path shouldn't blank the badge for
    // the full TTL once Circle recovers.
    return NextResponse.json({ notifications: [], replies: [], linked: true }, { status: 200 });
  }
}
