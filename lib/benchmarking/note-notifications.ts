import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCircleGhostClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";

/**
 * Butler tells people an approval is sitting waiting for them.
 *
 * Butler's contract is "we know" — facts about your situation. "There is an
 * explanation waiting on your answer" is a fact. Butler is not asking for the
 * store's consent in its own voice; it points at the page where the person
 * decides. The asking still happens on CSC's own surface, by a human's design.
 *
 * Every send is best-effort. A notification that fails must never roll back an
 * approval that succeeded — the record is the truth, the DM is a courtesy.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

async function emailsForUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const admin = createAdminClient();
  const results = await Promise.all(
    userIds.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id);
      return data?.user?.email ?? null;
    }),
  );
  return results.filter((e): e is string => Boolean(e));
}

/** Whoever currently leads benchmarking — normally the Secretary. */
async function committeeLeadEmails(): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("capability_contributions")
    .select("subject_id")
    .eq("capability", "benchmarking.committee_lead")
    .eq("is_active", true);
  return emailsForUserIds(
    Array.from(
      new Set(
        (data ?? [])
          .map((g) => g.subject_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  );
}

async function orgAdminEmails(organizationId: string): Promise<string[]> {
  const db = createAdminClient();
  const { data } = await db
    .from("user_organizations")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("role", "org_admin")
    .eq("status", "active");
  return emailsForUserIds((data ?? []).map((m) => m.user_id));
}

async function butlerDM(
  emails: string[],
  paragraphs: string[],
  linkLabel: string,
  linkHref: string,
): Promise<void> {
  if (emails.length === 0) return;
  if (!isCircleConfigured()) return;
  const client = getCircleGhostClient();
  if (!client) return;

  const content: unknown[] = paragraphs.map((text) => ({
    type: "paragraph",
    content: [{ type: "text", text }],
  }));
  content.push({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: linkLabel,
        marks: [{ type: "link", attrs: { href: linkHref, target: "_blank" } }],
      },
    ],
  });

  const fallback = `${paragraphs.join(" ")} ${linkHref}`;

  await Promise.all(
    emails.map(async (email) => {
      try {
        const result = await client.sendDirectMessageRich(
          email,
          content,
          fallback,
        );
        if (!result.success && !result.selfDm) {
          console.warn(
            "[note-notifications] DM failed for",
            email,
            result.error,
          );
        }
      } catch (err) {
        console.warn("[note-notifications] DM threw for", email, err);
      }
    }),
  );
}

/** A reviewer has written an explanation. The committee lead decides next. */
export async function notifyLeadOfPendingNote(input: {
  storeName: string;
  fieldLabel: string;
  authorName: string | null;
}): Promise<void> {
  const emails = await committeeLeadEmails();
  await butlerDM(
    emails,
    [
      `${input.authorName ?? "A reviewer"} has written an explanation for ${input.storeName}'s ${input.fieldLabel}.`,
      "It won't go to the store until you've had a look at it.",
    ],
    "Review it here",
    `${APP_URL}/benchmarking/admin/notes`,
  );
}

/** The lead said yes. Now the store decides whether it's happy to be described. */
export async function notifyStoreOfPendingNote(input: {
  organizationId: string;
  fieldLabel: string;
}): Promise<void> {
  const emails = await orgAdminEmails(input.organizationId);
  await butlerDM(
    emails,
    [
      `Someone has written an explanation of your ${input.fieldLabel} figure for this year's benchmarking.`,
      "Nothing is shared with other stores unless you say you're happy with it.",
    ],
    "Read it and decide",
    `${APP_URL}/benchmarking/survey`,
  );
}

/** Close the loop for whoever wrote it. */
export async function notifyAuthorOfOutcome(input: {
  authorId: string;
  storeName: string;
  fieldLabel: string;
  outcome: "published" | "private";
}): Promise<void> {
  const emails = await emailsForUserIds([input.authorId]);
  const line =
    input.outcome === "published"
      ? `Your explanation of ${input.storeName}'s ${input.fieldLabel} is now visible to participating members.`
      : `Your explanation of ${input.storeName}'s ${input.fieldLabel} is staying private.`;
  await butlerDM(
    emails,
    [line],
    "See it",
    `${APP_URL}/benchmarking/admin/notes`,
  );
}
