import type { Metadata } from "next";
import JobsSection from "@/components/sections/JobsSection";

export const metadata: Metadata = { title: "Jobs" };

export default function JobsPage() {
  return <JobsSection />;
}
