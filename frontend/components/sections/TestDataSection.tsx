"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Database, Search, Sparkles, Play, Copy, CheckCheck,
  Loader2, AlertTriangle, ChevronDown, FileCode, Download,
  RefreshCw, X, Table2, Server,
} from "lucide-react";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import {
  listTestDataConnections,
  executeTestDataQuery,
  generateTestDataQuery,
  suggestTestDataScript,
  type TestDataConnection,
  type TestDataQueryResult,
} from "@/lib/api";

/* ── Style constants ────────────────────────────────────────────── */

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

const BTN_PRIMARY =
  "flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg " +
  "hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_SECONDARY =
  "flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border-main rounded-lg " +
  "text-text-main hover:bg-bg-subtle hover:border-primary/40 disabled:opacity-50 transition-all";

const DB_TYPE_COLORS: Record<string, string> = {
  postgresql: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  mysql:      "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  oracle:     "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};

/* ── Helpers ─────────────────────────────────────────────────────── */

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function formatRowCount(n: number): string {
  if (n === 0) return "0 строк";
  if (n === 1) return "1 строка";
  if (n >= 2 && n <= 4) return `${n} строки`;
  return `${n} строк`;
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════ */

export default function TestDataSection() {
  const { provider } = useWorkspace();

  // ── Connections ─────────────────────────────────────────────────
  const [connections, setConnections] = useState<TestDataConnection[]>([]);
  const [selectedConns, setSelectedConns] = useState<Set<string>>(new Set());
  const [connLoading, setConnLoading] = useState(true);
  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadConnections = useCallback(async () => {
    setConnLoading(true);
    try {
      const conns = await listTestDataConnections();
      setConnections(conns);
      // Auto-select all connections with cached schema
      const withSchema = conns.filter(c => c.cached_schema).map(c => c.id);
      if (withSchema.length > 0) setSelectedConns(new Set(withSchema));
    } catch { /* backend unavailable */ }
    finally { setConnLoading(false); }
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setConnDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function toggleConn(id: string) {
    setSelectedConns(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // ── Query ──────────────────────────────────────────────────────
  const [queryText, setQueryText] = useState("");
  const [naturalQuery, setNaturalQuery] = useState("");
  const [queryMode, setQueryMode] = useState<"sql" | "natural">("natural");
  const [executing, setExecuting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<Record<string, TestDataQueryResult> | null>(null);
  const [queryError, setQueryError] = useState("");

  // ── Script suggestion ──────────────────────────────────────────
  const [suggestedScript, setSuggestedScript] = useState("");
  const [scriptGenerating, setScriptGenerating] = useState(false);
  const [scriptCopied, setScriptCopied] = useState(false);

  // ── History ────────────────────────────────────────────────────
  const [history, setHistory] = useState<{ query: string; mode: "sql" | "natural"; ts: number }[]>([]);

  const selectedConnIds = Array.from(selectedConns);
  const hasSelectedConns = selectedConnIds.length > 0;
  const hasSchema = connections.some(c => selectedConns.has(c.id) && c.cached_schema);

  // ── Execute SQL query ──────────────────────────────────────────
  async function handleExecuteSQL() {
    if (!queryText.trim() || !hasSelectedConns) return;
    setExecuting(true); setQueryError(""); setResults(null); setSuggestedScript("");
    try {
      const res = await executeTestDataQuery({ connection_ids: selectedConnIds, sql: queryText });
      setResults(res.results);
      setHistory(prev => [{ query: queryText, mode: "sql", ts: Date.now() }, ...prev.slice(0, 19)]);
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : String(e));
    } finally { setExecuting(false); }
  }

  // ── Generate SQL from natural language ─────────────────────────
  async function handleGenerateAndExecute() {
    if (!naturalQuery.trim() || !hasSelectedConns || !provider) return;
    setGenerating(true); setQueryError(""); setResults(null); setSuggestedScript("");
    try {
      const gen = await generateTestDataQuery({
        connection_ids: selectedConnIds,
        requirement: naturalQuery,
        provider,
      });
      setQueryText(gen.sql);

      // Execute the generated query
      const res = await executeTestDataQuery({ connection_ids: selectedConnIds, sql: gen.sql });
      setResults(res.results);
      setHistory(prev => [{ query: naturalQuery, mode: "natural", ts: Date.now() }, ...prev.slice(0, 19)]);
    } catch (e) {
      setQueryError(e instanceof Error ? e.message : String(e));
    } finally { setGenerating(false); }
  }

  // ── Suggest insert script ──────────────────────────────────────
  async function handleSuggestScript() {
    if (!hasSelectedConns || !provider) return;
    setScriptGenerating(true);
    try {
      const req = naturalQuery.trim() || queryText.trim() || "тестовые данные";
      const res = await suggestTestDataScript({
        connection_ids: selectedConnIds,
        requirement: req,
        provider,
      });
      setSuggestedScript(res.script);
    } catch (e) {
      setSuggestedScript(`-- Ошибка генерации скрипта: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setScriptGenerating(false); }
  }

  // ── Check if results are empty ─────────────────────────────────
  const totalRows = results
    ? Object.values(results).reduce((sum, r) => sum + (r.row_count ?? 0), 0)
    : -1;

  // ── Copy ───────────────────────────────────────────────────────
  function copyScript() {
    navigator.clipboard.writeText(suggestedScript);
    setScriptCopied(true);
    setTimeout(() => setScriptCopied(false), 2000);
  }

  /* ═══════════════════════════════════════════════════════════════
     RENDER
  ═══════════════════════════════════════════════════════════════ */

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
          <Database className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-text-main">Тестовые данные</h1>
          <p className="text-sm text-text-muted">Поиск данных во внешних БД. Только SELECT-запросы.</p>
        </div>
      </div>

      {/* Connection selector */}
      <div className="bg-bg-card rounded-xl border border-border-main p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className={LABEL_CLS}>Базы данных</label>
          <button onClick={loadConnections} className="text-text-muted hover:text-primary transition-colors" title="Обновить список">
            <RefreshCw className={`w-3.5 h-3.5 ${connLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {connLoading ? (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="w-4 h-4 animate-spin" /> Загрузка подключений...
          </div>
        ) : connections.length === 0 ? (
          <div className="text-sm text-text-muted py-4 text-center">
            <Server className="w-8 h-8 mx-auto mb-2 text-text-muted/40" />
            Нет подключений. Добавьте базы данных в{" "}
            <a href="/settings" className="text-primary hover:underline">Настройках</a>.
          </div>
        ) : (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setConnDropdownOpen(p => !p)}
              className={`${INPUT_CLS} flex items-center justify-between cursor-pointer text-left`}
            >
              <span className="truncate">
                {selectedConns.size === 0
                  ? "Выберите базы данных..."
                  : connections
                      .filter(c => selectedConns.has(c.id))
                      .map(c => c.display_name)
                      .join(", ")}
              </span>
              <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${connDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {connDropdownOpen && (
              <div className="absolute z-20 mt-1 w-full bg-bg-card border border-border-main rounded-lg shadow-lg overflow-hidden">
                {connections.map(c => {
                  const checked = selectedConns.has(c.id);
                  const hasSchema = !!c.cached_schema;
                  const dbColor = DB_TYPE_COLORS[c.db_type] ?? "bg-bg-muted text-text-main";
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-bg-subtle transition-colors
                        ${checked ? "bg-primary/5" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleConn(c.id)}
                        className="w-4 h-4 rounded border-border-main text-primary focus:ring-primary/30"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-main truncate">{c.display_name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${dbColor}`}>
                            {c.db_type.toUpperCase()}
                          </span>
                          {!hasSchema && (
                            <span className="text-[10px] text-yellow-600 bg-yellow-50 px-1.5 py-0.5 rounded">
                              нет схемы
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-text-muted truncate">{c.host}:{c.port}/{c.db_name}</p>
                      </div>
                      {hasSchema && (
                        <span className="text-[10px] text-green-600 whitespace-nowrap">
                          {Object.keys(c.cached_schema!).length} таблиц
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Query panel */}
      <div className="bg-bg-card rounded-xl border border-border-main p-4 space-y-4">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 bg-bg-muted rounded-lg p-0.5 w-fit">
          <button
            onClick={() => setQueryMode("natural")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${queryMode === "natural" ? "bg-bg-card text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}
          >
            <Sparkles className="w-3.5 h-3.5" /> Запрос на языке
          </button>
          <button
            onClick={() => setQueryMode("sql")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors
              ${queryMode === "sql" ? "bg-bg-card text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}
          >
            <FileCode className="w-3.5 h-3.5" /> SQL
          </button>
        </div>

        {queryMode === "natural" ? (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>Что нужно найти?</label>
              <textarea
                className={INPUT_CLS + " min-h-[80px] resize-y"}
                value={naturalQuery}
                onChange={e => setNaturalQuery(e.target.value)}
                placeholder="Найти пользователей с балансом больше 10 000, зарегистрированных в 2024 году..."
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerateAndExecute}
                disabled={generating || !naturalQuery.trim() || !hasSelectedConns || !provider || !hasSchema}
                className={BTN_PRIMARY}
              >
                {generating
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Генерация и поиск...</>
                  : <><Sparkles className="w-4 h-4" /> Найти данные</>}
              </button>
              {!provider && <span className="text-xs text-yellow-600">Выберите LLM-провайдер</span>}
              {!hasSchema && hasSelectedConns && (
                <span className="text-xs text-yellow-600">У выбранных БД нет схемы. Выполните introspect в Настройках.</span>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS}>SQL-запрос (только SELECT)</label>
              <textarea
                className={INPUT_CLS + " min-h-[100px] resize-y font-mono text-xs"}
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                placeholder="SELECT * FROM users WHERE balance > 10000 LIMIT 50"
                spellCheck={false}
              />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleExecuteSQL}
                disabled={executing || !queryText.trim() || !hasSelectedConns}
                className={BTN_PRIMARY}
              >
                {executing
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Выполнение...</>
                  : <><Play className="w-4 h-4" /> Выполнить</>}
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {queryError && (
          <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span className="break-all">{queryError}</span>
          </div>
        )}

        {/* Generated SQL preview */}
        {queryMode === "natural" && queryText && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-text-muted">Сгенерированный SQL:</p>
            <pre className="bg-bg-subtle border border-border-main rounded-lg p-3 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap">
              {queryText}
            </pre>
          </div>
        )}
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {Object.entries(results).map(([connId, result]) => {
            const conn = connections.find(c => c.id === connId);
            const dbName = result.db_name ?? conn?.display_name ?? connId;
            const hasError = !!result.error;
            const isEmpty = !hasError && result.row_count === 0;

            return (
              <div key={connId} className="bg-bg-card rounded-xl border border-border-main overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border-main bg-bg-subtle/50">
                  <Table2 className="w-4 h-4 text-text-muted" />
                  <span className="text-sm font-medium text-text-main">{dbName}</span>
                  {!hasError && (
                    <span className={`text-xs px-2 py-0.5 rounded-full ${isEmpty ? "bg-yellow-50 text-yellow-600" : "bg-green-50 text-green-600"}`}>
                      {formatRowCount(result.row_count)}
                    </span>
                  )}
                  {!hasError && result.row_count > 0 && (
                    <button
                      onClick={() => {
                        const csv = [result.columns.join(","), ...result.rows.map(r => r.map(v => `"${String(v ?? "")}"`).join(","))].join("\n");
                        downloadBlob(csv, `${dbName}_result.csv`, "text/csv");
                      }}
                      className="ml-auto text-xs text-text-muted hover:text-primary flex items-center gap-1"
                    >
                      <Download className="w-3 h-3" /> CSV
                    </button>
                  )}
                </div>

                {hasError ? (
                  <div className="p-4 text-sm text-red-600 bg-red-50/50">
                    <AlertTriangle className="w-4 h-4 inline mr-1.5" />
                    {result.error}
                  </div>
                ) : isEmpty ? (
                  <div className="p-6 text-center text-sm text-text-muted">
                    Данные не найдены
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-bg-subtle sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-text-muted font-medium border-b border-border-main w-8">#</th>
                          {result.columns.map(col => (
                            <th key={col} className="px-3 py-2 text-left text-text-muted font-medium border-b border-border-main whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, ri) => (
                          <tr key={ri} className="hover:bg-bg-subtle/50 border-b border-border-main/50 last:border-0">
                            <td className="px-3 py-1.5 text-text-muted">{ri + 1}</td>
                            {row.map((val, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-text-main whitespace-nowrap max-w-[300px] truncate" title={String(val ?? "")}>
                                {val === null ? <span className="text-text-muted italic">NULL</span> : String(val)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}

          {/* Suggest script if no data found */}
          {totalRows === 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-yellow-800">
                <AlertTriangle className="w-4 h-4" />
                Данные не найдены ни в одной из выбранных БД
              </div>
              <p className="text-xs text-yellow-700">
                Система может предложить SQL-скрипт для создания тестовых данных.
                Скрипт <strong>НЕ будет выполнен автоматически</strong> — вы сможете проверить и запустить его вручную.
              </p>
              <button
                onClick={handleSuggestScript}
                disabled={scriptGenerating || !provider}
                className={BTN_SECONDARY + " border-yellow-300 hover:border-yellow-400 text-yellow-800 hover:bg-yellow-100"}
              >
                {scriptGenerating
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Генерация скрипта...</>
                  : <><FileCode className="w-3.5 h-3.5" /> Предложить скрипт создания данных</>}
              </button>
            </div>
          )}

          {/* Suggested script */}
          {suggestedScript && (
            <div className="bg-bg-card rounded-xl border border-border-main overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border-main bg-amber-50/50">
                <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                  <FileCode className="w-4 h-4" />
                  Скрипт создания данных (НЕ выполнен)
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={copyScript} className={BTN_SECONDARY}>
                    {scriptCopied ? <><CheckCheck className="w-3 h-3 text-green-600" /> Скопировано</> : <><Copy className="w-3 h-3" /> Копировать</>}
                  </button>
                  <button
                    onClick={() => downloadBlob(suggestedScript, "testdata_script.sql", "text/sql")}
                    className={BTN_SECONDARY}
                  >
                    <Download className="w-3 h-3" /> .sql
                  </button>
                  <button onClick={() => setSuggestedScript("")} className="p-1 text-text-muted hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <pre className="p-4 text-xs font-mono text-text-main overflow-x-auto whitespace-pre-wrap max-h-[400px] overflow-y-auto bg-bg-subtle/50">
                {suggestedScript}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Query history */}
      {history.length > 0 && (
        <div className="bg-bg-card rounded-xl border border-border-main p-4">
          <div className="flex items-center justify-between mb-3">
            <label className={LABEL_CLS}>История запросов</label>
            <button onClick={() => setHistory([])} className="text-xs text-text-muted hover:text-red-500">
              Очистить
            </button>
          </div>
          <div className="space-y-1">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => {
                  if (h.mode === "sql") { setQueryMode("sql"); setQueryText(h.query); }
                  else { setQueryMode("natural"); setNaturalQuery(h.query); }
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-bg-subtle transition-colors group"
              >
                <div className="flex items-center gap-2">
                  {h.mode === "sql" ? <FileCode className="w-3 h-3 text-text-muted" /> : <Sparkles className="w-3 h-3 text-text-muted" />}
                  <span className="text-xs text-text-main truncate flex-1 group-hover:text-primary">{h.query}</span>
                  <span className="text-[10px] text-text-muted">
                    {new Date(h.ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
