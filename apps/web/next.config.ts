import type { NextConfig } from "next";

// The browser only talks to this Next.js app; /api/* is proxied to the Express API.
// Secrets (Anthropic, Hedera) live only in the API process.
const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  transpilePackages: ["@eljoker/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default nextConfig;
