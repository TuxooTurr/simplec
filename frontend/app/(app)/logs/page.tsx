import type { Metadata } from "next";
import LogAnalyzerSection from "@/components/sections/LogAnalyzerSection";
import FeatureDisabled from "@/components/sections/FeatureDisabled";
import { WEB_CONNECTORS_ENABLED } from "@/lib/features";

// Новый анализатор логов: имя сервиса → ошибки за N минут через сценарий веб-коннектора.
// Прежний раздел (LogsSection, VPS-подключения) сохранён в коде, но не используется.
export const metadata: Metadata = { title: "Логи" };

export default function LogsPage() {
  if (!WEB_CONNECTORS_ENABLED) {
    return <FeatureDisabled title="Логи временно отключены"
      text="Анализатор логов работает через веб-коннекторы, а они пока выключены. Код сохранён — раздел вернётся вместе с коннекторами." />;
  }
  return <LogAnalyzerSection />;
}
