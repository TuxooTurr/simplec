import type { Metadata } from "next";
import LogsSection from "@/components/sections/LogsSection";

export const metadata: Metadata = { title: "Логи" };

export default function LogsPage() {
  return <LogsSection />;
}
