import type { Metadata } from "next";
import ModelBenchSection from "@/components/sections/ModelBenchSection";

export const metadata: Metadata = { title: "Тестирование моделей LLM" };

export default function ModelBenchPage() {
  return <ModelBenchSection />;
}
