"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Zap, FlaskConical, Database, Bug, SplitSquareHorizontal, Scale, Bell, Network,
  ArrowRight, Loader2, ShieldCheck,
} from "lucide-react";
import type { ComponentType } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ThemeToggle } from "@/components/ui";
import AuroraBackground from "@/components/landing/AuroraBackground";

const FEATURES: {
  Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
}[] = [
  {
    Icon: Zap,
    title: "Генерация тест-кейсов",
    description: "AI превращает требования, файлы и документы в тест-кейсы, готовые для Jira Zephyr Scale.",
  },
  {
    Icon: FlaskConical,
    title: "Автотесты на Java",
    description: "AI пишет автотесты и подключается к базам через JDBC-драйверы для реальных проверок.",
  },
  {
    Icon: Database,
    title: "Тестовые данные",
    description: "Требования и документы в едином хранилище с поиском по смыслу (RAG).",
  },
  {
    Icon: Bug,
    title: "Дефекты",
    description: "Форматирование баг-репортов и регистрация в Jira с трейсами прямо из интерфейса.",
  },
  {
    Icon: SplitSquareHorizontal,
    title: "Тестирование моделей LLM",
    description: "Сравнение моделей на одних и тех же сценариях с отчётом судьи и экспортом в Word.",
  },
  {
    Icon: Scale,
    title: "Ревизор",
    description: "Автоматическая проверка качества сгенерированных тест-кейсов перед выгрузкой.",
  },
  {
    Icon: Bell,
    title: "Генератор алертов",
    description: "Управление алертами и сценариями мониторинга через встроенные Jupyter-ядра.",
  },
  {
    Icon: Network,
    title: "Просмотр Kafka",
    description: "Очереди и сообщения — без переключения на отдельный инструмент.",
  },
];

const PROVIDERS = ["GigaChat", "DeepSeek", "OpenAI", "Claude", "Ollama", "LM Studio"];

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
      {/* ── Aurora hero zone (header + hero share one ambient backdrop) ── */}
      <div className="relative overflow-hidden">
        <AuroraBackground />

        {/* ── Header ── */}
        <header className="relative z-10 border-b border-border-main/60 backdrop-blur-sm">
          <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
                <Zap className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
              <span className="text-[15px] font-bold text-text-main tracking-tight">SimpleTest</span>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg
                  text-sm font-semibold hover:bg-primary-dark transition-all shadow-sm
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-main"
              >
                Войти
              </Link>
            </div>
          </div>
        </header>

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
            Генерирует тест-кейсы, пишет автотесты на Java, оформляет баг-репорты
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
          <p className="animate-slide-up-delay-3 mt-5 inline-flex items-center gap-1.5 text-xs text-text-muted/70">
            <ShieldCheck className="w-3.5 h-3.5" />
            Закрытая корпоративная сеть
          </p>
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

        {/* ── LLM providers strip ── */}
        <section className="border-t border-border-main">
          <div className="max-w-5xl mx-auto px-6 py-10 text-center">
            <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-4">
              Работает с любой LLM
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {PROVIDERS.map((p) => (
                <span
                  key={p}
                  className="px-3 py-1.5 rounded-full bg-bg-subtle border border-border-main text-xs font-medium text-text-muted"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-main">
        <div className="max-w-5xl mx-auto px-6 py-6 text-center text-xs text-text-muted/60">
          SimpleTest — закрытая корпоративная сеть
        </div>
      </footer>
    </div>
  );
}
