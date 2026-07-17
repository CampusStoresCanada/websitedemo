import { TTLCache } from "../cache/ttl-cache";
import { resolveUserCircleId } from "./member-link";
import { mintMemberToken } from "./headless-auth";
import { CircleMemberClient } from "./member-proxy";

// Fallback only — real TTL below is derived from Circle's own token expiry.
const TOKEN_FALLBACK_TTL_MS = 5 * 60_000;
const TOKEN_SAFETY_BUFFER_MS = 60_000;

const tokenCache = new TTLCache<string>(TOKEN_FALLBACK_TTL_MS);

/**
 * Resolve a Circle-linked user's member client, reusing a cached access
 * token instead of minting a fresh one (a real external auth round-trip)
 * on every call. Centralizes what app/api/circle/dm and
 * app/api/circle/notifications each used to do independently inline.
 */
export async function getCircleClientForUser(
  userId: string,
  userEmail: string | null
): Promise<CircleMemberClient | null> {
  const circleId = await resolveUserCircleId(userId, userEmail);
  if (!circleId) return null;

  const cacheKey = `circle-token:${userId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return new CircleMemberClient(cached);

  const token = await mintMemberToken({ email: userEmail ?? undefined });
  const expiresAtMs = Date.parse(token.access_token_expires_at);
  const ttlMs = Number.isFinite(expiresAtMs)
    ? Math.max(expiresAtMs - Date.now() - TOKEN_SAFETY_BUFFER_MS, 0)
    : undefined;

  tokenCache.set(cacheKey, token.access_token, ttlMs);
  return new CircleMemberClient(token.access_token);
}
