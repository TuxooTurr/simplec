import type { Metadata } from "next";
import { Suspense } from "react";
import EventGeneratorsSection from "@/components/sections/EventGeneratorsSection";

export const metadata: Metadata = { title: "Генераторы событий" };

// Suspense обязателен: раздел читает ?open= из адреса (useSearchParams),
// без границы Next не соберёт страницу статически.
export default function EventGeneratorsPage() {
  return (
    <Suspense>
      <EventGeneratorsSection syncUrl />
    </Suspense>
  );
}
