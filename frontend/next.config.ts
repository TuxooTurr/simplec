import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // В dev: проксируем /api/* на FastAPI :8000
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:8000/api/:path*",
      },
    ];
  },
};

export default nextConfig;
