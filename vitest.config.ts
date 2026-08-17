import { defineConfig, configDefaults } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      // tsconfig maps "@/*" -> "./*". Vitest doesn't read tsconfig paths, so
      // without this any suite that transitively imports through "@/" dies with
      // "Cannot find package '@/...'" — which is why conference-checkout and
      // webhook-processing were failing while everything else passed.
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    exclude: [
      ...configDefaults.exclude,
      "**/.next/**",
      // Agent worktrees under .claude/worktrees are full checkouts of this same
      // repo. Without this, every suite in an active worktree runs a second time
      // and its failures show up as duplicates of the real ones.
      "**/.claude/worktrees/**",
    ],
  },
});
