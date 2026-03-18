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
   * Search for members by email using advanced_search endpoint.
   * Returns an array (may be empty if not found).
   */
  async searchMembers(email: string): Promise<CircleMember[]> {
    const result = await this.request<{ records: CircleMember[] }>(
      "GET",
      "/community_members",
      { params: { email } }
    );
    return result.records ?? (Array.isArray(result) ? result : []);
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

    // Try v1 API first (where posts actually live)
    const candidates = [
      `${CIRCLE_V1_API_BASE}/posts?${params}`,
      `${this.baseUrl}/posts?${params}`,
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

      // Filter to published posts client-side if status was requested
      if (options?.status === "published") {
        return records.filter((p) => p.status === "published" || !p.status);
      }
      return records;
    }

    // All candidates returned 404 — space not found or no posts
    return [];
  }

  // ---- Community ----------------------------------------------------------

  async getCommunity(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("GET", "/community");
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor
// ---------------------------------------------------------------------------

let _instance: CircleAdminClient | null = null;

/**
 * Returns a CircleAdminClient singleton, or null if Circle is not configured.
 */
export function getCircleClient(): CircleAdminClient | null {
  if (_instance) return _instance;

  const config = getCircleConfig();
  if (!config) return null;

  _instance = new CircleAdminClient(config.apiKey, config.communityId);
  return _instance;
}
