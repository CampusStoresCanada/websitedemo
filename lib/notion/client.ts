/**
 * Minimal Notion REST helper.
 *
 * Deliberately not a general Notion SDK — this covers the board-transcript
 * pages and nothing else. The previous Notion integration (the inbound contact
 * sync) lived in a separate project and was retired in August 2026; this is a
 * fresh, narrow surface rather than a revival of it.
 *
 * ⚠️ API VERSION MATTERS. Two things changed in the 2026 versions and both
 * fail confusingly against an older header:
 *   - Pages are created under a DATA SOURCE, not a database:
 *     `parent: { type: "data_source_id", data_source_id }`. The database id is
 *     the data source's parent and is NOT accepted here.
 *   - Trashing a page is `{ in_trash: true }`. The older `{ archived: true }`
 *     returns a 400, so a cleanup path written from memory silently leaves the
 *     page behind. Verified both, the hard way, 2026-08-28.
 */

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2026-03-11";

export interface NotionPageRef {
  id: string;
  url: string;
}

function headers(): Record<string, string> | null {
  const key = process.env.NOTION_API_KEY;
  if (!key) return null;
  return {
    Authorization: `Bearer ${key}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

export function isNotionConfigured(): boolean {
  return Boolean(process.env.NOTION_API_KEY);
}

async function request<T>(
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const h = headers();
  if (!h) return { ok: false, error: "NOTION_API_KEY is not configured." };

  try {
    const res = await fetch(`${NOTION_API}${path}`, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON body — surfaced verbatim below */
    }

    if (!res.ok) {
      const e = json as { code?: string; message?: string } | null;
      // Notion's message names the actual problem ("Make sure the relevant
      // pages and databases are shared with your integration"), so pass it
      // through rather than flattening it to the status code.
      return { ok: false, error: `${res.status} ${e?.code ?? ""}: ${e?.message ?? text.slice(0, 300)}` };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Notion request failed" };
  }
}

/**
 * Create a row in a data source.
 *
 * `date` is a bare calendar date (`YYYY-MM-DD`) and is passed through
 * untouched — no Date object, no timezone conversion. A board meeting on the
 * 24th is on the 24th regardless of where the server is, and routing it
 * through a Date is how it becomes the 23rd on Vercel.
 */
export async function createDataSourceRow(params: {
  dataSourceId: string;
  title: string;
  date?: string | null;
}): Promise<{ ok: true; page: NotionPageRef } | { ok: false; error: string }> {
  const properties: Record<string, unknown> = {
    Name: { title: [{ text: { content: params.title } }] },
  };
  if (params.date) properties.Date = { date: { start: params.date } };

  const result = await request<{ id: string; url: string }>("POST", "/pages", {
    parent: { type: "data_source_id", data_source_id: params.dataSourceId },
    properties,
  });

  if (!result.ok) return result;
  return { ok: true, page: { id: result.data.id, url: result.data.url } };
}

export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  [key: string]: unknown;
}

/**
 * All children of a block or page, following pagination.
 *
 * `max` is a hard stop rather than a guess at "enough" — a board transcript is
 * thousands of blocks and a runaway loop against a paid API is worse than a
 * truncated read we can detect and report.
 */
export async function listBlockChildren(
  blockId: string,
  max = 2000
): Promise<{ ok: true; blocks: NotionBlock[]; truncated: boolean } | { ok: false; error: string }> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;

  do {
    const qs = new URLSearchParams({ page_size: "100" });
    if (cursor) qs.set("start_cursor", cursor);

    const result = await request<{ results: NotionBlock[]; has_more: boolean; next_cursor: string | null }>(
      "GET",
      `/blocks/${blockId}/children?${qs.toString()}`
    );
    if (!result.ok) return result;

    blocks.push(...(result.data.results ?? []));
    cursor = result.data.has_more ? result.data.next_cursor ?? undefined : undefined;

    if (blocks.length >= max) return { ok: true, blocks: blocks.slice(0, max), truncated: true };
  } while (cursor);

  return { ok: true, blocks, truncated: false };
}

/** Move a page to the trash. The compensating action when a write-back fails. */
export async function trashPage(pageId: string): Promise<{ ok: boolean; error?: string }> {
  const result = await request("PATCH", `/pages/${pageId}`, { in_trash: true });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}
