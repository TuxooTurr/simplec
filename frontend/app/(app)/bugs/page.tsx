import type { Metadata } from "next";
import JiraToolSection from "@/components/sections/JiraToolSection";

export const metadata: Metadata = { title: "Jira tool" };

export default function BugsPage() {
  return <JiraToolSection />;
}
