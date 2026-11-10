"use client";

import { useCallback, useEffect, useState, type ComponentType, type ReactNode } from "react";
import { BookOpen, ChevronRight, Cpu, Database, GitBranch, HardDrive, Network, Play, Rocket, Ticket } from "lucide-react";

import { Modal, Tabs } from "@/components/ui";
import { LlmProvidersPanel, SystemStoresPanel } from "@/components/settings/LlmSettings";
import JiraSettingsModal from "@/components/settings/JiraSettingsModal";
import ConfluenceSettingsModal from "@/components/settings/ConfluenceSettingsModal";
import KafkaMetricsSettingsModal from "@/components/settings/KafkaMetricsSettingsModal";
import TestDataSettingsModal from "@/components/settings/TestDataSettingsModal";
import AqaSettingsModal from "@/components/aqa/AqaSettingsModal";
import { BackupPanel } from "@/components/BackupModal";
import { getCorpAuthStatus, getProviders, listTestDataConnections } from "@/lib/api";
import { getSettings } from "@/lib/settingsApi";
import { getAqaSettings } from "@/lib/aqaApi";

/**
 * «Настройки» — три вкладки: «Интеграции» (внешние сервисы и модели), «Подключения» (Kafka и базы данных),
 * «Резервная копия» (выгрузка и восстановление прямо во вкладке, без окна). Тема, «Что нового» и выход —
 * в меню под ФИО вверху справа. Строка интеграции или подключения → по клику окно.
 * Окна те же, что открываются из разделов (Jira tool, Метрики, Тестовые данные…), — одна реализация на всё
 * приложение, правка в одном месте видна везде. Вкладка и открытое окно хранятся в адресе (?tab=backup,
 * ?open=jira): ссылка и перезагрузка попадают прямо туда. Состояние на строках — только из лёгких запросов; медленные проверки
 * (запрос в модель, в базу) — по кнопке внутри окна.
 */

type PanelId = "jira" | "confluence" | "testops" | "bitbucket" | "jenkins" | "llm" | "kafka" | "testdata" | "stores";
const PANEL_IDS: PanelId[] = ["jira", "confluence", "testops", "bitbucket", "jenkins", "llm", "kafka", "testdata", "stores"];

type TabId = "integrations" | "connections" | "backup";
const TABS: { id: TabId; label: string }[] = [
  { id: "integrations", label: "Интеграции" },
  { id: "connections", label: "Подключения" },
  { id: "backup", label: "Резервная копия" },
];

type Tone = "ok" | "warn" | "bad" | "idle";
interface Chip { tone: Tone; text: string }

