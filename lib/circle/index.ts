// ---------------------------------------------------------------------------
// Circle integration — barrel exports
// ---------------------------------------------------------------------------

// Types
export type {
  CircleMember,
  CircleMemberInput,
  CirclePost,
  CircleSpace,
  CircleTag,
  CircleAccessGroup,
  CircleMessage,
  CircleChatRoom,
  CircleHeadlessTokenResponse,
  CircleHeadlessTokenRequest,
  CirclePaginatedResponse,
  CircleSyncOperation,
  CircleSyncQueueItem,
} from "./types";
export { CircleApiError } from "./types";

// Config
export {
  getCircleConfig,
  isCircleConfigured,
  ROLE_TO_CIRCLE_TAG,
  STATUS_TO_CIRCLE_SPACE,
  CIRCLE_ADMIN_API_BASE,
  CIRCLE_HEADLESS_AUTH_BASE,
  CIRCLE_MEMBER_API_BASE,
} from "./config";

// Admin API client
export { CircleAdminClient, getCircleClient } from "./client";

// Headless auth
export {
  mintMemberToken,
  refreshMemberToken,
  revokeMemberToken,
} from "./headless-auth";

// Member proxy (DM operations)
export { CircleMemberClient } from "./member-proxy";

// Sync infrastructure
export {
  enqueueCircleSync,
  processCircleSyncQueue,
  linkCircleAccount,
} from "./sync";

// Operations (internal, but exported for testing)
export { executeCircleSyncOperation } from "./operations";

// Announcements
export { getAnnouncementPosts } from "./announcements";

// Notifications
export { sendCircleNotification } from "./notifications";
