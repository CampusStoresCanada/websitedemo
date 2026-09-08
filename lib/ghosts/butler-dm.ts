/**
 * Butler Ghost's direct messages.
 *
 * Shared by every Butler report so there is one implementation of the thing
 * that is easy to get wrong: **DMs are attributed to the API KEY OWNER**, not
 * to `user_email` the way posts are. `getCircleGhostClient()` is what makes a
 * message come from Butler rather than the super admin, and a caller that
 * reaches for the ordinary client silently sends as the wrong person.
 */

export const REVIEW_URL = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://campusstores.ca"}/admin/board/recaps`;

export type DmNode = Record<string, unknown>;

export const dmText = (text: string, bold = false): DmNode =>
  bold ? { type: "text", text, marks: [{ type: "bold" }] } : { type: "text", text };

export const dmLink = (label: string, href: string): DmNode => ({
  type: "text",
  text: label,
  marks: [{ type: "link", attrs: { href, target: "_blank" } }],
});

export const dmPara = (...content: DmNode[]): DmNode => ({ type: "paragraph", content });

/**
 * Try Butler's DM. Returns false on any failure so the caller can fall back
 * rather than assume the person was told.
 */
export async function butlerDm(
  recipientEmail: string | null | undefined,
  content: DmNode[],
  fallbackText: string
): Promise<boolean> {
  if (!recipientEmail) return false;
  try {
    const { getCircleGhostClient } = await import("@/lib/circle/client");
    const ghost = getCircleGhostClient();
    if (!ghost) return false;
    const result = await ghost.sendDirectMessageRich(recipientEmail, content, fallbackText);
    if (!result.success) {
      console.warn("[butler-dm] failed", recipientEmail, result.error ?? (result.selfDm ? "self-DM" : ""));
    }
    return result.success;
  } catch (err) {
    console.error("[butler-dm] threw", err);
    return false;
  }
}
