import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pgvitals/db"],
  async rewrites() {
    return [
      {
        source: "/collector-api/:path*",
        destination: `${process.env.COLLECTOR_INTERNAL_URL || "http://localhost:3001"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
