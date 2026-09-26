import type { Metadata } from "next";
import SettingsSection from "@/components/sections/SettingsSection";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() {
  return <SettingsSection />;
}
