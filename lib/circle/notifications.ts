// ---------------------------------------------------------------------------
// Circle bot notifications — send DMs from the CSC bot user
// ---------------------------------------------------------------------------

import { getCircleClient } from "./client";
import { isCircleConfigured, getCircleConfig } from "./config";
import { mintMemberToken } from "./headless-auth";
import { CircleMemberClient } from "./member-proxy";
import { CircleApiError } from "./types";

/**
 * Send a DM from the CSC bot user to a Circle member identified by email.
 *
 * Flow:
 * 1. Look up recipient by email in Circle
 * 2. Mint a JWT for the bot user
 * 3. Send DM from bot to recipient via Member API
 *
 * Returns silently if Circle is not configured.
 */
export async function sendCircleNotification(params: {
  recipientEmail: string;
  message: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isCircleConfigured()) return { success: true }; // no-op

  const config = getCircleConfig()!;
  const client = getCircleClient()!;

  if (!config.botUserId) {
    return { success: false, error: "CIRCLE_BOT_USER_ID not configured" };
  }

  if (!config.headlessAuthToken) {
    return {
      success: false,
      error: "CIRCLE_HEADLESS_AUTH_TOKEN not configured",
    };
  }

  try {
    // 1. Find recipient in Circle by email
    const members = await client.searchMembers(params.recipientEmail);
    if (members.length === 0) {
      return { success: false, error: "Recipient not found in Circle" };
    }

    const recipientCircleId = members[0].id;

    // 2. Mint bot token — prefer numeric member ID, fall back to email
    const numericBotId = parseInt(config.botUserId, 10);
    if (isNaN(numericBotId) && !config.botEmail) {
      console.error(
        "[circle/notifications] CIRCLE_BOT_USER_ID is not a numeric member ID and CIRCLE_BOT_EMAIL is not set. " +
        "Set CIRCLE_BOT_EMAIL in .env.local to the bot account's email address."
      );
      return { success: false, error: "Bot identity not configured" };
    }
    const botToken = await mintMemberToken(
      !isNaN(numericBotId)
        ? { community_member_id: numericBotId }
        : { email: config.botEmail }
    );

    // 3. Send DM via member proxy
    const memberClient = new CircleMemberClient(botToken.access_token);

    // Find the existing DM room with the recipient
    const chatRooms = await memberClient.listChatRooms();
    const directRoom = chatRooms.find(
      (room) =>
        room.chat_room_kind === "direct" &&
        room.other_participants_preview.some((m) => m.community_member_id === recipientCircleId)
    );

    let roomId: number;
    if (directRoom) {
      roomId = directRoom.id;
    } else {
      const newRoom = await memberClient.createDirectChatRoom(recipientCircleId);
      roomId = newRoom.id;
    }

    await memberClient.sendMessage(roomId, params.message);
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const body = err instanceof CircleApiError ? err.responseBody : undefined;
    console.error("[circle/notifications] Send failed:", errorMsg, body ? JSON.stringify(body) : "");
    return { success: false, error: errorMsg };
  }
}
