import type { Metadata } from "next";
import AlertsSection from "@/components/sections/AlertsSection";

export const metadata: Metadata = { title: "Генератор алертов" };

export default function AlertsPage() {
  return <AlertsSection />;
}
