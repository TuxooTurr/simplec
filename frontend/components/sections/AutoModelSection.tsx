"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  FlaskConical, Loader2, Copy, CheckCheck, Paperclip, FileText,
  PlugZap, History, ChevronLeft, BookmarkPlus, CheckCircle2, XCircle,
  Trash2, X, FolderOpen, ChevronDown, ChevronUp, CheckCircle, Search,
} from "lucide-react";
import AutotestRunPanel from "@/components/AutotestRunPanel";
import { generateAutotest, addAutotest, parseFile, analyzeProject, type ProjectAnalysis } from "@/lib/api";
import { getAutotestRunConfig, saveAutotestRunConfig } from "@/lib/autotestRunsApi";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useAuth } from "@/contexts/AuthContext";

/* ── History helpers ──────────────────────────────────────────────── */

interface AutoHistEntry {
  id: string;
  timestamp: number;
  feature: string;
  inputText: string;
  code: string;
  loadedAsEtalon?: boolean;
}

interface ParsedFileAttachment {
  name: string;
  text: string;
}

function buildAutotestSourceText(fieldText: string, files: ParsedFileAttachment[]): string {
  const cleanFieldText = fieldText.trim();
  const cleanFiles = files
    .map((file, index) => {
      const cleanText = file.text.trim();
      if (!cleanText) return "";
      return `### Файл ${index + 1}: ${file.name}\n${cleanText}`;
    })
    .filter(Boolean);

  const parts: string[] = [];
  if (cleanFieldText) {
    parts.push(`РУЧНЫЕ ТЕСТ-КЕЙСЫ ИЗ ПОЛЯ:\n${cleanFieldText}`);
  }
  if (cleanFiles.length > 0) {
    parts.push(`СОДЕРЖИМОЕ ЗАГРУЖЕННЫХ ФАЙЛОВ, КОТОРОЕ ОБЯЗАТЕЛЬНО НУЖНО ИЗУЧИТЬ ПРИ ГЕНЕРАЦИИ АВТОТЕСТОВ:\n${cleanFiles.join("\n\n")}`);
  }

  return parts.join("\n\n");
}

const HIST_KEY    = "st_automodel_history";
const PROJECT_KEY = "st_autotest_project";

function loadSavedProject(): { path: string; data: ProjectAnalysis } | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    return raw ? (JSON.parse(raw) as { path: string; data: ProjectAnalysis }) : null;
  } catch {
    return null;
  }
}

function loadHistory(): AutoHistEntry[] {
  try {
    const raw = localStorage.getItem(HIST_KEY);
    return raw ? (JSON.parse(raw) as AutoHistEntry[]) : [];
  } catch {
    return [];
  }
}

const HIST_GROUPS = ["Сегодня", "Вчера", "На этой неделе", "Ранее"] as const;

function getDateGroup(ts: number): string {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const t = todayStart.getTime();
  if (ts >= t) return "Сегодня";
  if (ts >= t - 86400000) return "Вчера";
  if (ts >= t - 6 * 86400000) return "На этой неделе";
  return "Ранее";
}

function formatHistTime(ts: number): string {
  const d = new Date(ts);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const hm = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (ts >= todayStart.getTime()) return hm;
  if (ts >= todayStart.getTime() - 86400000) return `вчера ${hm}`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + " " + hm;
}

/* ── Test types ───────────────────────────────────────────────────── */

type TestType = "api" | "e2e" | "frontend" | "mobile" | "dt";
type AutoMode = "generate" | "run";

interface TestTypeConfig {
  label: string;
  framework: string;
  placeholder: string;
  codeLabel: string;
}

