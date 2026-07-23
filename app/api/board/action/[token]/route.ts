/**
 * GET /api/board/action/[token]
 *
 * Public (no auth) magic-complete endpoint.
 * Validates the token, marks the action item complete, renders a confirmation.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { lookupUserEmailsByIds } from "@/lib/supabase/user-lookup";
import { getCircleGhostClient } from "@/lib/circle/client";
import { isCircleConfigured } from "@/lib/circle/config";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const db = createAdminClient();

  const { data: item, error } = await db
    .from("board_action_items")
    .select("id, title, description, status, due_date, meeting_id, assignees")
    .eq("complete_token", token)
    .maybeSingle();

  if (error || !item) {
    return new NextResponse(htmlPage("Invalid link", "This link is invalid or has expired.", false), {
      status: 404,
      headers: { "Content-Type": "text/html" },
    });
  }

  const alreadyDone = item.status === "complete";

  if (!alreadyDone) {
    await db
      .from("board_action_items")
      .update({ status: "complete" })
      .eq("id", item.id);

    // Butler Ghost says thanks 👻
    if (isCircleConfigured()) {
      const ghost    = getCircleGhostClient();
      const assignees = (item.assignees ?? []) as string[];
      if (ghost && assignees.length > 0) {
        const emailMap = await lookupUserEmailsByIds(db, assignees);
        const emails = Object.values(emailMap);

        await Promise.allSettled(
          emails.map((email) => ghost.sendDirectMessage(email, `Thanks 👻`))
        );
      }
    }
  }

  const heading = alreadyDone
    ? "Already marked complete ✓"
    : "Action item marked complete ✓";

  const body = alreadyDone
    ? `"${item.description}" was already marked complete. No changes made.`
    : `"${item.description}" has been marked as complete. Thank you!`;

  return new NextResponse(htmlPage(heading, body, true), {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function htmlPage(heading: string, body: string, success: boolean) {
  const colour   = success ? "#163D6D" : "#b91c1c";
  const redirect = success ? `<meta http-equiv="refresh" content="3;url=/" />` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${redirect}
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
    h1 { font-size: 1.25rem; color: ${colour}; margin-bottom: 0.6rem; font-weight: 700; }
    p  { color: #6b7280; font-size: 0.9rem; line-height: 1.6; }
    .sub { margin-top: 1.5rem; font-size: 0.75rem; color: #9ca3af; }
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
    <img src="/Butler.png" alt="Butler Ghost" class="ghost" />
    <h1>${heading}</h1>
    <p>${body}</p>
    ${success ? `
    <div class="bar"><div class="bar-fill"></div></div>
    <p class="sub">Heading home in a moment…</p>
    <script>setTimeout(() => window.location.href = "/", 3000);</script>
    ` : ""}
  </div>
</body>
</html>`;
}
