"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BarChart2, Bell, ChevronLeft, CircleCheck, FolderPlus, Globe, Play, Users, X, Zap,
} from "lucide-react";
import type { ComponentType } from "react";

import MetricsSection from "./MetricsSection";
import TcsGeneratorSection from "./TcsGeneratorSection";
import JobsSection from "./JobsSection";
import WebConnectorsSection from "./WebConnectorsSection";
import AlertsSection from "./AlertsSection";
import { useAlertsScheduler } from "@/contexts/AlertsSchedulerContext";
import { useAuth } from "@/contexts/AuthContext";
import { saveAlertFolder } from "@/lib/api";

/* ── Хаб генераторов ─────────────────────────────────────────────────────
   Плитки двух видов:
   - сценарии (Метрики ОД, ТКС, Jobs) — реестр GENERATORS ниже, новый сценарий
     добавляется одной записью;
   - папки алертов — строятся из данных: каждая папка = плитка, внутри неё
     раздел алертов этой папки (скрипты, редактирование, запуск, чат ядра).
   Открытая плитка живёт в адресе (?open=…), если раздел открыт страницей:
   так на неё ведут индикатор активных алертов и старые ссылки /alerts, /jobs. */

type Generator = {
  id:             string;
  title:          string;
  subtitle:       string;
  Icon:           ComponentType<{ className?: string; strokeWidth?: number }>;
  accent:         string;
  Component:      ComponentType;
  superuserOnly?: boolean;
};

const GENERATORS: Generator[] = [
  {
    id: "metrics",
    title: "Метрики ОД",
    subtitle: "Системы, метрики и пороги здоровья · отправка в Kafka по расписанию",
    Icon: BarChart2,
    accent: "from-indigo-500 to-violet-500",
    Component: MetricsSection,
    superuserOnly: true,
  },
  {
    id: "tks",
    title: "ТКС",
    subtitle: "Участники выбранной ТКС: добавить, убавить, обновить счётчик",
    Icon: Users,
    accent: "from-emerald-500 to-teal-500",
    Component: TcsGeneratorSection,
    superuserOnly: true,
  },
  {
    id: "webconnect",
    title: "Веб-коннекторы",
    subtitle: "Запись действий на сайте под вашей сессией и повтор: выгрузка логов и данных по сервису",
    Icon: Globe,
    accent: "from-fuchsia-500 to-pink-500",
    Component: WebConnectorsSection,
    superuserOnly: true,
  },
  {
    id: "jobs",
    title: "Jobs",
    subtitle: "Задачи и скрипты с папками, подключениями к БД и историей запусков",
    Icon: Play,
    accent: "from-sky-500 to-blue-600",
    Component: JobsSection,
  },
];

const ALERTS_PREFIX = "alerts:";
const NO_FOLDER = "none";

function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, h = n % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

function TileShell({ onClick, delay, children }: {
  onClick: () => void; delay: number; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: `${delay}ms` }}
      className="animate-fade-in group text-left bg-bg-card border border-border-main rounded-xl p-5 transition-all
        hover:border-primary/40 hover:shadow-md hover:-translate-y-0.5 cursor-pointer
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      {children}
      <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary
        opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
        Открыть →
      </span>
    </button>
  );
}

