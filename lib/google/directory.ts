/**
 * Google Workspace group membership.
 *
 * The one store adapter the space-rules job needed and did not have. Everything
 * around it — which people belong in a destination, the hourly tick, the
 * telemetry — is the existing `circle_space_rules` machinery; this is only the
 * part that differs, because a Google group is addressed by email where a
 * Circle space is addressed by member id.
 *
 * ⛔ Authenticates by domain-wide delegation with ONE scope,
 * `admin.directory.group.member`. That scope adds and removes group members
 * and can do nothing else: it cannot read mail, create users, or change any
 * other directory setting. If a future job needs more, it gets its own
 * service account and its own grant rather than this one being widened.
 *
 * ⚠️ Delegation acts AS a person. GOOGLE_WORKSPACE_ADMIN_EMAIL must keep the
 * Groups Admin privilege or every call here fails — and it fails at the API,
 * long after whoever removed that privilege has forgotten they did.
 */

import { google } from "googleapis";

const SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";

export type GroupMember = { email: string; role: string };

export class WorkspaceNotConfigured extends Error {}

function client() {
  const email = process.env.GOOGLE_WORKSPACE_SA_EMAIL;
  const subject = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL;
  const raw = process.env.GOOGLE_WORKSPACE_SA_PRIVATE_KEY;

  if (!email || !subject || !raw)
    throw new WorkspaceNotConfigured(
      "Google Workspace is not configured — GOOGLE_WORKSPACE_SA_EMAIL, GOOGLE_WORKSPACE_ADMIN_EMAIL and GOOGLE_WORKSPACE_SA_PRIVATE_KEY must all be set."
    );

  // ⚠️ The key is stored with literal \n escapes because an env var cannot
  // carry real newlines. A key left unescaped parses as a single line and
  // fails with an opaque OpenSSL error rather than anything about newlines.
  const key = raw.replace(/\\n/g, "\n");

  const auth = new google.auth.JWT({ email, key, subject, scopes: [SCOPE] });
  return google.admin({ version: "directory_v1", auth });
}

export function workspaceConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_WORKSPACE_SA_EMAIL &&
      process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL &&
      process.env.GOOGLE_WORKSPACE_SA_PRIVATE_KEY
  );
}

/** Everyone currently in the group. Paged, because a group can exceed one page. */
export async function listGroupMembers(groupEmail: string): Promise<GroupMember[]> {
  const admin = client();
  const out: GroupMember[] = [];
  let pageToken: string | undefined;

  do {
    const res = await admin.members.list({ groupKey: groupEmail, maxResults: 200, pageToken });
    for (const m of res.data.members ?? []) {
      if (m.email) out.push({ email: m.email.toLowerCase(), role: m.role ?? "MEMBER" });
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

/**
 * Add one person as an ordinary MEMBER.
 *
 * ⛔ Never OWNER or MANAGER. Those carry the ability to change the group
 * itself, and nothing about holding a seat on the board implies it. The two
 * managers on board@ today were set by a person and this must not disturb
 * them.
 */
export async function addGroupMember(groupEmail: string, memberEmail: string): Promise<void> {
  const admin = client();
  await admin.members.insert({
    groupKey: groupEmail,
    requestBody: { email: memberEmail, role: "MEMBER" },
  });
}

export async function removeGroupMember(groupEmail: string, memberEmail: string): Promise<void> {
  const admin = client();
  await admin.members.delete({ groupKey: groupEmail, memberKey: memberEmail });
}
