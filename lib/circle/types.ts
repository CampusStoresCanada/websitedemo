// ---------------------------------------------------------------------------
// Circle API types — derived from Admin API v2 + Headless Member API docs
// ---------------------------------------------------------------------------

// ---- Core entities --------------------------------------------------------

export interface CircleMember {
  id: number;
  email: string;
  name: string;
  avatar_url: string | null;
  headline: string | null;
  bio: string | null;
  created_at: string;
  space_ids: number[];
  tag_ids: number[];
  admin: boolean;
  active: boolean;
}

export interface CircleMemberInput {
  email: string;
  name: string;
  headline?: string;
  bio?: string;
  tag_ids?: number[];
  space_ids?: number[];
  skip_invitation?: boolean;
}

export interface CirclePost {
  id: number;
  name: string; // title
  body: string | null; // HTML content
  space_id: number;
  user_id: number;
  created_at: string;
  updated_at: string;
  url: string;
  status: string;
  slug: string | null;
  user: { id: number; name: string; avatar_url: string | null } | null;
}

export interface CircleSpace {
  id: number;
  name: string;
  slug: string;
  space_type: string;
  is_private: boolean;
  created_at: string;
}

export interface CircleTag {
  id: number;
  name: string;
  created_at: string;
}

export interface CircleAccessGroup {
  id: number;
  name: string;
  created_at: string;
}

export interface CircleMessage {
  id: number;
  body: string;
  user_id: number;
  chat_room_uuid: string;
  created_at: string;
  updated_at: string;
  user: { id: number; name: string; avatar_url: string | null } | null;
}

export interface CircleChatRoom {
  uuid: string;
  chat_room_kind: "direct" | "group_chat";
  last_message_at: string | null;
  members: Array<{ id: number; name: string; avatar_url: string | null }>;
}

// ---- Headless Auth --------------------------------------------------------

export interface CircleHeadlessTokenResponse {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  community_member_id: number;
  community_id: number;
}

export interface CircleHeadlessTokenRequest {
  email?: string;
  community_member_id?: number;
  sso_id?: string;
}

// ---- API responses --------------------------------------------------------

export interface CirclePaginatedResponse<T> {
  records: T[];
  has_next_page: boolean;
  page: number;
  per_page: number;
}

// ---- Sync queue -----------------------------------------------------------

export type CircleSyncOperation =
  | "link_member"
  | "add_tag"
  | "remove_tag"
  | "add_to_space"
  | "remove_from_space"
  | "add_to_access_group"
  | "remove_from_access_group"
  | "send_dm"
  | "update_profile";

export interface CircleSyncQueueItem {
  id: string;
  operation: CircleSyncOperation;
  entity_type: "contact" | "organization";
  entity_id: string;
  payload: Record<string, unknown>;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
  processed_at: string | null;
  next_retry_at: string | null;
  idempotency_key: string | null;
}

// ---- Error ----------------------------------------------------------------

export class CircleApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly responseBody: unknown;

  constructor(
    message: string,
    status: number,
    responseBody?: unknown,
    code?: string
  ) {
    super(message);
    this.name = "CircleApiError";
    this.status = status;
    this.code = code ?? null;
    this.responseBody = responseBody ?? null;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}
