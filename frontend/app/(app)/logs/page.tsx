import type { Metadata } from "next";
import LogAnalyzerSection from "@/components/sections/LogAnalyzerSection";

export const metadata: Metadata = { title: "Логи" };

export default function LogsPage() {
  return <LogAnalyzerSection />;
}
