"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, ChevronDown, RotateCcw, Download, Loader2, FileText, Clock, AlignLeft, Paperclip } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import StatusPanel from "@/components/StatusPanel";
import CaseCard from "@/components/CaseCard";
import ExportPanel from "@/components/ExportPanel";
import FileDropZone from "@/components/FileDropZone";
import { useGeneration } from "@/lib/useGeneration";
import { parseFile } from "@/lib/api";

type Stage = "input" | "generating" | "review" | "export";

const DEPTHS = [
  { id: "smoke",      label: "Smoke",      sub: "1-5 e2e кейсов",  hint: "~30–60 сек",  color: "text-emerald-600" },
  { id: "regression", label: "Regression", sub: "5-10 кейсов",     hint: "~1–3 мин",    color: "text-blue-600" },
  { id: "full",       label: "Full",       sub: "11-30 кейсов",    hint: "~3–8 мин",    color: "text-indigo-600" },
  { id: "atomary",    label: "Atomary",    sub: "31-100 кейсов",   hint: "~10–20 мин",  color: "text-violet-600" },
];

const PROVIDERS = [
  { id: "gigachat", label: "GigaChat" },
  { id: "deepseek", label: "DeepSeek" },
];

const INPUT_CLS = "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

export default function GenerationPage() {
  const [requirement, setRequirement] = useState("");
  const [feature, setFeature]         = useState("");
  const [depth, setDepth]             = useState("smoke");
  const [provider, setProvider]       = useState("gigachat");
  const [stage, setStage]             = useState<Stage>("input");
  const [elapsedFinal, setElapsedFinal] = useState<number>(0);
  const [qaExpanded, setQaExpanded]   = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [inputMode, setInputMode]     = useState<"text" | "file">("text");
  const fileRef = useRef<HTMLInputElement>(null);

  const { state, events, progress, cases, qaDoc, start, exportCases, exportResult, reset } =
    useGeneration();

  useEffect(() => {
    if (state === "generating") setStage("generating");
    if (state === "done") {
      const lastEvent = events.find((e) => e.type === "layer_done" && e.layer === 2);
      setElapsedFinal(lastEvent?.elapsed ?? 0);
      setStage("review");
    }
    if (state === "error") setStage("review");
  }, [state, events]);

  const handleGenerate = () => {
    const text = requirement.trim();
    if (!text) return;
    start({ requirement: text, feature: feature || "Feature", depth, provider });
  };

  const handleFileUpload = async (file: File) => {
    setFileLoading(true);
    try {
      const result = await parseFile(file);
      setRequirement(result.text);
    } catch (err) {
      alert("Ошибка при парсинге файла: " + String(err));
    } finally {
      setFileLoading(false);
    }
  };

  const handleReset = () => {
    reset();
    setStage("input");
    setRequirement("");
    setFeature("");
    setQaExpanded(false);
  };

  const currentDepth = DEPTHS.find((d) => d.id === depth);

  const sidebarControls = (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Модель</label>
        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => setProvider(p.id)}
              disabled={stage !== "input"}
              className={`
                px-2 py-2 rounded-lg text-xs font-medium border transition-all duration-150
                disabled:opacity-50 disabled:cursor-not-allowed
                ${provider === p.id
                  ? "border-primary bg-indigo-50 text-primary"
                  : "border-border-main bg-white text-text-muted hover:border-primary/40 hover:text-text-main"}
              `}
            >
              <div className="font-semibold">{p.label}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Глубина</label>
        <div className="grid grid-cols-2 gap-1.5">
          {DEPTHS.map((d) => (
            <button
              key={d.id}
              onClick={() => setDepth(d.id)}
              disabled={stage !== "input"}
              className={`
                px-2 py-2 rounded-lg text-xs font-medium border transition-all duration-150
                disabled:opacity-50 disabled:cursor-not-allowed
                ${depth === d.id
                  ? "border-primary bg-indigo-50 text-primary"
                  : "border-border-main bg-white text-text-muted hover:border-primary/40 hover:text-text-main"}
              `}
            >
              <div className="font-semibold">{d.label}</div>
              <div className="text-[10px] opacity-70 mt-0.5">{d.sub}</div>
            </button>
          ))}
        </div>
        {currentDepth && (
          <p className="flex items-center gap-1 text-xs text-text-muted mt-2">
            <Clock className="w-3 h-3" />
            {currentDepth.hint}
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Фича</label>
        <input
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          disabled={stage !== "input"}
          placeholder="Оплата картой..."
          className={`${INPUT_CLS} disabled:opacity-50`}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-bg-main overflow-hidden">
      <Sidebar controls={sidebarControls} />

      <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">

        {/* ───── INPUT ───── */}
        {stage === "input" && (
          <div className="max-w-3xl animate-slide-up">
            <h1 className="text-xl font-bold text-text-main mb-1">Генерация тест-кейсов</h1>
            <p className="text-sm text-text-muted mb-5">
              Вставьте требование или загрузите файл — AI создаст тест-кейсы для Zephyr Scale.
            </p>

            <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
              {/* Mode toggle */}
              <div className="flex items-center justify-between mb-3">
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide">
                  Требование
                </label>
                <div className="flex rounded-lg border border-border-main overflow-hidden text-xs">
                  <button
                    onClick={() => setInputMode("text")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors duration-150
                      ${inputMode === "text"
                        ? "bg-indigo-50 text-primary font-semibold"
                        : "text-text-muted hover:bg-gray-50"}`}
                  >
                    <AlignLeft className="w-3.5 h-3.5" />
                    Текст
                  </button>
                  <button
                    onClick={() => setInputMode("file")}
                    className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-border-main transition-colors duration-150
                      ${inputMode === "file"
                        ? "bg-indigo-50 text-primary font-semibold"
                        : "text-text-muted hover:bg-gray-50"}`}
                  >
                    <Paperclip className="w-3.5 h-3.5" />
                    Файл
                  </button>
                </div>
              </div>

              {inputMode === "text" ? (
                <>
                  <textarea
                    value={requirement}
                    onChange={(e) => setRequirement(e.target.value)}
                    placeholder="Вставьте текст требования, user story или описание функционала..."
                    rows={10}
                    className={`${INPUT_CLS} resize-none font-mono`}
                  />
                  <div className="flex justify-end mt-2">
                    <span className="text-xs text-text-muted tabular-nums">{requirement.length.toLocaleString()} симв.</span>
                  </div>
                </>
              ) : (
                <div className="space-y-3">
                  <FileDropZone
                    onFile={handleFileUpload}
                    loading={fileLoading}
                    className="h-48"
                  />
                  {requirement && !fileLoading && (
                    <p className="text-xs text-green-700 bg-green-50 rounded-lg px-3 py-2">
                      Текст извлечён: {requirement.length.toLocaleString()} симв. — готов к генерации
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleGenerate}
                disabled={!requirement.trim()}
                className="flex items-center gap-2 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold
                  hover:bg-primary-dark transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed
                  active:scale-[0.98] shadow-sm hover:shadow-md"
              >
                <Sparkles className="w-4 h-4" />
                Генерировать тест-кейсы
              </button>
            </div>
          </div>
        )}

        {/* ───── GENERATING ───── */}
        {stage === "generating" && (
          <div className="max-w-2xl animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <h1 className="text-xl font-bold text-text-main">Генерация...</h1>
              {currentDepth && (
                <span className="text-sm text-text-muted flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {currentDepth.hint}
                </span>
              )}
            </div>
            <StatusPanel events={events} progress={progress} />
          </div>
        )}

        {/* ───── REVIEW ───── */}
        {stage === "review" && (
          <div className="max-w-3xl animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-text-main">
                  {state === "error" ? "Ошибка генерации" : `${cases.length} тест-кейсов готово`}
                </h1>
                {state !== "error" && elapsedFinal > 0 && (
                  <p className="text-sm text-text-muted flex items-center gap-1 mt-0.5">
                    <Clock className="w-3.5 h-3.5" />
                    за {elapsedFinal}с
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="flex items-center gap-1.5 px-3.5 py-2 border border-border-main rounded-lg text-sm
                    text-text-muted hover:bg-gray-50 hover:text-text-main transition-all duration-150 group"
                >
                  <RotateCcw className="w-3.5 h-3.5 transition-transform group-hover:-rotate-90 duration-300" />
                  Сбросить
                </button>
                {cases.length > 0 && (
                  <button
                    onClick={() => setStage("export")}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                      hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Экспорт
                  </button>
                )}
              </div>
            </div>

            {/* Status summary */}
            {events.length > 0 && (
              <div className="mb-4">
                <StatusPanel events={events} progress={null} done={state === "done"} elapsed={elapsedFinal} />
              </div>
            )}

            {/* QA Doc collapsible */}
            {qaDoc && (
              <div className="mb-4 bg-white border border-border-main rounded-xl overflow-hidden">
                <button
                  onClick={() => setQaExpanded((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium
                    text-text-main hover:bg-gray-50/70 transition-colors group"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-text-muted" />
                    QA Документация
                  </span>
                  <ChevronDown className={`w-4 h-4 text-text-muted transition-transform duration-200 ${qaExpanded ? "rotate-180" : ""}`} />
                </button>
                {qaExpanded && (
                  <div className="px-4 pb-4 border-t border-border-main animate-fade-in">
                    <pre className="text-xs text-text-muted whitespace-pre-wrap mt-3 font-mono overflow-x-auto leading-relaxed">
                      {qaDoc}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Cases */}
            {cases.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Тест-кейсы</p>
                {cases.map((c, i) => (
                  <CaseCard
                    key={i}
                    index={i + 1}
                    case_={c}
                    className={`animate-slide-up`}
                    style={{ animationDelay: `${Math.min(i * 30, 300)}ms` } as React.CSSProperties}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ───── EXPORT ───── */}
        {stage === "export" && (
          <div className="max-w-2xl">
            <ExportPanel cases={cases} qaDoc={qaDoc} onExport={exportCases} result={exportResult} onBack={() => setStage("review")} />
          </div>
        )}
      </main>
    </div>
  );
}