interface Row {
  id: PanelId;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const TAB_ROWS: Record<Exclude<TabId, "backup">, Row[]> = {
  integrations: [
      { id: "jira", icon: Ticket, title: "Jira", description: "Учётная запись Сигмы и адрес Jira" },
      { id: "confluence", icon: BookOpen, title: "Confluence", description: "Учётная запись Сигмы и пространство для страниц" },
      { id: "testops", icon: Rocket, title: "Allure TestOps", description: "Проект с запусками автотестов и API-токен" },
      { id: "bitbucket", icon: GitBranch, title: "Bitbucket", description: "Репозиторий автотестов и маркер доступа" },
      { id: "jenkins", icon: Play, title: "Jenkins", description: "Джоб запуска автотестов, логин и API-токен" },
      { id: "llm", icon: Cpu, title: "LLM-провайдеры", description: "GigaChat и совместимые модели: ключи, сертификаты, выбор модели" },
  ],
  connections: [
      { id: "kafka", icon: Network, title: "Kafka", description: "Поток для «Метрик ОД»: SASL, SSL, сертификаты" },
      { id: "testdata", icon: Database, title: "Базы для тестовых данных", description: "Подключения к внешним БД и JDBC-драйверы" },
      { id: "stores", icon: HardDrive, title: "Служебные хранилища", description: "ChromaDB и PostgreSQL самого приложения" },
  ],
};

const tabOf = (id: PanelId): TabId => TAB_ROWS.integrations.some(r => r.id === id) ? "integrations" : "connections";

const onSettingsPage = () => typeof window !== "undefined" && window.location.pathname.startsWith("/settings");

/** Вкладка и окно из адреса. Старая ссылка ?open=backup ведёт на вкладку копии; окно само выбирает свою вкладку. */
function readUrl(): { tab: TabId; panel: PanelId | null } {
  if (!onSettingsPage()) return { tab: "integrations", panel: null };
  const q = new URLSearchParams(window.location.search);
  const open = q.get("open");
  if (open === "backup") return { tab: "backup", panel: null };
  const panel = PANEL_IDS.includes(open as PanelId) ? (open as PanelId) : null;
  if (panel) return { tab: tabOf(panel), panel };
  const tab = TABS.some(t => t.id === q.get("tab")) ? (q.get("tab") as TabId) : "integrations";
  return { tab, panel: null };
}

function writeUrl(tab: TabId, panel: PanelId | null) {
  // Только на странице /settings: в правой панели рядом с другим разделом адрес принадлежит не нам.
  if (!onSettingsPage()) return;
  const url = new URL(window.location.href);
  if (tab === "integrations") url.searchParams.delete("tab"); else url.searchParams.set("tab", tab);
  if (panel) url.searchParams.set("open", panel); else url.searchParams.delete("open");
  window.history.replaceState(window.history.state, "", url);
}

// ── Состояния на строках ──────────────────────────────────────────────────────

/** Каждый запрос — сам по себе: упал один, остальные строки всё равно показывают своё. */
async function loadChips(): Promise<Partial<Record<PanelId, Chip>>> {
  const [providers, corp, settings, conns, aqa] = await Promise.allSettled([
    getProviders(), getCorpAuthStatus(), getSettings(), listTestDataConnections(), getAqaSettings(),
  ]);
  const chips: Partial<Record<PanelId, Chip>> = {};

  if (providers.status === "fulfilled") {
    const all = providers.value;
    const ok = all.filter(p => p.status === "green").length;
    chips.llm = all.length === 0 ? { tone: "idle", text: "Не настроено" }
      : ok > 0 ? { tone: "ok", text: `Доступно ${ok} из ${all.length}` }
      : { tone: "bad", text: "Нет доступных" };
  }
  if (corp.status === "fulfilled") {
    chips.jira = corp.value.jira.hasToken ? { tone: "ok", text: "Вход выполнен" } : { tone: "warn", text: "Нужен вход" };
    chips.confluence = corp.value.confluence.hasToken ? { tone: "ok", text: "Вход выполнен" } : { tone: "warn", text: "Нужен вход" };
  }
  if (settings.status === "fulfilled") {
    chips.kafka = settings.value["kafka_bootstrap_servers"]?.value
      ? { tone: "ok", text: "Настроено" } : { tone: "idle", text: "Не настроено" };
  }
  if (conns.status === "fulfilled") {
    const n = conns.value.length;
    chips.testdata = n ? { tone: "ok", text: `${n} ${plural(n, "подключение", "подключения", "подключений")}` }
      : { tone: "idle", text: "Нет подключений" };
  }
  if (aqa.status === "fulfilled") {
    const a = aqa.value;
    chips.bitbucket = !a.bitbucketUrl ? { tone: "idle", text: "Не подключено" }
      : !a.bitbucketOk ? { tone: "bad", text: "Ссылка не разобралась" }
      : a.bitbucketToken ? { tone: "ok", text: "Подключено" } : { tone: "warn", text: "Нужен маркер" };
    chips.testops = !a.testopsUrl ? { tone: "idle", text: "Не подключено" }
      : !a.testopsOk ? { tone: "bad", text: "Ссылка не разобралась" }
      : a.testopsToken ? { tone: "ok", text: "Подключено" } : { tone: "warn", text: "Нужен токен" };
    chips.jenkins = !a.jenkinsUrl ? { tone: "idle", text: "Не подключено" }
      : !a.jenkinsOk ? { tone: "bad", text: "Ссылка не разобралась" }
      : a.jenkinsUser && a.jenkinsToken ? { tone: "ok", text: "Подключено" } : { tone: "warn", text: "Нужны логин и токен" };
  }
  return chips;
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const DOT: Record<Tone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  idle: "bg-text-muted/40",
};

function StatusChip({ chip, loading }: { chip?: Chip; loading: boolean }) {
  if (loading) return <span aria-hidden className="h-3 w-20 shrink-0 animate-pulse rounded-full bg-bg-muted" />;
  if (!chip) return null;
  return (
    <span className="t-rise inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-text-muted">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[chip.tone]}`} />
      {chip.text}
    </span>
  );
}

// ── Строки и группы ───────────────────────────────────────────────────────────

const ROW = "flex w-full items-center gap-3.5 px-4 py-3";

function RowIcon({ icon: Icon }: { icon: Row["icon"] }) {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-105">
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function RowText({ title, description }: { title: string; description: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-sm font-medium text-text-main">{title}</span>
      <span className="block truncate text-xs text-text-muted">{description}</span>
    </span>
  );
}

function SettingsRow({ row, chip, loading, onOpen }: {
  row: Row; chip?: Chip; loading: boolean; onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group ${ROW} text-left transition-colors hover:bg-bg-subtle focus-visible:bg-bg-subtle focus-visible:outline-none`}
    >
      <RowIcon icon={row.icon} />
      <RowText title={row.title} description={row.description} />
      <StatusChip chip={chip} loading={loading} />
      <ChevronRight className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  );
}

