"use client";

import { Bell } from "lucide-react";

export default function AlertsSection() {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-amber-50 flex items-center justify-center">
        <Bell className="w-8 h-8 text-amber-400" />
      </div>
      <div>
        <h2 className="text-lg font-semibold text-text-main mb-1">Генератор Алертов</h2>
        <p className="text-sm text-text-muted">Раздел в разработке</p>
      </div>
    </div>
  );
}
