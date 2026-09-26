import type { Metadata } from "next";
import KafkaSection from "@/components/sections/KafkaSection";

export const metadata: Metadata = { title: "Просмотр Kafka" };

export default function KafkaPage() {
  return <KafkaSection />;
}
