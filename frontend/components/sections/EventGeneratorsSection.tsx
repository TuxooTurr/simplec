"use client";

import { useState } from "react";
import { BarChart2, ChevronLeft, Database, Users, Zap } from "lucide-react";
import type { ComponentType } from "react";

import MetricsSection from "./MetricsSection";

/* ── Реестр генераторов ───────────────────────────────────────────────────
   Раздел — общий вход: плашки сверху, переход внутрь раскрывает интерфейс
   конкретного генератора. Новый генератор добавляется одной записью здесь,
   трогать разметку не нужно. */

type Generator = {
  id:          string;
  title:       string;
  subtitle:    string;
  Icon:        ComponentType<{ className?: string; strokeWidth?: number }>;
  accent:      string;                 // цвет плашки
  /** Компонент интерфейса. Пусто — генератор ещё не реализован. */
  Component?:  ComponentType;
  /** Текст на плашке, пока генератор в работе. */
  soon?:       string;
};

const GENERATORS: Generator[] = [
  {
    id: "metrics",
    title: "Метрики ОД",
    subtitle: "Системы, метрики и пороги здоровья · отправка в Kafka по расписанию",
    Icon: BarChart2,
    accent: "from-indigo-500 to-violet-500",
    Component: MetricsSection,
  },
  {
    id: "tks",
    title: "ТКС",
    subtitle: "Создание ТКС и участников в базе данных",
    Icon: Users,
    accent: "from-emerald-500 to-teal-500",
    soon: "Настраивается",
  },
];

export default function EventGeneratorsSection() {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = GENERATORS.find(g => g.id === openId) ?? null;

  /* ── Уровень ниже: интерфейс конкретного генератора ── */
  if (open?.Component) {
    const Body = open.Component;
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
          <button
            onClick={() => setOpenId(null)}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
          >
            <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Генераторы
          </button>
          <span className="text-text-muted/40">·</span>
          <open.Icon className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-text-main">{open.title}</h1>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          <Body />
        </div>
      </div>
    );
  }

  /* ── Верхний уровень: плашки ── */
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
        <Zap className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Генераторы событий</h1>
        <span className="text-xs text-text-muted">
          {GENERATORS.length} сценар{GENERATORS.length === 1 ? "ий" : "ия"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
          {GENERATORS.map(({ id, title, subtitle, Icon, accent, Component, soon }, i) => {
            const ready = !!Component;
            return (
              <button
                key={id}
                onClick={() => ready && setOpenId(id)}
                disabled={!ready}
                style={{ animationDelay: `${i * 50}ms` }}
                className={`animate-fade-in group text-left bg-bg-card border border-border-main rounded-xl p-5
                  transition-all ${ready
                    ? "hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer"
                    : "opacity-60 cursor-not-allowed"}`}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${accent}
                  flex items-center justify-center shadow-sm mb-3`}>
                  <Icon className="w-5 h-5 text-white" strokeWidth={2} />
                </div>

                <div className="flex items-center gap-2 mb-1">
                  <h3 className="text-sm font-semibold text-text-main">{title}</h3>
                  {!ready && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full tone-neutral border">
                      {soon}
                    </span>
                  )}
                </div>
                <p className="text-xs text-text-muted leading-relaxed">{subtitle}</p>

                {ready && (
                  <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary
                    opacity-0 group-hover:opacity-100 transition-opacity">
                    Открыть →
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="mt-6 text-xs text-text-muted/70 flex items-center gap-1.5 max-w-5xl">
          <Database className="w-3.5 h-3.5" />
          Каждый генератор работает по своему сценарию: метрики уходят в Kafka, ТКС создаются в базе данных.
        </p>
      </div>
    </div>
  );
}
