import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pgvitals/db"],
};

export default nextConfig;
