"use client";

import { useState } from "react";
import { FileCode2, Table2, FileText, Download, ChevronLeft, Loader2, CheckCircle2, Sparkles } from "lucide-react";
import type { Case, ExportResult } from "@/lib/useGeneration";

interface ExportPanelProps {
  cases: Case[];
  qaDoc: string;
  onExport: (params: ExportPanelParams) => void;
  result: ExportResult | null;
  onBack: () => void;
  initialProject?: string;
  initialTeam?: string;
  initialKe?: boolean;
}

export interface ExportPanelParams {
  cases: Case[];
  qa_doc: string;
  project: string;
  system: string;
  team: string;
  ke: boolean;
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

const DOWNLOAD_BUTTONS = [
  { key: "xml", label: "Zephyr XML",  mime: "application/xml", ext: "xml", Icon: FileCode2, color: "text-indigo-600 border-indigo-200 hover:bg-indigo-50" },
  { key: "csv", label: "CSV таблица", mime: "text/csv",         ext: "csv", Icon: Table2,    color: "text-emerald-600 border-emerald-200 hover:bg-emerald-50" },
  { key: "md",  label: "Markdown",    mime: "text/markdown",    ext: "md",  Icon: FileText,  color: "text-violet-600 border-violet-200 hover:bg-violet-50" },
] as const;

export default function ExportPanel({ cases, qaDoc, onExport, result, onBack, initialProject, initialTeam, initialKe }: ExportPanelProps) {
  const [project, setProject] = useState(initialProject ?? "SBER911");
  const [system, setSystem]   = useState("");
  const [team, setTeam]       = useState(initialTeam ?? "");
  const [ke, setKe]           = useState(initialKe ?? false);
  const [domain, setDomain]   = useState("");
  const [folder, setFolder]   = useState("Новая ТМ");
  const [useLlm, setUseLlm]   = useState(false);
  const [provider]            = useState("gigachat");
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    setLoading(true);
    onExport({ cases, qa_doc: qaDoc, project, system, team, ke, domain, folder, use_llm: useLlm, provider });
    setLoading(false);
  };

  const ts = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-main transition-colors group"
        >
          <ChevronLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
          Назад
        </button>
        <span className="text-text-muted/40">·</span>
        <h2 className="text-base font-semibold text-text-main">Экспорт {cases.length} кейсов</h2>
      </div>

      {/* Settings */}
      <div className="bg-white border border-border-main rounded-xl p-5">
        <h3 className="text-sm font-semibold text-text-main mb-4 flex items-center gap-2">
          <FileCode2 className="w-4 h-4 text-text-muted" />
          Настройки Zephyr XML
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Проект",       val: project, set: setProject, ph: "SBER911" },
            { label: "АС / Система", val: system,  set: setSystem,  ph: "Например: ЛК" },
            { label: "Команда",      val: team,    set: setTeam,    ph: "Например: Team Alpha" },
            { label: "Домен",        val: domain,  set: setDomain,  ph: "Например: Платежи" },
          ].map(({ label, val, set, ph }) => (
            <div key={label}>
              <label className="block text-xs text-text-muted mb-1">{label}</label>
              <input
                value={val}
                onChange={(e) => set(e.target.value)}
                placeholder={ph}
                className="w-full border border-border-main rounded-lg px-3 py-2 text-sm
                  focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                  transition-shadow duration-150"
              />
            </div>
          ))}
          <div className="col-span-2">
            <label className="flex items-center gap-2.5 cursor-pointer group select-none" onClick={() => setKe((v) => !v)}>
              <div className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors duration-200 ${ke ? "bg-violet-600" : "bg-gray-200"}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${ke ? "translate-x-4" : "translate-x-0.5"}`} />
              </div>
              <span className="text-sm text-text-muted group-hover:text-text-main transition-colors flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                LLM-оценка критичности (КЭ)
                <span className="text-xs text-text-muted/70">
                  {ke ? "(LLM пометит кейсы как крит. для регресса)" : "(кейсы не будут помечены)"}
                </span>
              </span>
            </label>
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-text-muted mb-1">Папка в Zephyr</label>
            <input
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="w-full border border-border-main rounded-lg px-3 py-2 text-sm
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40
                transition-shadow duration-150"
            />
          </div>
        </div>

        <label className="flex items-center gap-2.5 mt-4 text-sm cursor-pointer group select-none">
          <input
            type="checkbox"
            checked={useLlm}
            onChange={(e) => setUseLlm(e.target.checked)}
            className="rounded border-border-main text-primary focus:ring-primary/30 w-4 h-4"
          />
          <span className="text-text-muted group-hover:text-text-main transition-colors flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            LLM XML-форматирование
            <span className="text-xs text-text-muted/70">(медленнее, HTML-разметка)</span>
          </span>
        </label>

        <button
          onClick={handleExport}
          disabled={loading}
          className="mt-4 w-full flex items-center justify-center gap-2 bg-primary text-white
            rounded-lg py-2.5 text-sm font-medium hover:bg-primary-dark transition-all duration-150
            disabled:opacity-50 active:scale-[0.99]"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Генерирую XML...</>
          ) : (
            <><Download className="w-4 h-4" /> Сгенерировать XML</>
          )}
        </button>
      </div>

      {/* Download buttons */}
      {result && (
        <div className="bg-white border border-border-main rounded-xl p-5 animate-slide-up">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 text-green-500 animate-success flex-shrink-0" />
            <p className="text-sm font-semibold text-text-main">Файлы готовы к скачиванию</p>
          </div>
          <div className="flex flex-wrap gap-2.5">
            {DOWNLOAD_BUTTONS.map(({ key, label, mime, ext, Icon, color }) => (
              <button
                key={key}
                onClick={() => downloadBlob(result[key as keyof ExportResult], `test_cases_${ts}.${ext}`, mime)}
                className={`flex items-center gap-2 px-4 py-2 bg-white border rounded-lg text-sm font-medium
                  transition-all duration-150 active:scale-[0.97] hover:shadow-sm ${color}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
