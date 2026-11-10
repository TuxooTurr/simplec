"use client";

import {
  BellRing, CircleDot, Database, File, FileX, HelpCircle, Layers, MessageCircleQuestion, Network, Repeat, Server,
  ShieldAlert, Siren, TrendingUp, UserRound, Zap, type LucideIcon,
} from "lucide-react";

/** Иконки сценариев по имени из каталога (backend/api/incident_catalog.py, поле icon). Неизвестное имя — молния. */
const ICONS: Record<string, LucideIcon> = {
  "layers": Layers, "file-x": FileX, "circle-dot": CircleDot, "file": File, "repeat": Repeat, "server": Server,
  "network": Network, "help-circle": HelpCircle, "siren": Siren, "database": Database, "user-round": UserRound,
  "message-circle-question": MessageCircleQuestion, "bell-ring": BellRing, "trending-up": TrendingUp,
  "shield-alert": ShieldAlert,
};

/** Квадрат 32×32 с иконкой 16×16 — один размер у всех сценариев, не растягивается и не сжимается. */
export default function ScenarioIcon({ name, active = false }: { name: string; active?: boolean }) {
  const Icon = ICONS[name] ?? Zap;
  return (
    <span aria-hidden className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg
      ${active ? "bg-primary text-white" : "bg-primary/10 text-primary"}`}>
      <Icon className="h-4 w-4" strokeWidth={2} />
    </span>
  );
}
