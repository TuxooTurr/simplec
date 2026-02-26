"use client";

import { useState } from "react";
import type { Case, ExportResult } from "@/lib/useGeneration";

interface ExportPanelProps {
  cases: Case[];
  qaDoc: string;
  onExport: (params: ExportPanelParams) => void;
  result: ExportResult | null;
  onBack: () => void;
}

export interface ExportPanelParams {
  cases: Case[];
  qa_doc: string;
  project: string;
  system: string;
  team: string;
  domain: string;
  folder: string;
  use_llm: boolean;
  provider: string;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportPanel({ cases, qaDoc, onExport, result, onBack }: ExportPanelProps) {
  const [project, setProject] = useState("SBER911");
  const [system, setSystem] = useState("");
  const [team, setTeam] = useState("");
  const [domain, setDomain] = useState("");
  const [folder, setFolder] = useState("Новая ТМ");
  const [useLlm, setUseLlm] = useState(false);
  const [provider] = useState("gigachat");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    onExport({ cases, qa_doc: qaDoc, project, system, team, domain, folder, use_llm: useLlm, provider });
    // result will come via prop update
    setLoading(false);
  };

  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-text-muted hover:text-text-main transition-colors">
          ← Назад к кейсам
        </button>
        <h2 className="text-lg font-semibold text-text-main">Экспорт {cases.length} кейсов</h2>
      </div>

      {/* Settings card */}
      <div className="bg-white border border-border-main rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-main mb-4">Настройки Zephyr XML</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-text-muted mb-1">Проект</label>
            <input
              value={project}
              onChange={(e) => setProject(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="SBER911"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">АС / Система</label>
            <input
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Например: ЛК"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Команда</label>
            <input
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Например: Team Alpha"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1">Домен</label>
            <input
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder="Например: Платежи"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-text-muted mb-1">Папка в Zephyr</label>
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={useLlm}
            onChange={(e) => setUseLlm(e.target.checked)}
            className="rounded border-border-main text-primary focus:ring-primary/30"
          />
          <span className="text-text-muted">
            Использовать LLM для XML-шагов{" "}
            <span className="text-xs">(медленнее, но HTML-форматирование)</span>
          </span>
        </label>

        <button
          onClick={handleExport}
          disabled={loading}
          className="mt-4 w-full bg-primary text-white rounded-lg py-2.5 text-sm font-medium hover:bg-primary-dark transition-colors disabled:opacity-50"
        >
          {loading ? "Генерирую XML..." : "Сгенерировать XML"}
        </button>
      </div>

      {/* Download buttons */}
      {result && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5">
          <p className="text-sm font-semibold text-green-800 mb-3">Файлы готовы к скачиванию</p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => downloadBlob(result.xml, `test_cases_${ts}.xml`, "application/xml")}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-green-300 rounded-lg text-sm font-medium text-green-700 hover:bg-green-50 transition-colors"
            >
              Zephyr XML
            </button>
            <button
              onClick={() => downloadBlob(result.csv, `test_cases_${ts}.csv`, "text/csv")}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-green-300 rounded-lg text-sm font-medium text-green-700 hover:bg-green-50 transition-colors"
            >
              CSV таблица
            </button>
            <button
              onClick={() => downloadBlob(result.md, `test_cases_${ts}.md`, "text/markdown")}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-green-300 rounded-lg text-sm font-medium text-green-700 hover:bg-green-50 transition-colors"
            >
              Markdown
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
