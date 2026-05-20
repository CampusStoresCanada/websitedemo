// ---------------------------------------------------------------------------
// Share notification — sends a live page link to a specific recipient.
//
// Delivery:
//   1. Headless JWT DM as the actual sender (feels like a direct peer message)
//   2. Butler Ghost DM fallback (if sender's Circle account can't be found)
//   3. Email fallback (if Circle isn't configured or both DM paths fail)
// ---------------------------------------------------------------------------

import { getCircleGhostClient } from "./client";
import { mintMemberToken } from "./headless-auth";
import { CircleMemberClient } from "./member-proxy";
import { isCircleConfigured } from "./config";
import { createAdminClient } from "@/lib/supabase/admin";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export interface ShareNotificationParams {
  senderUserId: string;
  senderName: string;
  senderEmail: string;
  recipientEmail: string;
  pageTitle: string;
  /** Live page URL — e.g. /org/ubc-bookstore or https://... */
  pageUrl: string;
  note?: string;
}

export async function sendShareNotification(
  params: ShareNotificationParams
): Promise<{ success: boolean; method?: "circle_dm" | "email" | "none"; error?: string }> {
  const { senderUserId, senderName, senderEmail, recipientEmail, pageTitle, pageUrl, note } = params;

  const fullPageUrl = pageUrl.startsWith("http") ? pageUrl : `${APP_URL}${pageUrl}`;

  const messageText = [
    `${senderName} shared "${pageTitle}" with you:`,
    "",
    note ? note : null,
    "",
    fullPageUrl,
  ]
    .filter((line) => line !== null)
    .join("\n")
    .trim();

  // ── 1. Headless JWT DM as the sender ──────────────────────────────────────

  if (isCircleConfigured()) {
    try {
      // Look up sender's Circle member ID
      const adminClient = createAdminClient();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: mapping } = await (adminClient as any)
        .from("circle_member_mapping")
        .select("circle_member_id")
        .eq("supabase_user_id", senderUserId)
        .maybeSingle();

      if (mapping?.circle_member_id) {
        const senderCircleId = Number(mapping.circle_member_id);

        // Mint a JWT for the sender
        const token = await mintMemberToken({ community_member_id: senderCircleId });
        const memberClient = new CircleMemberClient(token.access_token);

        // Find recipient's Circle member ID by email
        const recipientResults = await memberClient.searchMembers(recipientEmail);
        const recipient = recipientResults[0];

        if (recipient?.id) {
          // Find or create DM room
          const chatRooms = await memberClient.listChatRooms();
          const existingRoom = chatRooms.find(
            (room) =>
              room.chat_room_kind === "direct" &&
              room.other_participants_preview.some(
                (m) => m.community_member_id === recipient.id
              )
          );

          const roomUuid = existingRoom
            ? existingRoom.uuid
            : (await memberClient.createDirectChatRoom(recipient.id)).uuid;

          await memberClient.sendMessage(roomUuid, messageText);
          return { success: true, method: "circle_dm" };
        }
      }
    } catch (err) {
      console.warn("[share-notify] Headless DM failed, trying Butler Ghost:", err);
    }

    // ── 2. Butler Ghost DM fallback ─────────────────────────────────────────

    const ghostClient = getCircleGhostClient();
    if (ghostClient) {
      const result = await ghostClient.sendDirectMessage(recipientEmail, messageText);
      if (result.success) {
        return { success: true, method: "circle_dm" };
      }
      console.warn("[share-notify] Butler Ghost DM also failed:", result.error);
    }
  }

  // ── 3. Email fallback ──────────────────────────────────────────────────────

  const { sendEmail } = await import("@/lib/email/send");

  const noteHtml = note
    ? `<blockquote style="margin:0 0 20px;padding:10px 14px;background:#F9FAFB;border-left:3px solid #D1D5DB;border-radius:4px;font-size:14px;color:#374151;">${note}</blockquote>`
    : "";

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#163D6D;margin:0 0 8px;">Page shared with you</h2>
      <p style="color:#6B7280;margin:0 0 20px;font-size:14px;">
        <strong>${senderName}</strong> shared <strong>${pageTitle}</strong> with you on the CSC site.
      </p>
      ${noteHtml}
      <p style="margin:0 0 20px;">
        <a href="${fullPageUrl}" style="background-color:#163D6D;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600;font-size:14px;">
          View page →
        </a>
      </p>
      <p style="margin:0;font-size:12px;color:#9CA3AF;">
        Reply to <a href="mailto:${senderEmail}" style="color:#163D6D;">${senderEmail}</a> if you have questions.
      </p>
    </div>
  `;

  try {
    await sendEmail({
      to: recipientEmail,
      subject: `${senderName} shared "${pageTitle}" with you`,
      html,
      replyTo: senderEmail,
    });
    return { success: true, method: "email" };
  } catch (err) {
    console.error("[share-notify] Email fallback failed:", err);
    return { success: false, error: "Failed to send notification" };
  }
}
