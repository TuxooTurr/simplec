"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import {
  FlaskConical, Loader2, Copy, CheckCheck, Paperclip, FileText,
  PlugZap, History, ChevronLeft, BookmarkPlus, CheckCircle2, XCircle,
  Trash2, X,
} from "lucide-react";
import { generateAutotest, addAutotest, parseFile } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";

/* ── History helpers ──────────────────────────────────────────────── */

interface AutoHistEntry {
  id: string;
  timestamp: number;
  feature: string;
  inputText: string;
  code: string;
  loadedAsEtalon?: boolean;
}

const HIST_KEY = "st_automodel_history";

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

/* ── Constants ────────────────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none " +
  "focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const ACCEPT = ".txt,.md,.pdf,.docx,.doc,.xlsx,.xls,.xml";

/* ── Component ────────────────────────────────────────────────────── */

export default function AutoModelSection() {
  const { provider } = useWorkspace();

  const [stage, setStage]         = useState<"input" | "history">("input");
  const [feature, setFeature]     = useState("");
  const [inputText, setInputText] = useState("");
  const [fileName, setFileName]   = useState("");
  const [loading, setLoading]     = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [code, setCode]           = useState("");
  const [copied, setCopied]       = useState(false);
  const [genError, setGenError]   = useState<{ message: string; llm_error: boolean } | null>(null);

  const [histEntries, setHistEntries] = useState<AutoHistEntry[]>(() => loadHistory());
  const [etalonStatus, setEtalonStatus] = useState<Record<string, "loading" | "done" | "error">>({});

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
    } catch {
      setEtalonStatus(prev => ({ ...prev, [entry.id]: "error" }));
      setTimeout(() => setEtalonStatus(prev => {
        const next = { ...prev };
        delete next[entry.id];
        return next;
      }), 3000);
    }
  }, []);

  /* ── File upload ─────────────────────────────────────────────────── */

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    setFileName(file.name);
    setGenError(null);
    try {
      const res = await parseFile(file);
      setInputText(res.text);
    } catch (err) {
      setGenError({ message: String(err), llm_error: false });
    } finally {
      setFileLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  /* ── Generate ────────────────────────────────────────────────────── */

  const handleGenerate = async () => {
    if (!inputText.trim()) return;
    setLoading(true);
    setCode("");
    setGenError(null);
    try {
      const res = await generateAutotest({ cases: inputText, feature, provider });
      setCode(res.code);
      saveHistEntry({
        id: Date.now().toString(),
        timestamp: Date.now(),
        feature,
        inputText,
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
                  <div className="bg-white border border-border-main rounded-xl overflow-hidden divide-y divide-border-main">
                    {entries.map(entry => (
                      <div
                        key={entry.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/60 cursor-pointer group transition-colors"
                        onClick={() => {
                          setFeature(entry.feature);
                          setInputText(entry.inputText);
                          setCode(entry.code);
                          setStage("input");
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
                            <span className="flex-shrink-0 p-0.5 text-red-500" title="Ошибка">
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
        <div className="flex items-start justify-between mb-5 gap-4">
          <div>
            <h1 className="text-xl font-bold text-text-main mb-1">Автотестирование</h1>
            <p className="text-sm text-text-muted">
              Вставьте ручные тест-кейсы — AI сгенерирует Java-класс (JUnit 5 + Selenide).
            </p>
          </div>
          {histEntries.length > 0 && (
            <button
              onClick={() => setStage("history")}
              className="flex items-center gap-1.5 text-xs text-text-muted hover:text-primary transition-colors flex-shrink-0 mt-1"
            >
              <History className="w-3.5 h-3.5" />
              История ({histEntries.length})
            </button>
          )}
        </div>

        {/* Input card */}
        <div className="bg-white border border-border-main rounded-xl p-5 mb-4">

          {/* Feature */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
              Фича / Модуль
            </label>
            <input
              value={feature}
              onChange={e => setFeature(e.target.value)}
              placeholder="Авторизация, Оплата картой..."
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
              placeholder={"Вставьте ручные тест-кейсы в любом формате:\n\n1. Тест: Авторизация\n   Шаг 1: Открыть страницу входа\n   Шаг 2: Ввести логин и пароль\n   Шаг 3: Нажать «Войти»\n   Ожидаемый результат: Пользователь авторизован\n\n2. Тест: Неверный пароль\n   ..."}
              className={`${INPUT_CLS} resize-none font-mono text-xs`}
            />
            <input
              ref={fileInputRef}
              type="file"
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
              {fileName && !fileLoading && (
                <span className="flex items-center gap-1 text-xs text-text-muted bg-gray-50 border border-border-main rounded-lg px-2 py-1">
                  <FileText className="w-3 h-3 flex-shrink-0 text-indigo-400" />
                  {fileName}
                  <button
                    type="button"
                    onClick={() => { setFileName(""); setInputText(""); }}
                    className="ml-0.5 hover:text-red-500 transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
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
          <div className="bg-white border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-text-main">Java-код</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCode("")}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border-main rounded-lg
                    text-text-muted hover:bg-gray-50 hover:text-text-main transition-all duration-150 active:scale-[0.97]"
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
                      : "border-border-main text-text-muted hover:bg-gray-50 hover:text-text-main"}`}
                  title="Загрузить в эталон автотестов"
                >
                  {histEntries[0]?.loadedAsEtalon
                    ? <><CheckCircle2 className="w-3.5 h-3.5" /> В эталонах</>
                    : etalonStatus[histEntries[0]?.id] === "loading"
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохраняю...</>
                      : <><BookmarkPlus className="w-3.5 h-3.5" /> В эталон</>}
                </button>
                <button
                  onClick={handleCopy}
                  className={`flex items-center gap-1.5 text-sm px-3 py-1.5 border rounded-lg
                    transition-all duration-150 active:scale-[0.97]
                    ${copied
                      ? "bg-green-50 border-green-200 text-green-700"
                      : "border-border-main text-text-muted hover:bg-gray-50 hover:text-text-main"}`}
                >
                  {copied
                    ? <><CheckCheck className="w-3.5 h-3.5" /> Скопировано!</>
                    : <><Copy className="w-3.5 h-3.5" /> Копировать</>}
                </button>
              </div>
            </div>
            <pre className="text-xs text-text-main font-mono whitespace-pre-wrap leading-relaxed
              bg-gray-50 rounded-lg p-4 overflow-x-auto">
              {code}
            </pre>
          </div>
        )}

        {/* Bottom action row */}
        <div className="flex items-center justify-between">
          <p className="text-xs text-text-muted flex items-center gap-1">
            {inputText.trim() ? (
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
            disabled={loading || !inputText.trim()}
            className={`flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
              hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md
              ${!inputText.trim() ? "opacity-40" : ""}`}
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Генерирую...</>
              : <><FlaskConical className="w-4 h-4" /> Сгенерировать Java-код</>}
          </button>
        </div>

      </div>
    </div>
  );
}
