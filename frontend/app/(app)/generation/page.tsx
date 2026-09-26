import type { Metadata } from "next";
import GenerationSection from "@/components/sections/GenerationSection";

export const metadata: Metadata = { title: "Ручное тестирование" };

export default function GenerationPage() {
  return <GenerationSection />;
}