const TEST_TYPES: Record<TestType, TestTypeConfig> = {
  api: {
    label: "API",
    framework: "JUnit 5 + RestAssured",
    placeholder:
      "Вставьте API тест-кейсы:\n\n1. Тест: Создание пользователя\n   Метод: POST /api/users\n   Тело: { \"name\": \"Ivan\", \"email\": \"ivan@test.com\" }\n   Ожидаемый статус: 201\n   Ожидаемый ответ: { \"id\": <number>, \"name\": \"Ivan\" }\n\n2. Тест: Получение несуществующего пользователя\n   Метод: GET /api/users/99999\n   Ожидаемый статус: 404",
    codeLabel: "Java-код (RestAssured)",
  },
  e2e: {
    label: "E2E",
    framework: "JUnit 5 + Selenide",
    placeholder:
      "Вставьте E2E тест-кейсы:\n\n1. Тест: Оформление заказа\n   Шаг 1: Открыть каталог\n   Шаг 2: Выбрать товар\n   Шаг 3: Добавить товар в корзину\n   Шаг 4: Перейти к оформлению\n   Шаг 5: Подтвердить заказ\n   Ожидаемый результат: Заказ создан, отображается номер заказа",
    codeLabel: "Java-код (Selenide E2E)",
  },
  frontend: {
    label: "Frontend",
    framework: "JUnit 5 + Selenide",
    placeholder:
      "Вставьте Frontend UI тест-кейсы:\n\n1. Тест: Валидация формы заявки\n   Шаг 1: Открыть страницу /request\n   Шаг 2: Нажать «Отправить» без заполнения обязательных полей\n   Ожидаемый результат: Обязательные поля подсвечены, отображаются тексты ошибок\n\n2. Тест: Раскрытие дополнительного блока\n   Шаг 1: Нажать переключатель «Дополнительные параметры»\n   Шаг 2: Изменить значение в поле\n   Ожидаемый результат: Блок раскрыт, введённое значение сохраняется в форме",
    codeLabel: "Java-код (Selenide Frontend)",
  },
  mobile: {
    label: "Mobile",
    framework: "JUnit 5 + Appium",
    placeholder:
      "Вставьте Mobile тест-кейсы:\n\n1. Тест: Открытие карточки товара\n   Платформа: Android\n   Шаг 1: Запустить приложение\n   Шаг 2: Открыть каталог\n   Шаг 3: Тапнуть карточку товара\n   Ожидаемый результат: Открылась детальная карточка товара\n\n2. Тест: Свайп карточки товара\n   Шаг 1: Свайпнуть карточку влево\n   Ожидаемый результат: Карточка скрыта, отображается следующая",
    codeLabel: "Java-код (Appium Mobile)",
  },
  dt: {
    label: "DT",
    framework: "JUnit 5 + WinAppDriver",
    placeholder:
      "Вставьте Desktop тест-кейсы:\n\n1. Тест: Открытие главного окна приложения\n   Приложение: C:\\Program Files\\MyApp\\MyApp.exe\n   Шаг 1: Запустить приложение\n   Шаг 2: Дождаться загрузки главного окна\n   Ожидаемый результат: Заголовок окна «My Application», кнопка «Войти» активна\n\n2. Тест: Сохранение файла через меню\n   Шаг 1: Нажать File → Save As\n   Шаг 2: Ввести имя файла «test_document»\n   Шаг 3: Нажать «Сохранить»\n   Ожидаемый результат: Файл сохранён, в заголовке окна — имя файла",
    codeLabel: "Java-код (WinAppDriver Desktop)",
  },
};

/* ── Constants ────────────────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const ACCEPT = ".txt,.md,.pdf,.docx,.doc,.xlsx,.xls,.xml";

/* ── Component ────────────────────────────────────────────────────── */

