import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Прокси dev-режима ждёт ответ дольше 30 с по умолчанию: первый запуск сценария
  // веб-коннектора поднимает браузер, и на занятой машине это 10–25 с.
  experimental: { proxyTimeout: 120_000 },

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
