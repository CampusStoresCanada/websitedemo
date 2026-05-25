// ---------------------------------------------------------------------------
// CircleAdminClient — thin fetch wrapper for Circle Admin API v2
// ---------------------------------------------------------------------------

import { CIRCLE_ADMIN_API_BASE, CIRCLE_V1_API_BASE, getCircleConfig } from "./config";
import type {
  CircleMember,
  CircleMemberInput,
  CirclePost,
  CircleSpace,
  CircleTag,
  CircleAccessGroup,
  CircleEvent,
  CircleEventInput,
  CircleEventAttendee,
} from "./types";
import { CircleApiError } from "./types";

interface ListPostsOptions {
  per_page?: number;
  page?: number;
  sort?: "latest" | "oldest";
  status?: "published" | "draft";
}

export class CircleAdminClient {
  private readonly apiKey: string;
  private readonly communityId: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, communityId: string) {
    this.apiKey = apiKey;
    this.communityId = communityId;
    this.baseUrl = CIRCLE_ADMIN_API_BASE;
  }

  // ---- Internal fetch with retry ------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: Record<string, unknown>;
      params?: Record<string, string | number | boolean | undefined>;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    url.searchParams.set("community_id", this.communityId);

    if (options?.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const fetchOptions: RequestInit = { method, headers };
    if (options?.body && method !== "GET") {
      fetchOptions.body = JSON.stringify(options.body);
    }

    // First attempt
    let response = await fetch(url.toString(), fetchOptions);

    // Retry once on 429 or 5xx
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = response.headers.get("retry-after");
      const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000;
      await new Promise((r) => setTimeout(r, delay));
      response = await fetch(url.toString(), fetchOptions);
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => null);
      }
      throw new CircleApiError(
        `Circle API ${method} ${path} failed: ${response.status}`,
        response.status,
        body
      );
    }

    // DELETE often returns 204 with no body
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  // ---- Members ------------------------------------------------------------

  async getMember(id: number): Promise<CircleMember> {
    return this.request<CircleMember>("GET", `/community_members/${id}`);
  }

  /**
   * Search for a member by email.
   * Circle's API ignores all filter params and returns all members,
   * so we fetch all pages and match client-side.
   */
  async searchMembers(email: string): Promise<CircleMember[]> {
    const map = await this.buildEmailMap();
    const member = map.get(email.toLowerCase());
    return member ? [member] : [];
  }

  /**
   * Fetch all Circle members (all pages) and return a Map of email → member.
   * Circle has no server-side email filter, so bulk operations must do this.
   */
  async buildEmailMap(): Promise<Map<string, CircleMember>> {
    const map = new Map<string, CircleMember>();
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.request<{
        records: CircleMember[];
        has_next_page: boolean;
      }>("GET", "/community_members", {
        params: { per_page: 100, page },
      });
      const records = result.records ?? [];
      for (const m of records) {
        if (m.email) map.set(m.email.toLowerCase(), m);
      }
      if (!result.has_next_page || records.length === 0) break;
      page++;
    }
    return map;
  }

  async createMember(data: CircleMemberInput): Promise<CircleMember> {
    return this.request<CircleMember>("POST", "/community_members", {
      body: data as unknown as Record<string, unknown>,
    });
  }

  async updateMember(
    id: number,
    data: Partial<CircleMemberInput>
  ): Promise<CircleMember> {
    return this.request<CircleMember>("PUT", `/community_members/${id}`, {
      body: data as unknown as Record<string, unknown>,
    });
  }

  async deleteMember(id: number): Promise<void> {
    await this.request<void>("DELETE", `/community_members/${id}`);
  }

  // ---- Tags ---------------------------------------------------------------

  async listTags(): Promise<CircleTag[]> {
    const result = await this.request<{ records: CircleTag[] }>(
      "GET",
      "/member_tags"
    );
    return result.records ?? (Array.isArray(result) ? result : []);
  }

  /**
   * Add a tag to a member. Uses POST to the tagged_members sub-resource
   * of the member_tag. The Circle API expects the member's email.
   */
  async createTag(data: {
    name: string;
    color?: string;
    custom_emoji_url?: string;
    display_format?: string;
    is_public?: boolean;
    is_background_enabled?: boolean;
    display_locations?: { post_bio?: boolean; profile_page?: boolean; member_directory?: boolean };
  }): Promise<CircleTag> {
    return this.request<CircleTag>("POST", "/member_tags", { body: data });
  }

  async updateTag(
    tagId: number,
    data: {
      name?: string;
      color?: string;
      custom_emoji_url?: string;
      display_format?: string;
      is_public?: boolean;
      is_background_enabled?: boolean;
      display_locations?: { post_bio?: boolean; profile_page?: boolean; member_directory?: boolean };
    }
  ): Promise<CircleTag> {
    return this.request<CircleTag>("PUT", `/member_tags/${tagId}`, { body: data });
  }

  async deleteTag(tagId: number): Promise<void> {
    await this.request<void>("DELETE", `/member_tags/${tagId}`);
  }

  async addTagToMember(tagId: number, email: string): Promise<void> {
    await this.request<void>("POST", `/member_tags/${tagId}/tagged_members`, {
      body: { email },
    });
  }

  /**
   * Remove a tag from a member. Uses DELETE to the tagged_members sub-resource.
   */
  async removeTagFromMember(tagId: number, email: string): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/member_tags/${tagId}/tagged_members`,
      { body: { email } }
    );
  }

  // ---- Spaces -------------------------------------------------------------

  async listSpaces(): Promise<CircleSpace[]> {
    const result = await this.request<{ records: CircleSpace[] }>(
      "GET",
      "/spaces"
    );
    return result.records ?? (Array.isArray(result) ? result : []);
  }

  async addMemberToSpace(spaceId: number, memberId: number): Promise<void> {
    await this.request<void>("POST", `/spaces/${spaceId}/members`, {
      body: { community_member_id: memberId },
    });
  }

  async removeMemberFromSpace(
    spaceId: number,
    memberId: number
  ): Promise<void> {
    await this.request<void>("DELETE", `/spaces/${spaceId}/members`, {
      body: { community_member_id: memberId },
    });
  }

  // ---- Access Groups ------------------------------------------------------

  async createAccessGroup(name: string): Promise<CircleAccessGroup> {
    return this.request<CircleAccessGroup>("POST", "/access_groups", {
      body: { name },
    });
  }

  async listAccessGroups(): Promise<CircleAccessGroup[]> {
    const result = await this.request<{ records: CircleAccessGroup[] }>(
      "GET",
      "/access_groups"
    );
    return result.records ?? (Array.isArray(result) ? result : []);
  }

  async addMemberToAccessGroup(
    groupId: number,
    email: string
  ): Promise<void> {
    await this.request<void>(
      "POST",
      `/access_groups/${groupId}/community_members`,
      { body: { email } }
    );
  }

  async removeMemberFromAccessGroup(
    groupId: number,
    email: string
  ): Promise<void> {
    await this.request<void>(
      "DELETE",
      `/access_groups/${groupId}/community_members`,
      { body: { email } }
    );
  }

  async updateAccessGroup(
    groupId: number,
    data: { name?: string }
  ): Promise<CircleAccessGroup> {
    return this.request<CircleAccessGroup>(
      "PUT",
      `/access_groups/${groupId}`,
      { body: data }
    );
  }

  async deleteAccessGroup(groupId: number): Promise<void> {
    await this.request<void>("DELETE", `/access_groups/${groupId}`);
  }

  /** List members of an access group (paginated). */
  async listAccessGroupMembers(
    groupId: number
  ): Promise<CircleMember[]> {
    const members: CircleMember[] = [];
    let page = 1;
    while (true) {
      const result = await this.request<{
        records: CircleMember[];
        has_next_page: boolean;
      }>("GET", `/access_groups/${groupId}/community_members`, {
        params: { per_page: 100, page },
      });
      const records = result.records ?? [];
      members.push(...records);
      if (!result.has_next_page || records.length === 0) break;
      page++;
    }
    return members;
  }

  // ---- Posts (announcements feed) -----------------------------------------

  /**
   * List posts in a Circle space.
   *
   * Circle's posts API exists at the v1 base (`/api/v1/posts`), not admin v2.
   * We build the request manually here with the v1 base URL.
   * Falls back gracefully on 404 (space has no posts or env var misconfigured).
   */
  async listPosts(
    spaceId: number,
    options?: ListPostsOptions
  ): Promise<CirclePost[]> {
    const config = getCircleConfig();
    if (!config) return [];

    const params = new URLSearchParams({
      community_id: config.communityId,
      space_id: String(spaceId),
      per_page: String(options?.per_page ?? 10),
      page: String(options?.page ?? 1),
      sort: options?.sort ?? "newest",
    });
    // Note: `status` filter omitted — v1 API may not support it; filter client-side if needed

    // Try admin v2 first (reliable), fall back to v1 if 404
    const candidates = [
      `${this.baseUrl}/posts?${params}`,
      `${CIRCLE_V1_API_BASE}/posts?${params}`,
    ];

    for (const url of candidates) {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      });

      if (response.status === 404) continue; // try next candidate

      if (!response.ok) {
        // Non-404 error — throw so caller can handle
        const body = await response.json().catch(() => null);
        throw new (await import("./types")).CircleApiError(
          `Circle API GET /posts failed: ${response.status}`,
          response.status,
          body
        );
      }

      const data = await response.json();
      const records: CirclePost[] = data.records ?? (Array.isArray(data) ? data : []);

      // Continue to next candidate if this URL returned nothing
      if (records.length === 0) continue;

      // Filter to published posts client-side if status was requested
      if (options?.status === "published") {
        return records.filter((p) => p.status === "published" || !p.status);
      }
      return records;
    }

    // All candidates returned 404 or empty
    return [];
  }

  // ---- Events -------------------------------------------------------------

  async listEvents(options?: {
    space_id?: number;
    per_page?: number;
    page?: number;
  }): Promise<{ records: CircleEvent[]; has_next_page: boolean }> {
    return this.request<{ records: CircleEvent[]; has_next_page: boolean }>(
      "GET",
      "/events",
      { params: { per_page: options?.per_page ?? 50, page: options?.page ?? 1, ...(options?.space_id ? { space_id: options.space_id } : {}) } }
    );
  }

  /** Fetch all Circle events across all pages. */
  async listAllEvents(spaceId?: number): Promise<CircleEvent[]> {
    const events: CircleEvent[] = [];
    let page = 1;
    while (true) {
      const result = await this.listEvents({ space_id: spaceId, per_page: 50, page });
      events.push(...(result.records ?? []));
      if (!result.has_next_page || (result.records ?? []).length === 0) break;
      page++;
    }
    return events;
  }

  async getEvent(id: number): Promise<CircleEvent> {
    return this.request<CircleEvent>("GET", `/events/${id}`);
  }

  async createEvent(payload: CircleEventInput): Promise<CircleEvent> {
    return this.request<CircleEvent>("POST", "/events", {
      body: payload as unknown as Record<string, unknown>,
    });
  }

  async updateEvent(id: number, payload: Partial<CircleEventInput>): Promise<CircleEvent> {
    return this.request<CircleEvent>("PUT", `/events/${id}`, {
      body: payload as unknown as Record<string, unknown>,
    });
  }

  async destroyEvent(id: number): Promise<void> {
    await this.request<void>("DELETE", `/events/${id}`);
  }

  // ---- Event attendees ----------------------------------------------------

  async listEventAttendees(
    eventId: number,
    options?: { per_page?: number; page?: number }
  ): Promise<{ records: CircleEventAttendee[]; has_next_page: boolean }> {
    return this.request<{ records: CircleEventAttendee[]; has_next_page: boolean }>(
      "GET",
      `/event_attendees`,
      { params: { event_id: eventId, per_page: options?.per_page ?? 100, page: options?.page ?? 1 } }
    );
  }

  async listAllEventAttendees(eventId: number): Promise<CircleEventAttendee[]> {
    const attendees: CircleEventAttendee[] = [];
    let page = 1;
    while (true) {
      const result = await this.listEventAttendees(eventId, { per_page: 100, page });
      attendees.push(...(result.records ?? []));
      if (!result.has_next_page || (result.records ?? []).length === 0) break;
      page++;
    }
    return attendees;
  }

  async createEventAttendee(
    eventId: number,
    communityMemberId: number
  ): Promise<CircleEventAttendee> {
    return this.request<CircleEventAttendee>(
      "POST",
      `/event_attendees`,
      { body: { event_id: eventId, community_member_id: communityMemberId } }
    );
  }

  async destroyEventAttendee(eventId: number, attendeeId: number): Promise<void> {
    await this.request<void>("DELETE", `/event_attendees/${attendeeId}`);
  }

  // ---- Community ----------------------------------------------------------

  async getCommunity(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/community");
  }

  // ---- Direct messaging ---------------------------------------------------

  /**
   * Send a direct message TO a member (identified by email) via the Admin API v2.
   * The message appears as coming from the API key owner.
   * Returns null if the recipient is the same as the API key owner (self-DM not allowed).
   */
  async sendDirectMessage(
    recipientEmail: string,
    text: string
  ): Promise<{ success: boolean; selfDm?: boolean; error?: string }> {
    const content = [{ type: "paragraph", content: [{ type: "text", text }] }];
    return this.sendDirectMessageRich(recipientEmail, content, text);
  }

  /**
   * Send a DM with a ProseMirror content array — supports bold, links, multiple
   * paragraphs, etc. Pass a plain-text fallbackText for the iOS push notification.
   *
   * Content node shape (subset):
   *   { type: "paragraph", content: TextNode[] }
   *   TextNode: { type: "text", text: string, marks?: Mark[] }
   *   Mark: { type: "link", attrs: { href: string; target?: string } }
   *         { type: "bold" }
   */
  async sendDirectMessageRich(
    recipientEmail: string,
    content: unknown[],
    fallbackText: string
  ): Promise<{ success: boolean; selfDm?: boolean; error?: string }> {
    try {
      await this.request("POST", "/messages", {
        body: {
          user_email: recipientEmail,
          rich_text_body: {
            body: { type: "doc", content },
            circle_ios_fallback_text: fallbackText,
            format: "chat",
            attachments: [],
            community_members: [],
            entities: [],
            group_mentions: [],
            inline_attachments: [],
            polls: [],
            sgids_to_object_map: {},
          },
        },
      });
      return { success: true };
    } catch (err) {
      if (err instanceof CircleApiError) {
        const body = err.responseBody as { message?: string } | null;
        if (body?.message?.toLowerCase().includes("direct message yourself")) {
          return { success: false, selfDm: true };
        }
        return { success: false, error: body?.message ?? err.message };
      }
      return { success: false, error: String(err) };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _instance: CircleAdminClient | null = null;
let _ghostInstance: CircleAdminClient | null = null;

/**
 * Returns a CircleAdminClient singleton using the main API key.
 */
export function getCircleClient(): CircleAdminClient | null {
  if (_instance) return _instance;

  const config = getCircleConfig();
  if (!config) return null;

  _instance = new CircleAdminClient(config.apiKey, config.communityId);
  return _instance;
}

/**
 * Returns a CircleAdminClient using Butler Ghost's API key.
 * Use this for sending DMs — messages appear as coming from Butler, not the super admin.
 * Falls back to the main client if CIRCLE_GHOST_KEY is not configured.
 */
export function getCircleGhostClient(): CircleAdminClient | null {
  if (_ghostInstance) return _ghostInstance;

  const config = getCircleConfig();
  if (!config) return null;

  const key = config.ghostApiKey || config.apiKey;
  _ghostInstance = new CircleAdminClient(key, config.communityId);
  return _ghostInstance;
}
