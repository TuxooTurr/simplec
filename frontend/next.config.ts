import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  // Прокси dev-режима ждёт ответ дольше 30 с по умолчанию: первый запуск сценария
  // веб-коннектора поднимает браузер (10–25 с), а первая загрузка модели Zephyr (~4000 кейсов
  // с медленного стенда) — до нескольких минут. Не дождался — отдаёт «Internal Server Error».
  //
  // Тело запроса через прокси dev-режима по умолчанию режется на 10 МБ — бэкенд получает обрывок, ответ —
  // «Internal Server Error». «Новая модель из XML» отправляет файл до 50 МБ (backend MAX_XML); резервная копия
  // с рисунками «Данных» (base64) и векторами эталонов бывает больше — с запасом и на неё.
  experimental: { proxyTimeout: 300_000, proxyClientMaxBodySize: "512mb" },

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
