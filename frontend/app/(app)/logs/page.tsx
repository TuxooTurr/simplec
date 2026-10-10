import type { Metadata } from "next";
import LogAnalyzerSection from "@/components/sections/LogAnalyzerSection";

// Новый анализатор логов: имя сервиса → ошибки за N минут через сценарий веб-коннектора.
// Прежний раздел (LogsSection, VPS-подключения) сохранён в коде, но не используется.
export const metadata: Metadata = { title: "Логи" };

export default function LogsPage() {
  return <LogAnalyzerSection />;
}
