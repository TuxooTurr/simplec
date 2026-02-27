"use client";

import { useState } from "react";
import { Bug, Loader2, Copy, CheckCheck, Globe, Smartphone, Monitor, Terminal } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import { formatBug } from "@/lib/api";

const PLATFORMS = [
  { id: "Web",            label: "Web",            Icon: Globe },
  { id: "Mobile iOS",     label: "iOS",            Icon: Smartphone },
  { id: "Mobile Android", label: "Android",        Icon: Smartphone },
  { id: "Desktop",        label: "Desktop",        Icon: Monitor },
  { id: "API",            label: "API",            Icon: Terminal },
];

const INPUT_CLS = "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

export default function BugsPage() {
  const [platform, setPlatform]       = useState("Web");
  const [feature, setFeature]         = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider]       = useState("gigachat");
  const [loading, setLoading]         = useState(false);
  const [report, setReport]           = useState("");
  const [copied, setCopied]           = useState(false);

  const handleFormat = async () => {
    if (!description.trim()) return;
    setLoading(true);
    setReport("");
    try {
      const res = await formatBug({ platform, feature, description, provider });
      setReport(res.report);
    } catch (err) {
      setReport("Ошибка: " + String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-screen bg-bg-main overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <div className="max-w-3xl animate-slide-up">
          <h1 className="text-xl font-bold text-text-main mb-1">Форматирование дефектов</h1>
          <p className="text-sm text-text-muted mb-5">
            Опишите баг — AI оформит его по стандарту Jira.
          </p>

          <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
            {/* Platform picker */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Платформа</label>
              <div className="flex flex-wrap gap-2">
                {PLATFORMS.map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setPlatform(id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border
                      transition-all duration-150
                      ${platform === id
                        ? "border-primary bg-indigo-50 text-primary"
                        : "border-border-main text-text-muted hover:border-primary/40 hover:text-text-main"}`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Фича</label>
                <input
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  placeholder="Оплата картой..."
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Модель</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className={`${INPUT_CLS} bg-white`}
                >
                  <option value="gigachat">GigaChat</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                Описание дефекта <span className="text-red-400 normal-case font-normal">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="Опишите, что произошло, что ожидалось, шаги воспроизведения..."
                className={`${INPUT_CLS} resize-none`}
              />
            </div>

            <button
              onClick={handleFormat}
              disabled={loading || !description.trim()}
              className="w-full flex items-center justify-center gap-2 px-6 py-2.5 bg-primary text-white
                rounded-lg text-sm font-semibold hover:bg-primary-dark transition-all duration-150
                disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.99] shadow-sm"
            >
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Форматирую...</>
                : <><Bug className="w-4 h-4" /> Оформить по стандарту Jira</>
              }
            </button>
          </div>

          {/* Result */}
          {report && (
            <div className="bg-white border border-border-main rounded-xl p-5 animate-slide-up">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-text-main">Баг-репорт</h3>
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
                    : <><Copy className="w-3.5 h-3.5" /> Копировать</>
                  }
                </button>
              </div>
              <pre className="text-sm text-text-main whitespace-pre-wrap font-sans leading-relaxed">
                {report}
              </pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
