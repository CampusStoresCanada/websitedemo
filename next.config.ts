import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    // Temporary unblock for deploys while DB-generated types are resynced.
    ignoreBuildErrors: true,
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
