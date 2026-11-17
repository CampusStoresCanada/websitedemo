import { afterEach, describe, expect, it, vi } from "vitest";
import { CircleAdminClient } from "@/lib/circle/client";

// Someone who never accepted their community invite is in a space with status
// "inactive". The conference reconciler diffs pass holders against this roster,
// so a roster of only the active members re-adds those people forever and
// Circle answers 422 each time.

function page(records: { community_member_id: number }[], hasNext: boolean) {
  return new Response(JSON.stringify({ records, has_next_page: hasNext }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("listSpaceMemberIds", () => {
  it("asks Circle for members of every status, not only the active ones", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      page([{ community_member_id: 1 }], false)
    );
    vi.stubGlobal("fetch", fetchMock);

    await new CircleAdminClient("key", "228117").listSpaceMemberIds(2922289);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname.endsWith("/space_members")).toBe(true);
    expect(url.searchParams.get("space_id")).toBe("2922289");
    expect(url.searchParams.get("status")).toBe("all");
  });

  it("reads every page", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([{ community_member_id: 1 }, { community_member_id: 2 }], true))
      .mockResolvedValueOnce(page([{ community_member_id: 3 }], false));
    vi.stubGlobal("fetch", fetchMock);

    const ids = await new CircleAdminClient("key", "228117").listSpaceMemberIds(7);

    expect(ids).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
