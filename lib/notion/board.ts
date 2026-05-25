/**
 * Notion API helpers for Board Portal meeting pages.
 *
 * Uses the Notion public API (v1) with an internal integration token.
 * Env var: NOTION_TOKEN — the "Internal Integration Secret" from notion.so/my-integrations
 *
 * All board meeting pages are created under:
 * NOTION_BOARD_PARENT_PAGE_ID — the "📋 Board Meetings" parent page ID
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function getConfig() {
  const token    = process.env.NOTION_API_KEY;
  const parentId = process.env.NOTION_BOARD_PARENT_PAGE_ID;

  if (!token)    throw new Error("NOTION_API_KEY is not set");
  if (!parentId) throw new Error("NOTION_BOARD_PARENT_PAGE_ID is not set");

  return { token, parentId };
}

async function notionRequest<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown
): Promise<T> {
  const { token } = getConfig();

  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: {
      Authorization:    `Bearer ${token}`,
      "Content-Type":   "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API ${method} ${path} failed (${res.status}): ${text}`);
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────
// Meeting page creation
// ─────────────────────────────────────────────────────────────────

interface NotionPage {
  id:  string;
  url: string;
}

/**
 * Creates a new Notion page under the Board Meetings parent for a given meeting.
 * Returns the page ID and URL to store on the board_meetings record.
 *
 * @param meetingDate  YYYY-MM-DD
 * @param meetingType  "regular" | "agm" | "special"
 * @param title        Optional custom title override
 */
export async function createBoardMeetingPage(
  meetingDate: string,
  meetingType: string,
  title?: string
): Promise<NotionPage> {
  const { parentId } = getConfig();

  const typeLabel =
    meetingType === "agm"     ? "AGM" :
    meetingType === "special" ? "Special Meeting" :
    "Board Meeting";

  const pageTitle = title ?? `CSC ${typeLabel} — ${meetingDate}`;

  const body = {
    parent: { page_id: parentId },
    icon:   { type: "emoji", emoji: "📋" },
    properties: {
      title: {
        title: [{ type: "text", text: { content: pageTitle } }],
      },
    },
    children: [
      {
        object: "block",
        type:   "callout",
        callout: {
          rich_text: [
            {
              type: "text",
              text: {
                content:
                  "This page is the live scratchpad for this board meeting. " +
                  "Run /meet in Notion when the meeting begins to start transcription. " +
                  "Formal agenda and minutes are managed in the Board Portal.",
              },
            },
          ],
          icon:  { type: "emoji", emoji: "💡" },
          color: "blue_background",
        },
      },
      {
        object: "block",
        type:   "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: "Notes" } }],
        },
      },
      {
        object: "block",
        type:   "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: "" } }],
        },
      },
    ],
  };

  const page = await notionRequest<{ id: string; url: string }>("POST", "/pages", body);

  return { id: page.id, url: page.url };
}

/**
 * Returns the public URL for a Notion page (with share link format).
 * If the page was created with an integration, it will be accessible
 * to anyone the integration shares it with.
 */
export function getNotionPageUrl(pageId: string): string {
  // Strip dashes for the URL format Notion uses
  const clean = pageId.replace(/-/g, "");
  return `https://www.notion.so/${clean}`;
}
