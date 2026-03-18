// ─────────────────────────────────────────────────────────────────
// Event email action tokens
// HMAC-SHA256 signed, 7-day expiry, single-purpose (approve | changes)
// Token is the sole authorization for the approve action.
// ─────────────────────────────────────────────────────────────────

import { createHmac } from "crypto";

export type EventActionType = "approve" | "changes";

interface TokenPayload {
  eventId: string;
  action: EventActionType;
  exp: number; // unix ms
}

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  return key;
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf) : buf;
  return b.toString("base64url");
}

function sign(payload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

/**
 * Generate a signed action token for an event email.
 */
export function generateEventActionToken(
  eventId: string,
  action: EventActionType
): string {
  const payload = b64url(
    JSON.stringify({ eventId, action, exp: Date.now() + TOKEN_TTL_MS } satisfies TokenPayload)
  );
  const sig = sign(payload, getSecret());
  return `${payload}.${sig}`;
}

/**
 * Verify a token and return its payload, or null if invalid/expired.
 */
export function verifyEventActionToken(
  token: string
): { eventId: string; action: EventActionType } | null {
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;

    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    // Constant-time comparison to prevent timing attacks
    const expected = sign(payload, getSecret());
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return null;

    const parsed: TokenPayload = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    );

    if (Date.now() > parsed.exp) return null;
    if (!parsed.eventId || !parsed.action) return null;

    return { eventId: parsed.eventId, action: parsed.action };
  } catch {
    return null;
  }
}

/**
 * Build the full approve/changes URLs for use in email templates.
 */
export function buildEventActionUrls(eventId: string): {
  approveUrl: string;
  changesUrl: string;
} {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const approveToken = generateEventActionToken(eventId, "approve");
  const changesToken = generateEventActionToken(eventId, "changes");

  return {
    approveUrl: `${base}/api/events/action?token=${encodeURIComponent(approveToken)}`,
    changesUrl: `${base}/api/events/action?token=${encodeURIComponent(changesToken)}`,
  };
}
