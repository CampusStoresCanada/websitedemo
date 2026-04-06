// ---------------------------------------------------------------------------
// Circle sync operation executor — maps queue items to API calls
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import type { CircleAdminClient } from "./client";
import { mintMemberToken } from "./headless-auth";
import { CircleMemberClient } from "./member-proxy";
import type { CircleSyncQueueItem } from "./types";

/**
 * Execute a single sync queue item against the Circle API.
 * Throws on failure (caller handles retry logic).
 */
export async function executeCircleSyncOperation(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  const payload = item.payload;

  switch (item.operation) {
    case "link_member":
      await handleLinkMember(client, item);
      break;

    case "add_tag":
      await handleAddTag(client, payload);
      break;

    case "remove_tag":
      await handleRemoveTag(client, payload);
      break;

    case "add_to_space":
      await handleAddToSpace(client, item);
      break;

    case "remove_from_space":
      await handleRemoveFromSpace(client, item);
      break;

    case "add_to_access_group":
      await handleAddToAccessGroup(client, payload);
      break;

    case "remove_from_access_group":
      await handleRemoveFromAccessGroup(client, payload);
      break;

    case "send_dm":
      await handleSendDm(payload);
      break;

    case "update_profile":
      await handleUpdateProfile(client, item);
      break;

    case "delete_member":
      await handleDeleteMember(client, item);
      break;

    default:
      throw new Error(`Unknown Circle sync operation: ${item.operation}`);
  }
}

// ---------------------------------------------------------------------------
// Operation handlers
// ---------------------------------------------------------------------------

async function handleLinkMember(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  const email = String(item.payload.email ?? "");
  const name = String(item.payload.name ?? "");

  if (!email) throw new Error("link_member requires email in payload");

  // Search for existing Circle member
  const members = await client.searchMembers(email);

  let circleId: number;
  if (members.length > 0) {
    circleId = members[0].id;
  } else if (name) {
    // Create new member
    const created = await client.createMember({
      email,
      name,
      skip_invitation: true,
    });
    circleId = created.id;
  } else {
    throw new Error(`No Circle member found for ${email} and no name for creation`);
  }

  // Intentional exception to identity lifecycle helper usage:
  // this is external-system metadata (`circle_id`, sync timestamp), not
  // identity/profile data, so we update the contact projection directly.
  const adminClient = createAdminClient();
  await adminClient
    .from("contacts")
    .update({
      circle_id: String(circleId),
      synced_to_circle_at: new Date().toISOString(),
    })
    .eq("id", item.entity_id);
}

async function handleAddTag(
  client: CircleAdminClient,
  payload: Record<string, unknown>
): Promise<void> {
  const email = String(payload.email ?? "");
  if (!email) throw new Error("add_tag requires email in payload");

  // Prefer direct tagId (org tag); fall back to legacy role-based name lookup
  if (payload.tagId) {
    await client.addTagToMember(Number(payload.tagId), email);
    return;
  }

  // Legacy: resolve by tag name
  const tagName = String(payload.tagName ?? payload.role ?? "");
  if (!tagName) throw new Error("add_tag requires tagId or tagName in payload");

  const tags = await client.listTags();
  const tag = tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
  if (!tag) throw new Error(`Circle tag "${tagName}" not found`);
  await client.addTagToMember(tag.id, email);
}

async function handleRemoveTag(
  client: CircleAdminClient,
  payload: Record<string, unknown>
): Promise<void> {
  const email = String(payload.email ?? "");
  if (!email) throw new Error("remove_tag requires email in payload");

  // Prefer direct tagId
  if (payload.tagId) {
    await client.removeTagFromMember(Number(payload.tagId), email);
    return;
  }

  // Legacy: resolve by tag name
  const tagName = String(payload.tagName ?? payload.role ?? "");
  if (!tagName) return; // nothing to remove

  const tags = await client.listTags();
  const tag = tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
  if (!tag) return; // tag doesn't exist — nothing to remove
  await client.removeTagFromMember(tag.id, email);
}

