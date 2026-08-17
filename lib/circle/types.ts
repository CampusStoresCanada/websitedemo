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
  /** Present on the raw API response; used for last-write-wins name sync. */
  updated_at?: string;
  space_ids: number[];
  tag_ids: number[];
  admin: boolean;
  active: boolean;
  public_uid: string | null;
  profile_url: string | null;
}

export interface CircleMemberInput {
  email: string;
  name: string;
  headline?: string;
  bio?: string;
  tag_ids?: number[];
  space_ids?: number[];
  skip_invitation?: boolean;
  active?: boolean;
  /**
   * Custom profile fields, keyed by Circle's field `key` (not its label).
   * Job title lives here as `jobtitle` — it is not a top-level member column,
   * which is why title edits never reached Circle before.
   */
  community_member_profile_fields?: Record<string, string>;
}

export interface CirclePost {
  id: number;
  name: string; // title
  body: string | { body: string; [key: string]: unknown } | null; // HTML string or admin v2 nested object
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

export interface CircleChatRoomParticipant {
  community_member_id: number;
  name: string;
  avatar_url: string | null;
}

export interface CircleChatRoom {
  id: number;
  uuid: string;
  chat_room_kind: "direct" | "group_chat";
  chat_room_name: string;
  unread_messages_count: number;
  last_message: {
    body: string;
    sender: { name: string; avatar_url: string | null };
    created_at: string;
  } | null;
  other_participants_preview: CircleChatRoomParticipant[];
  current_participant: CircleChatRoomParticipant | null;
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
  | "update_profile"
  | "delete_member";

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

// ---- Events ---------------------------------------------------------------

export interface CircleEvent {
  id: number;
  name: string;
  /** Rich text / HTML event body — Circle v2 API uses "body", not "description" */
  body: string | null;
  starts_at: string;
  ends_at: string | null;
  /** "virtual" | "in_person" — Circle v2 uses location_type, not is_virtual */
  location_type: "virtual" | "in_person" | string;
  in_person_location: string | null;
  virtual_location_url: string | null;
  space_id?: number;
  space?: { id: number; slug: string; name: string; community_id: number };
  community_id?: number;
  url: string;
  cover_image_url?: string | null;
  host?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CircleEventInput {
  name: string;
  body?: string;
  starts_at: string;
  ends_at?: string;
  location_type?: "virtual" | "in_person";
  in_person_location?: string;
  virtual_location_url?: string;
  space_id: number;
}

export interface CircleEventAttendee {
  id: number;
  event_id: number;
  community_member_id: number;
  rsvp_status: string; // "yes" | "no" | "maybe"
  member_name: string | null;
  member_email: string | null;
  rsvp_date: string;
  created_at?: string;
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
