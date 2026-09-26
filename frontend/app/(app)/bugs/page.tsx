import type { Metadata } from "next";
import BugsSection from "@/components/sections/BugsSection";

export const metadata: Metadata = { title: "Дефекты" };

export default function BugsPage() {
  return <BugsSection />;
}
