// ---------------------------------------------------------------------------
// Circle sync operation executor — maps queue items to API calls
// ---------------------------------------------------------------------------

import { createAdminClient } from "@/lib/supabase/admin";
import type { CircleAdminClient } from "./client";
import { mintMemberToken } from "./headless-auth";
import { CircleMemberClient } from "./member-proxy";
import { CircleApiError } from "./types";
import type { CircleMember, CircleMemberInput, CircleSyncQueueItem } from "./types";

/**
 * Removing something that is already absent is a no-op, not a failure.
 *
 * Circle 404s when the (tag, member) or (group, member) association does not
 * exist — because the person was never tagged/added, or was already removed,
 * or never had a Circle account at all. Letting that throw burns all 3 retry
 * attempts and parks the job as "failed", which buries real failures in noise.
 * Any other error still propagates.
 */
async function ignoreMissing(op: () => Promise<void>, what: string): Promise<void> {
  try {
    await op();
  } catch (err) {
    if (err instanceof CircleApiError && err.status === 404) {
      console.log(`[circle/operations] ${what} — already absent in Circle, treating as done`);
      return;
    }
    throw err;
  }
}

/**
 * Execute a single sync queue item against the Circle API.
 * Throws on failure (caller handles retry logic).
 *
 * emailMap — optional pre-built email→member map. When provided, link_member
 * operations use it instead of fetching all pages themselves, so a batch of N
 * link operations costs one page sweep instead of N.
 */
export async function executeCircleSyncOperation(
  client: CircleAdminClient,
  item: CircleSyncQueueItem,
  emailMap?: Map<string, CircleMember>
): Promise<void> {
  const payload = item.payload;

  switch (item.operation) {
    case "link_member":
      await handleLinkMember(client, item, emailMap);
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
  item: CircleSyncQueueItem,
  emailMap?: Map<string, CircleMember>
): Promise<void> {
  const email = String(item.payload.email ?? "");
  const name = String(item.payload.name ?? "");

  if (!email) throw new Error("link_member requires email in payload");

  // The batch map is built from the paginated member list, which omits anyone
  // who never accepted their invitation. A miss there means "not in the list",
  // NOT "not in Circle" — so always confirm against the search endpoint before
  // concluding the member is absent. Skipping that check is what sent existing
  // members down the create path.
  const existing =
    (emailMap ? emailMap.get(email.toLowerCase()) : undefined) ??
    (await client.findMemberByEmail(email));

  let circleId: number;
  if (existing?.id) {
    circleId = existing.id;
  } else if (name) {
    const created = await client.createMember({
      email,
      name,
      skip_invitation: true,
    });

    // createMember unwraps the nested `community_member`, but fall back to a
    // lookup rather than ever storing a non-numeric id again.
    const resolvedId =
      typeof created?.id === "number"
        ? created.id
        : (await client.findMemberByEmail(email))?.id;

    if (typeof resolvedId !== "number") {
      throw new Error(
        `Created Circle member for ${email} but could not resolve its id`
      );
    }
    circleId = resolvedId;
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
    await ignoreMissing(
      () => client.removeTagFromMember(Number(payload.tagId), email),
      `remove_tag ${payload.tagId} from ${email}`
    );
    return;
  }

  // Legacy: resolve by tag name
  const tagName = String(payload.tagName ?? payload.role ?? "");
  if (!tagName) return; // nothing to remove

  const tags = await client.listTags();
  const tag = tags.find((t) => t.name.toLowerCase() === tagName.toLowerCase());
  if (!tag) return; // tag doesn't exist — nothing to remove
  await ignoreMissing(
    () => client.removeTagFromMember(tag.id, email),
    `remove_tag ${tag.id} from ${email}`
  );
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

  await ignoreMissing(
    () => client.removeMemberFromAccessGroup(groupId, email),
    `remove_from_access_group ${groupId} for ${email}`
  );
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
  if (!circleId) return; // not linked to Circle — nothing to push

  const updates: Partial<CircleMemberInput> = {};
  if (typeof item.payload.name === "string") updates.name = item.payload.name;
  if (typeof item.payload.headline === "string") updates.headline = item.payload.headline;

  // Job title is a custom profile field on Circle (key `jobtitle`), not a
  // top-level member column — sending it as `title` silently did nothing,
  // which is why website title edits never showed up in Circle.
  if (typeof item.payload.jobTitle === "string") {
    updates.community_member_profile_fields = {
      ...(updates.community_member_profile_fields ?? {}),
      jobtitle: item.payload.jobTitle,
    };
  }

  if (Object.keys(updates).length === 0) return;

  await client.updateMember(circleId, updates);
}

async function handleDeleteMember(
  client: CircleAdminClient,
  item: CircleSyncQueueItem
): Promise<void> {
  // DISABLED — calls DELETE /community_members/{id}. Shut down during API usage audit.
  // WARNING: deprovisioned contacts will NOT be removed from Circle until re-enabled.
  // To re-enable: confirm monthly call volume is acceptable, then restore implementation.
  return;
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
