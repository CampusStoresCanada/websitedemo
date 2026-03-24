// ---------------------------------------------------------------------------
// CircleMemberClient — operates on behalf of a member using their JWT
// Used for DM operations (Admin API has no messaging endpoints)
// ---------------------------------------------------------------------------

import { CIRCLE_MEMBER_API_BASE } from "./config";
import type { CircleMessage, CircleChatRoom } from "./types";
import { CircleApiError } from "./types";

export interface CircleMemberNotification {
  id: string;
  title: string;
  message: string;
  href: string;
  created_at: string;
  read_at: string | null;
  is_unread: boolean;
  category: "notification" | "reply";
}

export class CircleMemberClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
    this.baseUrl = CIRCLE_MEMBER_API_BASE;
  }

  // ---- Internal fetch -----------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = { method, headers };
    if (options?.body && method !== "GET") {
      fetchOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url.toString(), fetchOptions);

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => null);
      }
      throw new CircleApiError(
        `Circle Member API ${method} ${path} failed: ${response.status}`,
        response.status,
        body
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  private async requestOptional(
    method: string,
    path: string,
    options?: {
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<unknown | null> {
    try {
      return await this.request<unknown>(method, path, options);
    } catch (error) {
      if (error instanceof CircleApiError) {
        if ([400, 401, 403, 404, 422].includes(error.status)) {
          return null;
        }
      }
      throw error;
    }
  }

  // ---- Profile ------------------------------------------------------------

  async getCommunityMember(communityMemberId: number): Promise<{ user_public_uid: string; community_member_id: number; name: string } | null> {
    return this.requestOptional("GET", `/community_members/${communityMemberId}`) as Promise<{ user_public_uid: string; community_member_id: number; name: string } | null>;
  }

  // ---- Chat rooms ---------------------------------------------------------

  async getProfile(): Promise<{ public_uid: string; name: string; avatar_url: string | null } | null> {
    try {
      return await this.request<{ public_uid: string; name: string; avatar_url: string | null }>("GET", "/community_member");
    } catch {
      return null;
    }
  }

  /**
   * List the member's chat rooms (DM conversations).
   */
  async listChatRooms(): Promise<CircleChatRoom[]> {
    try {
      const result = await this.request<{ records: CircleChatRoom[] }>("GET", "/messages");
      return result.records ?? (Array.isArray(result) ? result : []);
    } catch (err) {
      if (err instanceof CircleApiError && err.isNotFound) {
        console.warn("[circle/member-proxy] listChatRooms 404 — messages endpoint not available");
        return [];
      }
      throw err;
    }
  }

  // ---- Chat room creation -------------------------------------------------

  /**
   * Create a direct chat room with another member.
   * Circle auto-deduplicates: if a direct room already exists with this member,
   * it returns the existing one (idempotent).
   */
  async createDirectChatRoom(targetMemberId: number): Promise<CircleChatRoom> {
    return this.request<CircleChatRoom>("POST", "/chat_rooms", {
      body: {
        chat_room_kind: "direct",
        community_member_ids: [targetMemberId],
      },
    });
  }

  // ---- Messages -----------------------------------------------------------

  /**
   * Get messages in a specific chat room.
   */
  async getChatMessages(
    chatRoomUuid: string,
    options?: { per_page?: number; page?: number }
  ): Promise<CircleMessage[]> {
    const result = await this.request<{ records: CircleMessage[] }>(
      "GET",
      `/messages/${chatRoomUuid}/chat_room_messages`,
      {
        params: {
          per_page: options?.per_page ?? 20,
          page: options?.page ?? 1,
        },
      }
    );
    return result.records ?? (Array.isArray(result) ? result : []);
  }

  /**
   * Send a message to a chat room.
   * Body should be in TipTap JSON format or plain text.
   */
  async sendMessage(
    chatRoomUuid: string,
    body: string
  ): Promise<CircleMessage> {
    return this.request<CircleMessage>(
      "POST",
      `/messages/${chatRoomUuid}/chat_room_messages`,
      {
        body: {
          body,
        },
      }
    );
  }

  // ---- Member search (for finding DM targets) ----------------------------

  /**
   * Search for community members by email using headless member search.
   */
  async searchMembers(
    email: string
  ): Promise<
    Array<{ id: number; name: string; email: string; avatar_url: string | null; user_public_uid?: string }>
  > {
    const result = await this.request<{
      records: Array<{
        id: number;
        name: string;
        email: string;
        avatar_url: string | null;
        user_public_uid?: string;
      }>;
    }>("POST", "/search/community_members", {
      body: {
        filters: [
          { key: "email", filter_type: "is", value: email },
        ],
      },
    });
    return result.records ?? [];
  }

  /**
   * Best-effort fetch of member notification/reply feed for header tabs.
   * Circle endpoints vary across API versions, so we probe known candidates.
   */
  async listNotificationsSummary(
    options?: { per_page?: number }
  ): Promise<CircleMemberNotification[]> {
    const perPage = options?.per_page ?? 20;
    const raw = await this.requestOptional("GET", "/notifications", {
      params: { per_page: perPage },
    });
    if (!raw) return [];
    return parseNotifications(raw);
  }

  async markNotificationRead(notificationId: number | string): Promise<void> {
    await this.request("PUT", `/notifications/${notificationId}/mark_as_read`);
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.request("POST", "/notifications/mark_all_as_read", { body: {} });
  }

  async getNotificationCount(): Promise<number> {
    const result = await this.requestOptional("GET", "/notifications/count") as Record<string, number> | null;
    return result?.new_notifications_count ?? 0;
  }
}

function parseNotifications(payload: unknown): CircleMemberNotification[] {
  const rows =
    extractArray((payload as { records?: unknown[] })?.records) ??
    extractArray((payload as { notifications?: unknown[] })?.notifications) ??
    extractArray((payload as { items?: unknown[] })?.items) ??
    extractArray(payload);

  if (!rows || rows.length === 0) {
    return [];
  }

  const mapped = rows
    .map((row, index) => normalizeNotification(row, index))
    .filter((item): item is CircleMemberNotification => item !== null);

  return mapped;
}

function extractArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function normalizeNotification(
  row: unknown,
  index: number
): CircleMemberNotification | null {
  if (!row || typeof row !== "object") return null;

  const r = row as Record<string, unknown>;

  const id = String(r.id ?? `circle-item-${index}`);

  // Build title from actor + action + content
  const actorName = asString(r.actor_name) ?? "Someone";
  const displayAction = asString(r.display_action) ?? "posted in";
  const notifiableTitle = asString(r.notifiable_title) ?? "";
  const spaceTitle = asString(r.space_title) ?? "";
  const title = notifiableTitle
    ? `${actorName} ${displayAction} "${notifiableTitle}"`
    : `${actorName} ${displayAction} ${spaceTitle}`.trim();

  const message = spaceTitle && notifiableTitle ? spaceTitle : "";

  const href = asString(r.action_web_url) ?? asString(r.url) ?? asString(r.href) ?? "/api/circle/member-space";

  const createdAt =
    asString(r.created_at) ?? asString(r.inserted_at) ?? new Date().toISOString();

  const action = (asString(r.action) ?? "").toLowerCase();
  const category: "notification" | "reply" =
    action === "reply" || action === "comment" ? "reply" : "notification";

  const read_at = asString(r.read_at) ?? null;

  return { id, title, message, href, created_at: createdAt, read_at, is_unread: read_at === null, category };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