async function handleAddToSpace(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  const spaceId = Number(item.payload.spaceId);
  const circleId = await resolveCircleId(item.entity_id);

  if (!spaceId || !circleId) {
    throw new Error(
      `add_to_space requires spaceId in payload and linked Circle account (entity: ${item.entity_id})`
    );
  }

  await client.addMemberToSpace(spaceId, circleId);
}

async function handleRemoveFromSpace(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  const spaceId = Number(item.payload.spaceId);
  const circleId = await resolveCircleId(item.entity_id);

  if (!spaceId || !circleId) {
    // Can't remove if not linked — silently succeed
    return;
  }

  await client.removeMemberFromSpace(spaceId, circleId);
}

async function handleAddToAccessGroup(
  client: CircleAdminClient,
  payload: Record<string, unknown>
): Promise<void> {
  const groupId = Number(payload.groupId);
  const email = String(payload.email ?? "");

  if (!groupId || !email) {
    throw new Error("add_to_access_group requires groupId and email");
  }

  await client.addMemberToAccessGroup(groupId, email);
}

async function handleRemoveFromAccessGroup(
  client: CircleAdminClient,
  payload: Record<string, unknown>
): Promise<void> {
  const groupId = Number(payload.groupId);
  const email = String(payload.email ?? "");

  if (!groupId || !email) return;

  await client.removeMemberFromAccessGroup(groupId, email);
}

async function handleSendDm(
  payload: Record<string, unknown>
): Promise<void> {
  const recipientCircleId = Number(payload.recipientCircleId);
  const botUserId = Number(payload.botUserId);
  const message = String(payload.message ?? "");

  if (!recipientCircleId || !botUserId || !message) {
    throw new Error("send_dm requires recipientCircleId, botUserId, and message");
  }

  // Mint a token for the bot user
  const token = await mintMemberToken({
    community_member_id: botUserId,
  });

  const memberClient = new CircleMemberClient(token.access_token);

  // Find or get the direct chat room with the recipient.
  // For now, list all chat rooms and find the one with the recipient.
  const chatRooms = await memberClient.listChatRooms();
  const directRoom = chatRooms.find(
    (room) =>
      room.chat_room_kind === "direct" &&
      room.other_participants_preview.some((m) => m.community_member_id === recipientCircleId)
  );

  let roomUuid: string;
  if (directRoom) {
    roomUuid = directRoom.uuid;
  } else {
    // No existing room — create one (Circle deduplicates if one already exists)
    const newRoom = await memberClient.createDirectChatRoom(recipientCircleId);
    roomUuid = newRoom.uuid;
  }

  await memberClient.sendMessage(roomUuid, message);
}

async function handleUpdateProfile(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  const circleId = await resolveCircleId(item.entity_id);
  if (!circleId) {
    // Not linked yet — skip silently (will be linked later via link_member)
    return;
  }

  // Payload may carry pre-fetched values; fall back to fetching from DB
  let name = item.payload.name ? String(item.payload.name) : null;
  let headline = item.payload.headline ? String(item.payload.headline) : null;

  if (!name || !headline) {
    const adminClient = createAdminClient();
    const { data: contact } = await adminClient
      .from("contacts")
      .select("name, role_title")
      .eq("id", item.entity_id)
      .single();

    if (!name && contact?.name) name = contact.name;
    if (!headline && contact?.role_title) headline = contact.role_title;
  }

  const updates: Record<string, string> = {};
  if (name) updates.name = name;
  if (headline) updates.headline = headline;

  if (Object.keys(updates).length === 0) return;

  await client.updateMember(circleId, updates);
}

async function handleDeleteMember(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  const circleId = await resolveCircleId(item.entity_id);
  if (!circleId) {
    // Not linked — nothing to delete
    return;
  }

  await client.deleteMember(circleId);

  // Clear circle_id so re-add works cleanly on reactivation
  const adminClient = createAdminClient();
  await adminClient
    .from("contacts")
    .update({
      circle_id: null,
      synced_to_circle_at: new Date().toISOString(),
    })
    .eq("id", item.entity_id);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a contact's circle_id from the contacts projection.
 */
async function resolveCircleId(contactId: string): Promise<number | null> {
  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("contacts")
    .select("circle_id")
    .eq("id", contactId)
    .single();

  if (!data?.circle_id) return null;
  return Number(data.circle_id);
}
