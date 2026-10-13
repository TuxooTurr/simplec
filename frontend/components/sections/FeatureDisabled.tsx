"use client";

import { PauseCircle } from "lucide-react";

/** Заглушка временно отключённого раздела (см. lib/features.ts): прямой адрес не ведёт в пустоту. */
export default function FeatureDisabled({ title, text }: { title: string; text: string }) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
      <PauseCircle className="w-9 h-9 text-text-muted" />
      <h1 className="text-lg font-semibold text-text-main">{title}</h1>
      <p className="max-w-md text-sm text-text-muted">{text}</p>
    </div>
  );
}
