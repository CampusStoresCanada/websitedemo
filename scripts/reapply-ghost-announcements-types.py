#!/usr/bin/env python3
"""Re-apply the board-recap patch to lib/database.types.ts.

Mirrors supabase/migrations/20260827193500_ghost_announcements_board_recap.sql.
Idempotent: exits cleanly if the patch is already present. Run from
/Users/Work/Documents/csc-website/websitedemo after any restore of that file.
"""
p = "lib/database.types.ts"
s = open(p).read()
start = s.index("      ghost_announcements: {")
end = s.index("        Relationships: [", start)
block = s[start:end]

if "source_block" in block:
    print("already applied — nothing to do")
    raise SystemExit(0)

block = block.replace("          organization_id: string\n",
                      "          meeting_id: string | null\n          organization_id: string | null\n", 1)
block = block.replace("          organization_id: string\n",
                      "          meeting_id?: string | null\n          organization_id?: string | null\n", 1)
block = block.replace("          organization_id?: string\n",
                      "          meeting_id?: string | null\n          organization_id?: string | null\n", 1)
block = block.replace("          skip_reason: string | null\n",
                      "          skip_reason: string | null\n          source_block: string | null\n", 1)
block = block.replace("          skip_reason?: string | null\n",
                      "          skip_reason?: string | null\n          source_block?: string | null\n")

open(p, "w").write(s[:start] + block + s[end:])
print("re-applied ghost_announcements board-recap columns")
