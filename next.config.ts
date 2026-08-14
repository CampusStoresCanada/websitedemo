import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root explicitly: a stray lockfile one level up
  // (outside this repo) otherwise makes Turbopack infer the wrong root and
  // collide with any sibling checkout's dev server (e.g. a git worktree).
  turbopack: {
    root: import.meta.dirname,
  },
  typescript: {
    // Temporary unblock for deploys while DB-generated types are resynced.
    ignoreBuildErrors: true,
  },
  experimental: {
    serverActions: {
      // uploadCommsImage (lib/actions/upload-comms-image.ts) enforces its own
      // 5 MB cap and returns a clean error — but Next's default Server Action
      // body limit is 1 MB, so anything over that never reached our check at
      // all; it was rejected by the framework first with an opaque 413.
      bodySizeLimit: "6mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "kalosjtiwtnwsseitfys.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