function Card({ children, divided }: { children: ReactNode; divided?: boolean }) {
  return (
    <div className={`t-rise overflow-hidden rounded-xl border border-border-main bg-bg-card ${divided ? "divide-y divide-border-main" : "p-5"}`}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

export default function SettingsSection() {
  const [tab, setTab] = useState<TabId>("integrations");
  const [panel, setPanel] = useState<PanelId | null>(null);
  const [chips, setChips] = useState<Partial<Record<PanelId, Chip>>>({});
  const [chipsLoading, setChipsLoading] = useState(true);

  const refreshChips = useCallback(async () => {
    try { setChips(await loadChips()); } finally { setChipsLoading(false); }
  }, []);

  useEffect(() => {
    const u = readUrl();
    setTab(u.tab); setPanel(u.panel);
    void refreshChips();
  }, [refreshChips]);

  const switchTab = (id: string) => { setTab(id as TabId); writeUrl(id as TabId, null); };
  const open = (id: PanelId) => { setPanel(id); writeUrl(tab, id); };
  const close = useCallback(() => {
    setPanel(null); writeUrl(tab, null);
    void refreshChips();   // после правки строка сразу показывает новое состояние
  }, [refreshChips, tab]);

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="mx-auto max-w-3xl space-y-5 px-6 py-6">
        <Tabs tabs={TABS} active={tab} onChange={switchTab} />

        {/* key — чтобы при смене вкладки содержимое заново поднималось анимацией */}
        <div key={tab}>
          {tab === "backup" ? (
            <Card><BackupPanel section="settings" /></Card>
          ) : (
            <Card divided>
              {TAB_ROWS[tab].map(r => (
                <SettingsRow key={r.id} row={r} chip={chips[r.id]} loading={chipsLoading && r.id in STATUS_ROWS}
                  onOpen={() => open(r.id)} />
              ))}
            </Card>
          )}
        </div>
      </div>

      {/* Окна. Пока окно закрыто, его содержимое не смонтировано — данные грузятся при открытии. */}
      <Modal open={panel === "llm"} onClose={close} title="LLM-провайдеры" size="max-w-4xl">
        <LlmProvidersPanel />
      </Modal>
      <Modal open={panel === "stores"} onClose={close} title="Служебные хранилища" size="max-w-xl">
        <SystemStoresPanel />
      </Modal>
      <JiraSettingsModal open={panel === "jira"} onClose={close} />
      <ConfluenceSettingsModal open={panel === "confluence"} onClose={close} />
      <KafkaMetricsSettingsModal open={panel === "kafka"} onClose={close} onSaved={refreshChips} />
      <TestDataSettingsModal open={panel === "testdata"} onClose={close} onChanged={refreshChips} />
      <AqaSettingsModal open={panel === "testops"} only="testops" onClose={close} onSaved={refreshChips} />
      <AqaSettingsModal open={panel === "bitbucket"} only="bitbucket" onClose={close} onSaved={refreshChips} />
      <AqaSettingsModal open={panel === "jenkins"} only="jenkins" onClose={close} onSaved={refreshChips} />
    </div>
  );
}

/** Строки, у которых есть состояние: пока оно грузится, вместо него — заглушка. */
const STATUS_ROWS: Partial<Record<PanelId, true>> = {
  jira: true, confluence: true, testops: true, bitbucket: true, jenkins: true, llm: true, kafka: true, testdata: true,
};
