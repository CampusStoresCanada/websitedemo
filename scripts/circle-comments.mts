/**
 * Every comment in the community, in ~31 requests instead of 778.
 *
 * ⛔ `GET /comments` takes `post_id` as a QUERY param, not a path segment — omit
 * it and the endpoint pages the whole community. The per-post walk this replaces
 * made one request per post AND dropped every author, because a comment carries
 * its author nested as `user.id` while a post carries a flat `user_id`. That one
 * field-shape difference left 0 of 2,850 comments attributed while 88% of posts
 * were fine.
 *
 * The bulk records also carry three things the per-post walk never had:
 * `created_at` (so comments can decay — posts in the old cache have no date at
 * all), `parent_comment_id` (who answers WHOM, not just who was present), and
 * `likes_count`.
 *
 *   npx tsx scripts/circle-comments.mts          # incremental — stops at what we hold
 *   npx tsx scripts/circle-comments.mts --all    # re-pull everything
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { postBodyText } from "@/lib/signals/circle-backfill";

const BASE = "https://app.circle.so/api/admin/v2";
const KEY = process.env.CIRCLE_API_KEY;
const CACHE = ".cache/circle-comments.json";
const ALL = process.argv.includes("--all");
const PER_PAGE = 100;
/** Courtesy gap between pages. This is someone else's service. */
const THROTTLE_MS = 400;

if (!KEY) { console.error("CIRCLE_API_KEY not set"); process.exit(1); }

export interface StoredComment {
  id: number;
  body: string;
  userId: number | null;
  userName: string | null;
  postId: number | null;
  postName: string | null;
  spaceName: string | null;
  createdAt: string | null;
  likes: number;
  parentId: number | null;
}

const held = new Map<number, StoredComment>();
if (!ALL && existsSync(CACHE)) {
  for (const c of JSON.parse(readFileSync(CACHE, "utf8")) as StoredComment[]) held.set(c.id, c);
  console.log(`${held.size} comments already held`);
}

// ⛔ A comment's body is NESTED (`{ body: "<p>…</p>" }`), exactly like a post's.
// `String(r.body)` yields "[object Object]" — 15 characters, non-empty, and it
// sails through every length check. All 3,015 bodies came back identical before
// this was caught. `postBodyText` already knows both shapes; do not write a
// third version of it.

let page = 1, fetched = 0, fresh = 0, pages = "?";
for (;;) {
  const url = `${BASE}/comments?per_page=${PER_PAGE}&page=${page}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}` } });

  if (res.status === 429) {
    const wait = Number(res.headers.get("retry-after") ?? 5) * 1000;
    console.log(`\n  rate limited, waiting ${wait / 1000}s`);
    await new Promise((r) => setTimeout(r, wait));
    continue;
  }
  if (!res.ok) { console.error(`\ncircle ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }

  const body = (await res.json()) as {
    records?: Record<string, unknown>[]; has_next_page?: boolean; page_count?: number; count?: number;
  };
  const records = body.records ?? [];
  pages = String(body.page_count ?? "?");

  let newThisPage = 0;
  for (const r of records) {
    const id = Number(r.id);
    fetched++;
    if (held.has(id)) continue;
    newThisPage++;
    const user = r.user as { id?: number; name?: string } | undefined;
    const post = r.post as { id?: number; name?: string } | undefined;
    const space = r.space as { name?: string } | undefined;
    held.set(id, {
      id,
      body: postBodyText(r.body as Parameters<typeof postBodyText>[0]),
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      postId: post?.id ?? null,
      postName: post?.name ?? null,
      spaceName: space?.name ?? null,
      createdAt: (r.created_at as string) ?? null,
      likes: Number(r.likes_count ?? 0),
      parentId: (r.parent_comment_id as number | null) ?? null,
    });
  }
  fresh += newThisPage;
  process.stdout.write(`\r  page ${page}/${pages} · seen ${fetched} · new ${fresh}   `);

  // Incremental: the feed is newest-first, so a page with nothing new means we
  // have caught up. Never on --all, which is a deliberate full re-pull.
  if (!ALL && newThisPage === 0 && held.size > records.length) {
    console.log(`\n  caught up at page ${page}`);
    break;
  }
  if (!body.has_next_page) break;
  page++;
  await new Promise((r) => setTimeout(r, THROTTLE_MS));
}

const out = [...held.values()];
mkdirSync(".cache", { recursive: true });
writeFileSync(CACHE, JSON.stringify(out));

const attributed = out.filter((c) => c.userId != null).length;
const dated = out.filter((c) => c.createdAt).length;
const replies = out.filter((c) => c.parentId != null).length;
console.log(`\n\ncomments held        ${out.length}   (+${fresh} this run, ${page} requests)`);
console.log(`carry an author      ${attributed} (${(attributed / out.length * 100).toFixed(0)}%)`);
console.log(`carry a timestamp    ${dated} (${(dated / out.length * 100).toFixed(0)}%)`);
console.log(`are replies-to-replies ${replies}`);
console.log(`distinct authors     ${new Set(out.map((c) => c.userId).filter(Boolean)).size}`);
console.log(`distinct threads     ${new Set(out.map((c) => c.postId).filter(Boolean)).size}`);
console.log(`cached → ${CACHE}`);