export default function AutoModelSection() {
  const { provider } = useWorkspace();
  const { isSuperuser } = useAuth();

  const [stage, setStage]         = useState<"input" | "history">("input");
  const [activeMode, setActiveMode] = useState<AutoMode>("generate");
  const [testType, setTestType]   = useState<TestType>("e2e");
  const [feature, setFeature]     = useState("");
  const [inputText, setInputText] = useState("");
  const [fileAttachments, setFileAttachments] = useState<ParsedFileAttachment[]>([]);
  const [loading, setLoading]     = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [code, setCode]           = useState("");
  const [copied, setCopied]       = useState(false);
  const [genError, setGenError]   = useState<{ message: string; llm_error: boolean } | null>(null);

  const [histEntries, setHistEntries] = useState<AutoHistEntry[]>(() => loadHistory());
  const [etalonStatus, setEtalonStatus] = useState<Record<string, "loading" | "done" | "error">>({});
  const [etalonErrorMsg, setEtalonErrorMsg] = useState<Record<string, string>>({});

  // Project binding — персистируется в localStorage, не сбрасывается при навигации
  const [projectOpen,    setProjectOpen]    = useState(false);
  const [projectPath,    setProjectPath]    = useState<string>(() => loadSavedProject()?.path ?? "");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectData,    setProjectData]    = useState<ProjectAnalysis | null>(() => loadSavedProject()?.data ?? null);
  const [projectError,   setProjectError]   = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── Prefill from GenerationSection "В автотесты" ─────────────── */
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("st_automodel_prefill");
      if (raw) {
        const { text, feature: f } = JSON.parse(raw) as { text: string; feature: string };
        setInputText(text || "");
        setFeature(f || "");
        sessionStorage.removeItem("st_automodel_prefill");
      }
    } catch { /* ignore */ }
  }, []);

  /* ── Общий путь фреймворка: подтягиваем из серверного конфига (вкладка «Запуск») ─ */
  useEffect(() => {
    let alive = true;
    getAutotestRunConfig().then(cfg => {
      const fp = (cfg.framework_path ?? "").trim();
      if (!alive || !fp) return;
      setProjectPath(fp);
      const saved = loadSavedProject();
      if (saved && saved.path === fp && saved.data) {
        setProjectData(saved.data);
      } else {
        // путь задан на вкладке «Запуск» — подтянем контекст проекта для генерации
        analyzeProject(fp)
          .then(data => {
            if (!alive) return;
            setProjectData(data);
            localStorage.setItem(PROJECT_KEY, JSON.stringify({ path: fp, data }));
          })
          .catch(() => { /* контекст необязателен */ });
      }
    }).catch(() => { /* не критично */ });
    return () => { alive = false; };
  }, []);

  /* ── History management ─────────────────────────────────────────── */

  const saveHistEntry = useCallback((entry: AutoHistEntry) => {
    setHistEntries(prev => {
      const next = [entry, ...prev].slice(0, 30);
      localStorage.setItem(HIST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const deleteHistEntry = useCallback((id: string) => {
    setHistEntries(prev => {
      const next = prev.filter(e => e.id !== id);
      localStorage.setItem(HIST_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistEntries([]);
    localStorage.removeItem(HIST_KEY);
  }, []);

  const handleLoadAsEtalon = useCallback(async (entry: AutoHistEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    setEtalonStatus(prev => ({ ...prev, [entry.id]: "loading" }));
    try {
      await addAutotest({
        xml_text: entry.inputText,
        java_text: entry.code,
        feature: entry.feature || undefined,
      });
      setHistEntries(prev => {
        const next = prev.map(h => h.id === entry.id ? { ...h, loadedAsEtalon: true } : h);
        localStorage.setItem(HIST_KEY, JSON.stringify(next));
        return next;
      });
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "done" }));
    } catch (e) {
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "error" }));
      setEtalonErrorMsg(prev => ({ ...prev, [entry.id]: e instanceof Error ? e.message : String(e) }));
      setTimeout(() => {
        setEtalonStatus(prev => { const next = { ...prev }; delete next[entry.id]; return next; });
        setEtalonErrorMsg(prev => { const next = { ...prev }; delete next[entry.id]; return next; });
      }, 8000);
    }
  }, []);

  /* ── File upload ─────────────────────────────────────────────────── */

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setFileLoading(true);
    setGenError(null);
    try {
      const parsedFiles = await Promise.all(files.map(async (file) => {
        const res = await parseFile(file);
        return {
          name: res.filename || file.name,
          text: res.text,
        };
      }));
      setFileAttachments((prev) => [...prev, ...parsedFiles]);
    } catch (err) {
      setGenError({ message: String(err), llm_error: false });
    } finally {
      setFileLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* ── Project analysis ──────────────────────────────────────────── */

  const handleAnalyzeProject = async () => {
    if (!projectPath.trim()) return;
    setProjectLoading(true);
    setProjectError("");
    setProjectData(null);
    try {
      const path = projectPath.trim();
      const data = await analyzeProject(path);
      setProjectData(data);
      // Сохраняем привязку навсегда — восстановится при любой навигации
      localStorage.setItem(PROJECT_KEY, JSON.stringify({ path, data }));
      // Общий путь фреймворка — синхронизируем со вкладкой «Запуск» (серверный конфиг)
      try {
        const cfg = await getAutotestRunConfig();
        if ((cfg.framework_path ?? "").trim() !== path) {
          await saveAutotestRunConfig({ ...cfg, framework_path: path });
        }
      } catch { /* не критично для генерации */ }
    } catch (err) {
      setProjectError(String(err));
    } finally {
      setProjectLoading(false);
    }
  };

  const handleDetachProject = () => {
    setProjectData(null);
    setProjectPath("");
    setProjectError("");
    localStorage.removeItem(PROJECT_KEY);
    // Отвязываем общий путь и на вкладке «Запуск»
    getAutotestRunConfig()
      .then(cfg => saveAutotestRunConfig({ ...cfg, framework_path: "" }))
      .catch(() => { /* не критично */ });
  };

  const buildProjectContext = (): string => {
    if (!projectData) return "";
    const lines: string[] = [];
    lines.push(`Инструмент сборки: ${projectData.build_tool}`);
    if (projectData.dependencies.length)
      lines.push(`Зависимости:\n${projectData.dependencies.map(d => `  - ${d}`).join("\n")}`);
    if (projectData.base_packages.length)
      lines.push(`Пакеты проекта: ${projectData.base_packages.join(", ")}`);
    if (projectData.test_dirs.length)
      lines.push(`Директории тестов: ${projectData.test_dirs.join(", ")}`);
    if (projectData.sample_imports.length)
      lines.push(`Примеры импортов в тестах:\n${projectData.sample_imports.map(i => `  import ${i};`).join("\n")}`);
    lines.push(`\nГенерируй тесты:\n- Используй пакет из: ${projectData.base_packages[0] ?? "com.example.tests"}\n- Помести файл в: ${projectData.test_dirs[0] ?? "src/test/java"}`);
    return lines.join("\n\n");
  };

  /* ── Generate ────────────────────────────────────────────────────── */

  const handleGenerate = async () => {
    const sourceText = buildAutotestSourceText(inputText, fileAttachments);
    if (!sourceText) return;
    setLoading(true);
    setCode("");
    setGenError(null);
    try {
      const project_context = buildProjectContext();
      const res = await generateAutotest({ cases: sourceText, feature, provider, test_type: testType, project_context });
      setCode(res.code);
      saveHistEntry({
        id: Date.now().toString(),
        timestamp: Date.now(),
        feature,
        inputText: sourceText,
        code: res.code,
      });
    } catch (err) {
      const raw = String(err);
      try {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          const detail = parsed.detail ?? parsed;
          setGenError({ message: detail.message ?? raw, llm_error: detail.llm_error ?? false });
          return;
        }
      } catch { /* fallthrough */ }
      setGenError({ message: raw, llm_error: false });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fileChars = fileAttachments.reduce((sum, file) => sum + file.text.length, 0);
  const hasAutotestSource = Boolean(inputText.trim() || fileAttachments.some((file) => file.text.trim()));

  /* ── History stage ──────────────────────────────────────────────── */

  if (stage === "history") return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="w-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStage("input")}
              className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
            >
              <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
              Назад
            </button>
            <span className="text-text-muted/40">·</span>
            <h1 className="text-xl font-bold text-text-main">История автотестов</h1>
          </div>
          {histEntries.length > 0 && (
            <button
              onClick={() => { if (window.confirm("Удалить всю историю?")) clearHistory(); }}
              className="text-xs text-text-muted hover:text-red-500 transition-colors"
            >
              Очистить всё
            </button>
          )}
        </div>

        {histEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <History className="w-10 h-10 mb-3 opacity-20" />
            <p className="text-sm">История пуста — сгенерируйте автотест, чтобы он появился здесь</p>
          </div>
        ) : (
          <div className="space-y-5">
            {HIST_GROUPS
              .map(g => [g, histEntries.filter(e => getDateGroup(e.timestamp) === g)] as [string, AutoHistEntry[]])
              .filter(([, entries]) => entries.length > 0)
              .map(([group, entries]) => (
                <div key={group}>
                  <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{group}</p>
                  <div className="bg-bg-card border border-border-main rounded-xl overflow-hidden divide-y divide-border-main">
                    {entries.map(entry => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-bg-subtle/60 cursor-pointer group transition-colors"
                        onClick={() => {
                          setFeature(entry.feature);
                          setInputText(entry.inputText);
                          setFileAttachments([]);
                          setCode(entry.code);
                          setStage("input");
                          setActiveMode("generate");
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-text-main truncate">
                            {entry.feature || "Без названия"}
                          </p>
                          <p className="text-xs text-text-muted mt-0.5">
                            {entry.inputText.slice(0, 70)}{entry.inputText.length > 70 ? "…" : ""}
                          </p>
                        </div>
                        <span className="text-xs text-text-muted flex-shrink-0">
                          {formatHistTime(entry.timestamp)}
                        </span>
                        {(() => {
                          if (entry.loadedAsEtalon) return (
                            <span className="flex-shrink-0 p-0.5 text-green-500" title="Добавлено в эталоны">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </span>
                          );
                          const st = etalonStatus[entry.id];
                          if (st === "loading") return (
                            <span className="flex-shrink-0 p-0.5 text-text-muted">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            </span>
                          );
                          if (st === "error") return (
                            <span className="flex-shrink-0 p-0.5 text-red-500" title={etalonErrorMsg[entry.id] || "Ошибка"}>
                              <XCircle className="w-3.5 h-3.5" />
                            </span>
                          );
                          return (
                            <button
                              onClick={e => handleLoadAsEtalon(entry, e)}
                              title="Загрузить в эталон автотестов"
                              className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-indigo-500 transition-opacity flex-shrink-0 p-0.5"
                            >
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            </button>
                          );
                        })()}
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            if (window.confirm("Удалить эту запись?")) deleteHistEntry(entry.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-500 transition-opacity flex-shrink-0 p-0.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );

  /* ── Input stage ────────────────────────────────────────────────── */

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="w-full">

        {/* Header */}
        <div className="flex items-start justify-between mb-4 gap-4">
          <div>
            <h1 className="text-xl font-bold text-text-main mb-1">Автотестирование</h1>
            <p className="text-sm text-text-muted">
              {activeMode === "generate"
                ? `Вставьте ручные тест-кейсы или загрузите файлы — AI изучит все источники и сгенерирует код (${TEST_TYPES[testType].framework}).`
                : "Выберите тесты в дереве и запустите — или настройте автозапуск по новым сборкам."}
            </p>
          </div>
          {activeMode === "generate" && histEntries.length > 0 && (
            <button
              onClick={() => setStage("history")}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors flex-shrink-0 mt-1"
            >
              <History className="w-3.5 h-3.5" />
              История ({histEntries.length})
            </button>
          )}
        </div>

        {/* Work mode tabs */}
        <div className="flex flex-wrap items-center gap-1.5 mb-4 p-1 bg-bg-muted rounded-xl w-full sm:w-fit">
          <button
            type="button"
            onClick={() => setActiveMode("generate")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
              activeMode === "generate"
                ? "bg-bg-card text-primary shadow-sm border border-border-main"
                : "text-text-muted hover:text-text-main"
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Генерация автотестов
          </button>
          {isSuperuser && (
            <button
              type="button"
              onClick={() => setActiveMode("run")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                activeMode === "run"
                  ? "bg-bg-card text-primary shadow-sm border border-border-main"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              <PlugZap className="w-3.5 h-3.5" />
              Запуск автотестов
            </button>
          )}
        </div>

        {activeMode === "run" && <AutotestRunPanel />}

        {activeMode === "generate" && (
          <>
        {/* Test type selector */}
        <div className="flex items-center gap-1.5 mb-4 p-1 bg-bg-muted rounded-xl w-fit">
          {(Object.keys(TEST_TYPES) as TestType[]).map(t => (
            <button
              key={t}
              onClick={() => setTestType(t)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                testType === t
                  ? "bg-bg-card text-primary shadow-sm border border-border-main"
                  : "text-text-muted hover:text-text-main"
              }`}
            >
              {TEST_TYPES[t].label}
            </button>
          ))}
        </div>

        {/* Project binding card */}
        <div className="bg-bg-card border border-border-main rounded-xl mb-4 overflow-hidden">
          <button
            type="button"
            onClick={() => setProjectOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-3 text-sm hover:bg-bg-subtle/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-indigo-500" />
              <span className="font-semibold text-text-main">Проект автотестов</span>
              {projectData && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-normal">
                  <CheckCircle className="w-3.5 h-3.5" />
                  Привязан ({projectData.build_tool})
                </span>
              )}
            </div>
            {projectOpen ? <ChevronUp className="w-4 h-4 text-text-muted" /> : <ChevronDown className="w-4 h-4 text-text-muted" />}
          </button>

          {projectOpen && (
            <div className="px-5 pb-5 border-t border-border-main pt-4">
              <p className="text-xs text-text-muted mb-3">
                Укажи путь к папке с Java/Kotlin проектом — AI проанализирует зависимости и структуру,
                чтобы сгенерировать код с правильными импортами и пакетом.
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  value={projectPath}
                  onChange={e => { setProjectPath(e.target.value); setProjectError(""); }}
                  placeholder="/Users/me/projects/my-autotests  или  C:\projects\my-autotests"
                  className="flex-1 border border-border-main rounded-lg px-3 py-2 text-sm font-mono
                    focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow"
                  onKeyDown={e => { if (e.key === "Enter") handleAnalyzeProject(); }}
                />
                <button
                  type="button"
                  onClick={handleAnalyzeProject}
                  disabled={projectLoading || !projectPath.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold
                    hover:bg-indigo-700 disabled:opacity-40 transition-all active:scale-[0.97]"
                >
                  {projectLoading
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Анализ...</>
                    : <><Search className="w-3.5 h-3.5" /> Анализировать</>}
                </button>
              </div>
              <p className="text-xs text-text-muted/70 mb-3 -mt-1">
                macOS/Linux: скопируй путь в Finder → ПКМ на папке → «Скопировать как имя пути».<br/>
                Windows: открой папку в Проводнике, нажми на адресную строку и скопируй путь.
              </p>

              {projectError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  {projectError}
                </p>
              )}

              {projectData && (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                      projectData.build_tool === "maven"  ? "bg-orange-50 border-orange-200 text-orange-700" :
                      projectData.build_tool === "gradle" ? "bg-teal-50 border-teal-200 text-teal-700" :
                      "bg-bg-muted border-border-main text-text-muted"
                    }`}>
                      {projectData.build_tool === "maven" ? "Maven" : projectData.build_tool === "gradle" ? "Gradle" : "Неизвестно"}
                    </span>
                    {projectData.test_dirs.map(d => (
                      <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-mono">
                        {d}
                      </span>
                    ))}
                    {projectData.base_packages.slice(0, 3).map(p => (
                      <span key={p} className="text-xs px-2 py-0.5 rounded-full bg-violet-50 border border-violet-200 text-violet-700 font-mono">
                        {p}
                      </span>
                    ))}
                  </div>
                  {projectData.dependencies.length > 0 && (
                    <details className="group">
                      <summary className="cursor-pointer text-xs text-text-muted hover:text-text-main list-none flex items-center gap-1">
                        <ChevronDown className="w-3 h-3 group-open:rotate-180 transition-transform" />
                        {projectData.dependencies.length} зависимостей найдено
                      </summary>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {projectData.dependencies.map(d => (
                          <span key={d} className="text-xs px-1.5 py-0.5 rounded bg-bg-muted text-text-main font-mono">
                            {d}
                          </span>
                        ))}
                      </div>
                    </details>
                  )}
                  <p className="text-xs text-green-600">
                    Проект привязан — при генерации будут использованы реальные зависимости и пакеты.
                  </p>
                  <button
                    type="button"
                    onClick={handleDetachProject}
                    className="text-xs text-text-muted hover:text-red-500 transition-colors"
                  >
                    Отвязать проект
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input card */}
        <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4">

          {/* Feature */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Фича / Модуль
            </label>
            <input
              value={feature}
              onChange={e => setFeature(e.target.value)}
              placeholder="Каталог, Оплата картой..."
              className={INPUT_CLS}
            />
          </div>

          {/* Textarea */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Ручные тест-кейсы <span className="text-red-400 normal-case font-normal">*</span>
            </label>
            <textarea
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              rows={10}
              placeholder={TEST_TYPES[testType].placeholder}
              className={`${INPUT_CLS} resize-none font-mono text-xs`}
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={handleFileChange}
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={fileLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-border-main rounded-lg
                  text-xs text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-50 transition-all duration-150"
              >
                {fileLoading
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Загружаю...</>
                  : <><Paperclip className="w-3 h-3" /> Загрузить из файла</>}
              </button>
              {fileAttachments.length > 0 && !fileLoading && fileAttachments.map((file, index) => (
                <span
                  key={`${file.name}-${index}`}
                  title={`${file.name}: ${file.text.length.toLocaleString()} симв. попадет в LLM`}
                  className="flex max-w-[260px] items-center gap-1 text-xs text-text-muted bg-bg-subtle border border-border-main rounded-lg px-2 py-1"
                >
                  <FileText className="w-3 h-3 flex-shrink-0 text-indigo-400" />
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setFileAttachments((prev) => prev.filter((_, i) => i !== index))}
                    className="ml-0.5 hover:text-red-500 transition-colors"
                    aria-label={`Убрать файл ${file.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <span className="ml-auto text-xs text-text-muted tabular-nums">
                {inputText.length.toLocaleString()} симв. в поле
                {fileAttachments.length > 0 && ` + ${fileChars.toLocaleString()} симв. из файлов`}
              </span>
            </div>
          </div>
        </div>

        {/* Error */}
        {genError && (
          <div className={`rounded-xl border p-4 mb-4 animate-slide-up ${
            genError.llm_error ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"
          }`}>
            <div className="flex items-start gap-3">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                genError.llm_error ? "bg-amber-100" : "bg-red-100"
              }`}>
                {genError.llm_error
                  ? <PlugZap className="w-4 h-4 text-amber-600" />
                  : <FlaskConical className="w-4 h-4 text-red-500" />}
              </div>
              <div>
                <p className={`text-sm font-semibold mb-1 ${genError.llm_error ? "text-amber-800" : "text-red-700"}`}>
                  {genError.llm_error ? "Ошибка LLM-провайдера" : "Ошибка"}
                </p>
                <p className={`text-sm ${genError.llm_error ? "text-amber-700" : "text-red-600"}`}>
                  {genError.message}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Code result */}
        {code && (
          <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-main">{TEST_TYPES[testType].codeLabel}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCode("")}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border-main rounded-lg
                    text-text-muted hover:bg-bg-subtle hover:text-text-main transition-all duration-150 active:scale-[0.97]"
                >
                  <FlaskConical className="w-3.5 h-3.5" /> Новая генерация
                </button>
                <button
                  onClick={async () => {
                    if (!histEntries[0]) return;
                    await handleLoadAsEtalon(histEntries[0], { stopPropagation: () => {} } as React.MouseEvent);
                  }}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg
                    transition-all duration-150 active:scale-[0.97]
                    ${histEntries[0]?.loadedAsEtalon
                      ? "bg-green-50 border-green-200 text-green-700"
                      : etalonStatus[histEntries[0]?.id] === "error"
                        ? "bg-red-50 border-red-200 text-red-600"
                        : "border-border-main text-text-muted hover:bg-bg-subtle hover:text-text-main"}`}
                  title={etalonStatus[histEntries[0]?.id] === "error"
                    ? etalonErrorMsg[histEntries[0]?.id] || "Ошибка"
                    : "Загрузить в эталон автотестов"}
                >
                  {histEntries[0]?.loadedAsEtalon
                    ? <><CheckCircle2 className="w-3.5 h-3.5" /> В эталонах</>
                    : etalonStatus[histEntries[0]?.id] === "loading"
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохраняю...</>
                      : etalonStatus[histEntries[0]?.id] === "error"
                        ? <><XCircle className="w-3.5 h-3.5" /> Ошибка</>
                        : <><BookmarkPlus className="w-3.5 h-3.5" /> В эталон</>}
                </button>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg
                    transition-all duration-150 active:scale-[0.97]
                    ${copied
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "border-border-main text-text-muted hover:bg-bg-subtle hover:text-text-main"}`}
                >
                  {copied
                    ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано!</>
                    : <><Copy className="w-3.5 h-3.5" /> Копировать</>}
                </button>
              </div>
            </div>
            <pre className="text-xs text-text-main font-mono whitespace-pre-wrap leading-relaxed
              bg-bg-subtle rounded-lg p-4 overflow-x-auto">
              {code}
            </pre>
          </div>
        )}

        {/* Bottom action row */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted flex items-center gap-1">
            {hasAutotestSource ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                {feature
                  ? <><span className="text-violet-700 font-medium">[{feature}]</span>&nbsp;готово к конвертации</>
                  : "Готово к конвертации"}
              </>
            ) : (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                Вставьте тест-кейсы или загрузите файл
              </>
            )}
          </p>
          <button
            onClick={handleGenerate}
            disabled={loading || !hasAutotestSource}
            className={`flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
              hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md
              ${!hasAutotestSource ? "opacity-40" : ""}`}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Генерирую...</>
              : <><FlaskConical className="w-4 h-4" /> Сгенерировать [{TEST_TYPES[testType].label}]</>}
          </button>
        </div>
          </>
        )}

      </div>
    </div>
  );
}
