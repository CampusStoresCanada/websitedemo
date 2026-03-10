// ---------------------------------------------------------------------------
// Circle Headless Auth — mint / refresh / revoke member JWTs
// ---------------------------------------------------------------------------

import { CIRCLE_HEADLESS_AUTH_BASE, getCircleConfig } from "./config";
import type {
  CircleHeadlessTokenRequest,
  CircleHeadlessTokenResponse,
} from "./types";
import { CircleApiError } from "./types";

/**
 * Mint a member JWT token for headless API access.
 * Pass ONE of: email, community_member_id, or sso_id.
 *
 * Requires CIRCLE_HEADLESS_AUTH_TOKEN env var (separate from the Admin API key).
 */
export async function mintMemberToken(
  params: CircleHeadlessTokenRequest
): Promise<CircleHeadlessTokenResponse> {
  const config = getCircleConfig();
  if (!config?.headlessAuthToken) {
    throw new Error(
      "[circle/headless-auth] CIRCLE_HEADLESS_AUTH_TOKEN not configured"
    );
  }

  const response = await fetch(`${CIRCLE_HEADLESS_AUTH_BASE}/auth_token`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.headlessAuthToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }
    throw new CircleApiError(
      `Circle Headless Auth failed: ${response.status}`,
      response.status,
      body
    );
  }

  return response.json() as Promise<CircleHeadlessTokenResponse>;
}

/**
 * Refresh an expired member access token using its refresh token.
 */
export async function refreshMemberToken(
  refreshToken: string
): Promise<CircleHeadlessTokenResponse> {
  const config = getCircleConfig();
  if (!config?.headlessAuthToken) {
    throw new Error(
      "[circle/headless-auth] CIRCLE_HEADLESS_AUTH_TOKEN not configured"
    );
  }

  const response = await fetch(
    `${CIRCLE_HEADLESS_AUTH_BASE}/access_token/refresh`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.headlessAuthToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }
  );

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }
    throw new CircleApiError(
      `Circle token refresh failed: ${response.status}`,
      response.status,
      body
    );
  }

  return response.json() as Promise<CircleHeadlessTokenResponse>;
}

/**
 * Revoke a member access token.
 */
export async function revokeMemberToken(accessToken: string): Promise<void> {
  const config = getCircleConfig();
  if (!config?.headlessAuthToken) {
    throw new Error(
      "[circle/headless-auth] CIRCLE_HEADLESS_AUTH_TOKEN not configured"
    );
  }

  const response = await fetch(
    `${CIRCLE_HEADLESS_AUTH_BASE}/access_token/revoke`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.headlessAuthToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    }
  );

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = await response.text().catch(() => null);
    }
    throw new CircleApiError(
      `Circle token revocation failed: ${response.status}`,
      response.status,
      body
    );
  }
}
