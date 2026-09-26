import type { Metadata } from "next";
import EventGeneratorsSection from "@/components/sections/EventGeneratorsSection";

export const metadata: Metadata = { title: "Генераторы событий" };

export default function EventGeneratorsPage() {
  return <EventGeneratorsSection />;
}
