"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import StatusPanel from "@/components/StatusPanel";
import CaseCard from "@/components/CaseCard";
import ExportPanel from "@/components/ExportPanel";
import { useGeneration } from "@/lib/useGeneration";
import { parseFile } from "@/lib/api";

type Stage = "input" | "generating" | "review" | "export";

const DEPTHS = [
  { id: "smoke", label: "Smoke (1-5 e2e кейсов)", hint: "~30–60 сек" },
  { id: "regression", label: "Regression (5-10 кейсов)", hint: "~1–3 мин" },
  { id: "full", label: "Full (11-30 кейсов)", hint: "~3–8 мин" },
  { id: "atomary", label: "Atomary (31-100 кейсов)", hint: "~10–20 мин" },
];

const PROVIDERS = [
  { id: "gigachat", label: "GigaChat" },
  { id: "deepseek", label: "DeepSeek" },
];

export default function GenerationPage() {
  const [requirement, setRequirement] = useState("");
  const [feature, setFeature] = useState("");
  const [depth, setDepth] = useState("smoke");
  const [provider, setProvider] = useState("gigachat");
  const [stage, setStage] = useState<Stage>("input");
  const [elapsedFinal, setElapsedFinal] = useState<number>(0);
  const [qaExpanded, setQaExpanded] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { state, events, progress, cases, qaDoc, start, exportCases, exportResult, reset } =
    useGeneration();

  // Sync stage with generation state
  useEffect(() => {
    if (state === "generating") setStage("generating");
    if (state === "done") {
      // Extract elapsed from last generation_done event
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    try {
      const result = await parseFile(file);
      setRequirement(result.text);
    } catch (err) {
      alert("Ошибка при парсинге файла: " + String(err));
    } finally {
      setFileLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleReset = () => {
    reset();
    setStage("input");
    setRequirement("");
    setFeature("");
    setQaExpanded(false);
  };

  // Controls in sidebar
  const sidebarControls = (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Модель</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          disabled={stage !== "input"}
          className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white disabled:opacity-50"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Глубина тестирования</label>
        <select
          value={depth}
          onChange={(e) => setDepth(e.target.value)}
          disabled={stage !== "input"}
          className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white disabled:opacity-50"
        >
          {DEPTHS.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted mt-1">
          {DEPTHS.find((d) => d.id === depth)?.hint}
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Название фичи</label>
        <input
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          disabled={stage !== "input"}
          placeholder="Например: Оплата картой"
          className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
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
          <div className="max-w-3xl">
            <h1 className="text-xl font-bold text-text-main mb-1">Генерация тест-кейсов</h1>
            <p className="text-sm text-text-muted mb-6">
              Вставьте требование или загрузите файл — AI создаст тест-кейсы для Zephyr Scale.
            </p>

            <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
              <label className="block text-xs font-medium text-text-muted mb-2">Требование</label>
              <textarea
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                placeholder="Вставьте текст требования, user story или описание функционала..."
                rows={10}
                className="w-full border border-border-main rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none font-mono"
              />
              <div className="flex items-center justify-between mt-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={fileLoading}
                  className="text-sm text-primary hover:text-primary-dark transition-colors"
                >
                  {fileLoading ? "Загрузка..." : "Загрузить файл (PDF, DOCX, XLSX, XML, TXT)"}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.docx,.doc,.xlsx,.xls,.xml,.txt"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <span className="text-xs text-text-muted">{requirement.length} симв.</span>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleGenerate}
                disabled={!requirement.trim()}
                className="px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Генерировать тест-кейсы →
              </button>
            </div>
          </div>
        )}

        {/* ───── GENERATING ───── */}
        {stage === "generating" && (
          <div className="max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-xl font-bold text-text-main">
                Генерация... {DEPTHS.find((d) => d.id === depth)?.hint}
              </h1>
            </div>
            <StatusPanel events={events} progress={progress} />
          </div>
        )}

        {/* ───── REVIEW ───── */}
        {stage === "review" && (
          <div className="max-w-3xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-text-main">
                  {state === "error" ? "Ошибка генерации" : `Готово: ${cases.length} кейсов`}
                </h1>
                {state !== "error" && elapsedFinal > 0 && (
                  <p className="text-sm text-text-muted">за {elapsedFinal}с</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleReset}
                  className="px-4 py-2 border border-border-main rounded-lg text-sm text-text-muted hover:bg-gray-50 transition-colors"
                >
                  Сбросить
                </button>
                {cases.length > 0 && (
                  <button
                    onClick={() => setStage("export")}
                    className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors"
                  >
                    Экспорт →
                  </button>
                )}
              </div>
            </div>

            {/* Status log */}
            {events.length > 0 && (
              <div className="mb-4">
                <StatusPanel events={events} progress={null} done={state === "done"} elapsed={elapsedFinal} />
              </div>
            )}

            {/* QA Doc collapsible */}
            {qaDoc && (
              <div className="mb-4 bg-white border border-border-main rounded-xl">
                <button
                  onClick={() => setQaExpanded((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-text-main hover:bg-gray-50 transition-colors rounded-xl"
                >
                  <span>QA Документация</span>
                  <span className="text-text-muted">{qaExpanded ? "▲" : "▼"}</span>
                </button>
                {qaExpanded && (
                  <div className="px-4 pb-4 border-t border-border-main">
                    <pre className="text-xs text-text-muted whitespace-pre-wrap mt-3 font-mono overflow-x-auto">
                      {qaDoc}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Cases */}
            {cases.length > 0 && (
              <div>
                <h2 className="text-sm font-semibold text-text-muted mb-2">Тест-кейсы</h2>
                {cases.map((c, i) => (
                  <CaseCard key={i} index={i + 1} case_={c} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* ───── EXPORT ───── */}
        {stage === "export" && (
          <div className="max-w-2xl">
            <ExportPanel
              cases={cases}
              qaDoc={qaDoc}
              onExport={exportCases}
              result={exportResult}
              onBack={() => setStage("review")}
            />
          </div>
        )}
      </main>
    </div>
  );
}