function TileIcon({ Icon, accent }: { Icon: Generator["Icon"]; accent: string }) {
  return (
    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${accent} flex items-center justify-center shadow-sm mb-3`}>
      <Icon className="w-5 h-5 text-white" strokeWidth={2} />
    </div>
  );
}

export default function EventGeneratorsSection({ syncUrl = false }: { syncUrl?: boolean }) {
  const { isSuperuser } = useAuth();
  const { scripts, folders, setFolders, sessions, loadErr } = useAlertsScheduler();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Страница держит открытую плитку в адресе, правая панель — у себя.
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const openId = syncUrl ? searchParams.get("open") : localOpen;
  const setOpenId = (id: string | null) => {
    if (!syncUrl) { setLocalOpen(id); return; }
    router.replace(id ? `${pathname}?open=${encodeURIComponent(id)}` : pathname);
  };

  const [newFolder, setNewFolder] = useState<string | null>(null);

  const generators = GENERATORS.filter(g => !g.superuserOnly || isSuperuser);

  // Папки алертов: суперюзер видит все, остальные — только те, где есть
  // доступные им скрипты (бэкенд уже отфильтровал скрипты по роли).
  const countIn = (fid: string | null) => scripts.filter(s => (s.folder_id ?? null) === fid);
  const runningIn = (fid: string | null) =>
    countIn(fid).filter(s => sessions[s.id]?.kernelAlive || sessions[s.id]?.schedActive).length;

  const alertTiles = [
    ...folders
      .map(f => ({ key: f.id, title: f.name, folderId: f.id as string | null, total: countIn(f.id).length }))
      .filter(t => isSuperuser || t.total > 0),
    ...(countIn(null).length > 0
      ? [{ key: NO_FOLDER, title: "Без папки", folderId: null as string | null, total: countIn(null).length }]
      : []),
  ];

  const createFolder = async () => {
    const name = (newFolder ?? "").trim();
    if (!name) return;
    try {
      const saved = await saveAlertFolder({ name });
      setFolders(prev => [...prev, saved]);
      setNewFolder(null);
    } catch (e) { alert(String(e)); }
  };

  /* ── Открытая плитка ── */
  const openGenerator = generators.find(g => g.id === openId);
  const openKey = openId?.startsWith(ALERTS_PREFIX) ? openId.slice(ALERTS_PREFIX.length) : null;
  const openFolder = openKey && openKey !== NO_FOLDER ? folders.find(f => f.id === openKey) : undefined;
  const openAlerts: { title: string; folderId: string | null } | undefined =
    openKey === NO_FOLDER ? { title: "Без папки", folderId: null }
    : openFolder ? { title: openFolder.name, folderId: openFolder.id }
    : undefined;

  if (openGenerator || openAlerts) {
    const title = openGenerator?.title ?? openAlerts!.title;
    const Icon = openGenerator?.Icon ?? Bell;
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
          <button
            type="button"
            onClick={() => setOpenId(null)}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
          >
            <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Генераторы
          </button>
          <span className="text-text-muted/40">·</span>
          <Icon className="w-5 h-5 text-primary" />
          <h1 className="text-lg font-bold text-text-main truncate">{title}</h1>
          {openAlerts && <span className="text-xs text-text-muted flex-shrink-0">папка алертов</span>}
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {openGenerator
            ? <openGenerator.Component />
            : <AlertsSection folderId={openAlerts!.folderId} onFolderDeleted={() => setOpenId(null)} />}
        </div>
      </div>
    );
  }

  /* ── Верхний уровень: плитки ── */
  let delay = 0;
  const nextDelay = () => (delay += 50) - 50;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b border-border-main bg-bg-card flex-shrink-0">
        <Zap className="w-5 h-5 text-primary" />
        <h1 className="text-lg font-bold text-text-main">Генераторы событий</h1>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-8">
        {generators.length > 0 && (
          <section aria-labelledby="gen-scenarios">
            <h2 id="gen-scenarios" className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
              Сценарии
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
              {generators.map(({ id, title, subtitle, Icon, accent }) => (
                <TileShell key={id} onClick={() => setOpenId(id)} delay={nextDelay()}>
                  <TileIcon Icon={Icon} accent={accent} />
                  <h3 className="text-sm font-semibold text-text-main mb-1">{title}</h3>
                  <p className="text-xs text-text-muted leading-relaxed">{subtitle}</p>
                </TileShell>
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="gen-alerts">
          <h2 id="gen-alerts" className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
            Генератор алертов
          </h2>
          {loadErr && (
            <p className="mb-3 max-w-5xl text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{loadErr}</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-5xl">
            {alertTiles.map(t => {
              const running = runningIn(t.folderId);
              return (
                <TileShell key={t.key} onClick={() => setOpenId(ALERTS_PREFIX + t.key)} delay={nextDelay()}>
                  <TileIcon Icon={Bell} accent="from-amber-500 to-orange-500" />
                  <div className="flex items-center gap-2 mb-1 min-w-0">
                    <h3 className="text-sm font-semibold text-text-main truncate">{t.title}</h3>
                    {running > 0 && (
                      <span className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold
                        bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                        {running} {plural(running, "работает", "работают", "работают")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-muted leading-relaxed">
                    {t.total} {plural(t.total, "алерт", "алерта", "алертов")}
                  </p>
                </TileShell>
              );
            })}

            {isSuperuser && (
              newFolder === null ? (
                <button
                  type="button"
                  onClick={() => setNewFolder("")}
                  className="flex flex-col items-center justify-center gap-2 min-h-[132px] rounded-xl border-2 border-dashed
                    border-border-main text-text-muted hover:text-primary hover:border-primary/40 transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <FolderPlus className="w-5 h-5" />
                  <span className="text-xs font-medium">Новая папка алертов</span>
                </button>
              ) : (
                <div className="flex flex-col justify-center gap-2 min-h-[132px] rounded-xl border-2 border-dashed border-primary/40 p-4">
                  <label htmlFor="new-alert-folder" className="text-xs font-semibold text-text-muted">Название папки</label>
                  <div className="flex items-center gap-1">
                    <input
                      id="new-alert-folder"
                      autoFocus
                      value={newFolder}
                      onChange={e => setNewFolder(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") setNewFolder(null); }}
                      placeholder="Например, PKAP insert"
                      className="flex-1 min-w-0 text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)]
                        text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    <button type="button" onClick={createFolder} aria-label="Создать папку"
                      className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg"><CircleCheck className="w-4 h-4" /></button>
                    <button type="button" onClick={() => setNewFolder(null)} aria-label="Отмена"
                      className="p-1.5 text-text-muted hover:bg-bg-subtle rounded-lg"><X className="w-4 h-4" /></button>
                  </div>
                </div>
              )
            )}

            {alertTiles.length === 0 && !isSuperuser && (
              <p className="text-sm text-text-muted col-span-full">Доступных алертов нет — суперюзер ещё не открыл доступ.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
