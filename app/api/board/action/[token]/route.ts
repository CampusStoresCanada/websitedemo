/**
 * Board action item magic-complete endpoint (no auth — the token is the key).
 *
 *   GET  — renders a confirmation page. Never mutates.
 *   POST — performs the completion.
 *
 * The split matters: mail security scanners and link prefetchers (Exchange
 * Safe Links among them) follow GET links in email before a human ever sees
 * them. When GET was the mutation, a scanner could silently close a board
 * action item on the assignee's behalf. Requiring the POST from a real button
 * press defeats that without putting a login in front of a one-click link.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { getCircleGhostClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";

export const dynamic = "force-dynamic";

type ActionItemRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  assignees: string[] | null;
};

/** Item text is admin-authored, but it still ends up inside an HTML document. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadItem(token: string): Promise<ActionItemRow | null> {
  const db = createAdminClient();
  const { data, error } = await db
    .from("board_action_items")
    .select("id, title, description, status, assignees")
    .eq("complete_token", token)
    .maybeSingle();
  return error || !data ? null : (data as ActionItemRow);
}

function invalidResponse() {
  return new NextResponse(
    htmlPage({
      heading: "Invalid link",
      body: "This link is invalid or has expired.",
      success: false,
    }),
    { status: 404, headers: { "Content-Type": "text/html" } }
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const item = await loadItem(token);
  if (!item) return invalidResponse();

  // The item's own name — not its description, which is frequently blank and
  // used to render as an empty pair of quotation marks.
  const label = escapeHtml(item.title);

  if (item.status === "complete") {
    return new NextResponse(
      htmlPage({
        heading: "Already marked complete ✓",
        body: `“${label}” was already marked complete. No changes made.`,
        success: true,
        redirect: true,
      }),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  return new NextResponse(
    htmlPage({
      heading: "Mark this complete?",
      body: `“${label}”`,
      success: true,
      confirmToken: token,
    }),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const item = await loadItem(token);
  if (!item) return invalidResponse();

  const label = escapeHtml(item.title);

  if (item.status === "complete") {
    return new NextResponse(
      htmlPage({
        heading: "Already marked complete ✓",
        body: `“${label}” was already marked complete. No changes made.`,
        success: true,
        redirect: true,
      }),
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  }

  const db = createAdminClient();
  await db.from("board_action_items").update({ status: "complete" }).eq("id", item.id);

  // Tell the assignees it's done. Deliberately a neutral statement of fact
  // rather than "Thanks" — the token is anonymous, so we don't know which of
  // several co-assignees actually did the work, and thanking all of them for
  // one person's work reads badly.
  if (isCircleConfigured()) {
    const ghost = getCircleGhostClient();
    const assignees = item.assignees ?? [];
    if (ghost && assignees.length > 0) {
      const emailMap = await lookupUserEmailsByIds(db, assignees);
      const emails = Object.values(emailMap).filter(Boolean);
      await Promise.allSettled(
        emails.map((email) =>
          ghost.sendDirectMessage(email, `“${item.title}” was marked complete. 👻`)
        )
      );
    }
  }

  return new NextResponse(
    htmlPage({
      heading: "Action item marked complete ✓",
      body: `“${label}” has been marked as complete. Thank you!`,
      success: true,
      redirect: true,
    }),
    { status: 200, headers: { "Content-Type": "text/html" } }
  );
}

function htmlPage({
  heading,
  body,
  success,
  redirect = false,
  confirmToken,
}: {
  heading: string;
  body: string;
  success: boolean;
  redirect?: boolean;
  confirmToken?: string;
}) {
  const colour = success ? "#163D6D" : "#b91c1c";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${heading} — Campus Stores Canada</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, sans-serif;
      background: #f0f4f8;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
    }
    .card {
      background: white;
      border-radius: 16px;
      padding: 2.5rem 2rem;
      max-width: 420px;
      width: 100%;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      text-align: center;
    }
    .ghost {
      width: 140px;
      height: 140px;
      object-fit: contain;
      margin-bottom: 1.25rem;
      animation: float 2s ease-in-out infinite;
    }
    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50%       { transform: translateY(-10px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .ghost { animation: none; }
      .bar-fill { animation: none; width: 100%; }
    }
    h1 { font-size: 1.25rem; color: ${colour}; margin-bottom: 0.6rem; font-weight: 700; }
    p  { color: #6b7280; font-size: 0.9rem; line-height: 1.6; }
    .sub { margin-top: 1.5rem; font-size: 0.75rem; color: #9ca3af; }
    button {
      margin-top: 1.5rem;
      width: 100%;
      border: none;
      border-radius: 10px;
      background: #163D6D;
      color: white;
      font-size: 0.95rem;
      font-weight: 600;
      padding: 0.8rem 1rem;
      cursor: pointer;
      font-family: inherit;
    }
    button:hover { background: #12325a; }
    button:focus-visible { outline: 3px solid #7ea8dc; outline-offset: 2px; }
    .bar {
      margin-top: 1.5rem;
      height: 3px;
      background: #e5e7eb;
      border-radius: 99px;
      overflow: hidden;
    }
    .bar-fill {
      height: 100%;
      width: 0%;
      background: #163D6D;
      border-radius: 99px;
      animation: fill 3s linear forwards;
    }
    @keyframes fill { to { width: 100%; } }
  </style>
</head>
<body>
  <div class="card">
    <img src="/Butler.png" alt="" class="ghost" />
    <h1>${heading}</h1>
    <p>${body}</p>
    ${
      confirmToken
        ? `<form method="POST" action="/api/board/action/${encodeURIComponent(confirmToken)}">
      <button type="submit">Mark complete</button>
    </form>`
        : ""
    }
    ${
      redirect
        ? `<div class="bar"><div class="bar-fill"></div></div>
    <p class="sub">Heading home in a moment…</p>
    <script>setTimeout(function () { window.location.href = "/"; }, 3000);</script>`
        : ""
    }
  </div>
</body>
</html>`;
}
