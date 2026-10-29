import type { Metadata } from "next";
import AqaTrackingSection from "@/components/sections/AqaTrackingSection";

export const metadata: Metadata = { title: "Трекинг AQA" };

export default function AqaPage() {
  return <AqaTrackingSection />;
}
