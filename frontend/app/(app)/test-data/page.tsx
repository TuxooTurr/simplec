import type { Metadata } from "next";
import TestDataSection from "@/components/sections/TestDataSection";

export const metadata: Metadata = { title: "Тестовые данные" };

export default function TestDataPage() {
  return <TestDataSection />;
}
