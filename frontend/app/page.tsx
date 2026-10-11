"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Zap, Database, Bug, SplitSquareHorizontal, BarChart2, Network,
  ArrowRight, Loader2,
} from "lucide-react";
import type { ComponentType } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AuroraBackground from "@/components/landing/AuroraBackground";

const FEATURES: {
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}[] = [
  {
    Icon: Zap,
    title: "Тестовая модель",
    description: "AI превращает требования, файлы и документы в тест-кейсы, готовые для Jira Zephyr Scale.",
  },
  {
    Icon: Database,
    title: "Тестовые данные",
    description: "Требования и документы в едином хранилище с поиском по смыслу (RAG).",
  },
  {
    Icon: Bug,
    title: "Jira tool",
    description: "Списки задач Jira с группировкой и своими полями, назначение участников и создание дефектов с генерацией описания.",
  },
  {
    Icon: SplitSquareHorizontal,
    title: "Тестирование моделей LLM",
    description: "Сравнение моделей на одних и тех же сценариях с отчётом судьи и экспортом в Word.",
  },
  {
    Icon: BarChart2,
    title: "Генераторы событий",
    description: "Алерты через Jupyter-ядра, метрики, ТКС и Jobs — в одном хабе, ответы ядра в виде чата по топикам.",
  },
  {
    Icon: Network,
    title: "Просмотр Kafka",
    description: "Очереди и сообщения — без переключения на отдельный инструмент.",
  },
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      router.replace("/generation");
    }
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-main">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-main">
      {/* ── Aurora hero zone ── */}
      <div className="relative overflow-hidden">
        <AuroraBackground />

        {/* ── Hero ── */}
        <section className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-20 text-center">
          <h1 className="animate-slide-up text-5xl sm:text-6xl font-extrabold tracking-tight leading-[1.05]">
            <span className="text-text-main">Тестирование на скорости</span>
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-violet-500 to-fuchsia-500">
              искусственного интеллекта
            </span>
          </h1>
          <p className="animate-slide-up-delay-1 mt-5 text-lg text-text-muted max-w-2xl mx-auto">
            Генерирует тест-кейсы, отправляет тестовые события, оформляет баг-репорты
            и сравнивает LLM-модели — весь цикл тестирования в одном инструменте.
          </p>
          <div className="animate-slide-up-delay-2 mt-9 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2 px-7 py-3.5 bg-primary text-white rounded-xl
                text-[15px] font-semibold hover:bg-primary-dark transition-all
                shadow-[0_8px_30px_-6px_rgba(99,102,241,0.55)] hover:shadow-[0_10px_36px_-4px_rgba(99,102,241,0.7)]
                hover:-translate-y-0.5
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-main"
            >
              Войти в систему
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      </div>

      <main>
        {/* ── Features ── */}
        <section className="max-w-5xl mx-auto px-6 pb-16">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map(({ Icon, title, description }, i) => (
              <div
                key={title}
                className="animate-fade-in bg-bg-card border border-border-main rounded-xl p-5
                  hover:border-primary/30 hover:shadow-sm transition-all"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-3">
                  <Icon className="w-[18px] h-[18px]" strokeWidth={2} />
                </div>
                <h3 className="text-sm font-semibold text-text-main mb-1">{title}</h3>
                <p className="text-xs text-text-muted leading-relaxed">{description}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border-main">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center text-xs text-text-muted/60">
          SimpleTest
        </div>
      </footer>
    </div>
  );
}
