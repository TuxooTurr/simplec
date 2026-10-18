import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Прокси dev-режима ждёт ответ дольше 30 с по умолчанию: первый запуск сценария
  // веб-коннектора поднимает браузер (10–25 с), а первая загрузка модели Zephyr (~4000 кейсов
  // с медленного стенда) — до нескольких минут. Не дождался — отдаёт «Internal Server Error».
  experimental: { proxyTimeout: 300_000 },

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
