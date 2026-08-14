import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { getCircleClientForUser } from "@/lib/circle/member-session";
import { TTLCache } from "@/lib/cache/ttl-cache";
import { isFeatureEnabled } from "@/lib/data";

export const dynamic = "force-dynamic";

// Header.tsx (and CircleDMBadge.tsx) poll ?summary=true repeatedly for badge
// counts — cache that response briefly rather than re-minting a Circle token
// and re-listing chat rooms on every poll.
const SUMMARY_CACHE_TTL_MS = 30_000;
type DmSummaryPayload = { chatRooms: unknown[]; messages?: unknown[]; linked: boolean };
const dmSummaryCache = new TTLCache<DmSummaryPayload>(SUMMARY_CACHE_TTL_MS);

// ---------------------------------------------------------------------------
// GET /api/circle/dm — list chat rooms + messages for the current user
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!isCircleConfigured() || !(await isFeatureEnabled("circle"))) {
    return NextResponse.json(
      { error: "Circle not configured" },
      { status: 503 }
    );
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Policy check
  try {
    const config = await getIntegrationConfig();
    if (config.circle_dm_mode === "disabled") {
      return NextResponse.json({ error: "DMs are disabled" }, { status: 403 });
    }
  } catch {
    // Policy engine unavailable — allow
  }

  const { searchParams } = new URL(request.url);
  const roomUuid = searchParams.get("room");
  const summary = searchParams.get("summary");
  const summaryCacheKey = `dm-summary:${auth.ctx.userId}`;

  if (summary === "true") {
    const cached = dmSummaryCache.get(summaryCacheKey);
    if (cached) return NextResponse.json(cached);
  }

  try {
    // Look up the user's Circle member ID and a (cached) member token
    const client = await getCircleClientForUser(auth.ctx.userId, auth.ctx.userEmail);
    if (!client) {
      const payload: DmSummaryPayload = { chatRooms: [], messages: [], linked: false };
      if (summary === "true") dmSummaryCache.set(summaryCacheKey, payload);
      return NextResponse.json(payload, { status: 200 });
    }

    if (summary === "true") {
      // Summary mode: just return chat rooms for badge counting
      const chatRooms = await client.listChatRooms();
      const payload: DmSummaryPayload = { chatRooms, linked: true };
      dmSummaryCache.set(summaryCacheKey, payload);
      return NextResponse.json(payload);
    }

    if (roomUuid) {
      // Fetch messages for a specific room
      const messages = await client.getChatMessages(roomUuid);
      return NextResponse.json({ messages, linked: true });
    }

    // Default: return chat rooms
    const chatRooms = await client.listChatRooms();
    return NextResponse.json({ chatRooms, linked: true });
  } catch (err) {
    console.error(
      "[api/circle/dm] GET error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST /api/circle/dm — send a message
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  if (!isCircleConfigured() || !(await isFeatureEnabled("circle"))) {
    return NextResponse.json(
      { error: "Circle not configured" },
      { status: 503 }
    );
  }

  const auth = await requireAuthenticated();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  // Policy check
  try {
    const config = await getIntegrationConfig();
    if (config.circle_dm_mode === "disabled") {
      return NextResponse.json({ error: "DMs are disabled" }, { status: 403 });
    }
  } catch {
    // Policy engine unavailable — allow
  }

  try {
    const body = await request.json();
    const { chatRoomUuid, message } = body as {
      chatRoomUuid?: string;
      message?: string;
    };

    if (!chatRoomUuid || !message) {
      return NextResponse.json(
        { error: "chatRoomUuid and message are required" },
        { status: 400 }
      );
    }

    // Look up the user's Circle ID and a (cached) member token
    const memberClient = await getCircleClientForUser(auth.ctx.userId, auth.ctx.userEmail);
    if (!memberClient) {
      return NextResponse.json(
        { error: "Your account is not linked to Circle" },
        { status: 400 }
      );
    }

    const sent = await memberClient.sendMessage(chatRoomUuid, message);

    return NextResponse.json({ message: sent });
  } catch (err) {
    console.error(
      "[api/circle/dm] POST error:",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}
