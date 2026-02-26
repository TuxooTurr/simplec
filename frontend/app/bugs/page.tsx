"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import { formatBug } from "@/lib/api";

export default function BugsPage() {
  const [platform, setPlatform] = useState("Web");
  const [feature, setFeature] = useState("");
  const [description, setDescription] = useState("");
  const [provider, setProvider] = useState("gigachat");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState("");
  const [copied, setCopied] = useState(false);

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
        <div className="max-w-3xl">
          <h1 className="text-xl font-bold text-text-main mb-1">Форматирование дефектов</h1>
          <p className="text-sm text-text-muted mb-6">
            Опишите баг — AI оформит его по стандарту Jira.
          </p>

          <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="block text-xs text-text-muted mb-1">Платформа</label>
                <select
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                >
                  {["Web", "Mobile iOS", "Mobile Android", "Desktop", "API"].map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Фича</label>
                <input
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  placeholder="Оплата картой..."
                  className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">Модель</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
                >
                  <option value="gigachat">GigaChat</option>
                  <option value="deepseek">DeepSeek</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">Описание дефекта *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="Опишите, что произошло, что ожидалось, шаги воспроизведения..."
                className="w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
              />
            </div>

            <button
              onClick={handleFormat}
              disabled={loading || !description.trim()}
              className="mt-3 px-6 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors disabled:opacity-40 w-full"
            >
              {loading ? "Форматирую..." : "Оформить по стандарту Jira"}
            </button>
          </div>

          {/* Result */}
          {report && (
            <div className="bg-white border border-border-main rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-text-main">Баг-репорт</h3>
                <button
                  onClick={handleCopy}
                  className="text-sm px-3 py-1.5 border border-border-main rounded-lg text-text-muted hover:bg-gray-50 transition-colors"
                >
                  {copied ? "Скопировано!" : "Копировать"}
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
