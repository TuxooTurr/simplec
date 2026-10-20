import type { Metadata } from "next";
import StandScheduleSection from "@/components/sections/StandScheduleSection";

export const metadata: Metadata = { title: "График стендов" };

export default function StandsPage() {
  return <StandScheduleSection />;
}
