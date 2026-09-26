import type { Metadata } from "next";
import MetricsSection from "@/components/sections/MetricsSection";

export const metadata: Metadata = { title: "Метрики ОД" };

export default function MetricsPage() {
  return <MetricsSection />;
}
