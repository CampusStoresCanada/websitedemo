import { NextRequest, NextResponse } from "next/server";
import { requireAuthenticated } from "@/lib/auth/guards";
import { isCircleConfigured } from "@/lib/circle/config";
import { mintMemberToken } from "@/lib/circle/headless-auth";
import { CircleMemberClient } from "@/lib/circle/member-proxy";
import { getIntegrationConfig } from "@/lib/policy/engine";
import { resolveUserCircleId } from "@/lib/circle/member-link";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET /api/circle/dm — list chat rooms + messages for the current user
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  if (!isCircleConfigured()) {
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
    // Look up the user's Circle member ID from their contact record
    const circleId = await resolveUserCircleId(auth.ctx.userId, auth.ctx.userEmail);
    if (!circleId) {
      return NextResponse.json(
        { chatRooms: [], messages: [], linked: false },
        { status: 200 }
      );
    }

    // Mint a member token
    const token = await mintMemberToken({ community_member_id: circleId });
    const memberClient = new CircleMemberClient(token.access_token);

    // Check if a specific room was requested
    const { searchParams } = new URL(request.url);
    const roomUuid = searchParams.get("room");
    const summary = searchParams.get("summary");

    if (summary === "true") {
      // Summary mode: just return chat rooms for badge counting
      const chatRooms = await memberClient.listChatRooms();
      return NextResponse.json({ chatRooms, linked: true });
    }

    if (roomUuid) {
      // Fetch messages for a specific room
      const messages = await memberClient.getChatMessages(roomUuid);
      return NextResponse.json({ messages, linked: true });
    }

    // Default: return chat rooms
    const chatRooms = await memberClient.listChatRooms();
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
  if (!isCircleConfigured()) {
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

    // Look up the user's Circle ID
    const circleId = await resolveUserCircleId(auth.ctx.userId, auth.ctx.userEmail);
    if (!circleId) {
      return NextResponse.json(
        { error: "Your account is not linked to Circle" },
        { status: 400 }
      );
    }

    // Mint token and send
    const token = await mintMemberToken({ community_member_id: circleId });
    const memberClient = new CircleMemberClient(token.access_token);
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
