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

  // ---- Chat rooms ---------------------------------------------------------

  /**
   * List the member's chat rooms (DM conversations).
   */
  async listChatRooms(): Promise<CircleChatRoom[]> {
    const result = await this.request<{
      records: CircleChatRoom[];
    }>("GET", "/chat_rooms");
    return result.records ?? (Array.isArray(result) ? result : []);
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
    Array<{ id: number; name: string; email: string; avatar_url: string | null }>
  > {
    const result = await this.request<{
      records: Array<{
        id: number;
        name: string;
        email: string;
        avatar_url: string | null;
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
    const candidates: Array<{ path: string; params?: Record<string, string | number> }> = [
      { path: "/notifications", params: { per_page: perPage } },
      { path: "/member_notifications", params: { per_page: perPage } },
      { path: "/notification_center_items", params: { per_page: perPage } },
    ];

    for (const candidate of candidates) {
      const raw = await this.requestOptional("GET", candidate.path, {
        params: candidate.params,
      });
      if (!raw) continue;

      const parsed = parseNotifications(raw);
      if (parsed.length > 0) {
        return parsed;
      }
    }

    return [];
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
  if (!row || typeof row !== "object") {
    return null;
  }

  const candidate = row as Record<string, unknown>;

  const id =
    asString(candidate.id) ??
    asString(candidate.uuid) ??
    asString(candidate.notification_id) ??
    `circle-item-${index}`;

  const title =
    asString(candidate.title) ??
    asString(candidate.name) ??
    asString(candidate.subject) ??
    "Circle notification";

  const message =
    asString(candidate.body) ??
    asString(candidate.message) ??
    asString(candidate.preview) ??
    asString(candidate.summary) ??
    "";

  const href =
    asString(candidate.url) ??
    asString(candidate.href) ??
    asString(candidate.path) ??
    "/api/circle/member-space";

  const createdAt =
    asString(candidate.created_at) ??
    asString(candidate.inserted_at) ??
    asString(candidate.updated_at) ??
    new Date().toISOString();

  const eventType =
    (asString(candidate.type) ?? asString(candidate.event_type) ?? "").toLowerCase();
  const category: "notification" | "reply" =
    eventType.includes("reply") || eventType.includes("comment")
      ? "reply"
      : "notification";

  return {
    id,
    title,
    message,
    href,
    created_at: createdAt,
    category,
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
