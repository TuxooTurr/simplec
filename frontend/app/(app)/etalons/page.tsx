import type { Metadata } from "next";
import EtalonsSection from "@/components/sections/EtalonsSection";

export const metadata: Metadata = { title: "Данные" };

export default function EtalonsPage() {
  return <EtalonsSection />;
}
