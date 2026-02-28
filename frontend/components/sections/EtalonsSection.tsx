"use client";

import { useState, useEffect } from "react";
import {
  BookOpen, Plus, RefreshCw, Trash2, ChevronDown,
  Loader2, Smartphone, Tag, X, Save, AlignLeft, Paperclip,
} from "lucide-react";
import FileDropZone from "@/components/FileDropZone";
import { listEtalons, addEtalon, deleteEtalon, getEtalonStats, parseFile, type Etalon } from "@/lib/api";

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

export default function EtalonsSection() {
  const [items, setItems] = useState<Etalon[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterFeature, setFilterFeature] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [reqMode, setReqMode] = useState<"text" | "file">("text");
  const [reqText, setReqText] = useState("");
  const [reqFileLoading, setReqFileLoading] = useState(false);
  const [tcMode, setTcMode] = useState<"text" | "file">("text");
  const [tcText, setTcText] = useState("");
  const [tcFileLoading, setTcFileLoading] = useState(false);
  const [addPlatform, setAddPlatform] = useState("");
  const [addFeature, setAddFeature] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [res, st] = await Promise.all([
        listEtalons({ platform: filterPlatform, feature: filterFeature }),
        getEtalonStats(),
      ]);
      setItems(res.items);
      setStats(st);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [filterPlatform, filterFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleReqFile = async (file: File) => {
    setReqFileLoading(true);
    try { const r = await parseFile(file); setReqText(r.text); }
    catch (err) { alert("Ошибка: " + String(err)); }
    finally { setReqFileLoading(false); }
  };

  const handleTcFile = async (file: File) => {
    setTcFileLoading(true);
    try { const r = await parseFile(file); setTcText(r.text); }
    catch (err) { alert("Ошибка: " + String(err)); }
    finally { setTcFileLoading(false); }
  };

  const handleAdd = async () => {
    if (!reqText.trim() || !tcText.trim()) return;
    setAddLoading(true);
    try {
      await addEtalon({ req_text: reqText, tc_text: tcText, platform: addPlatform, feature: addFeature });
      setReqText(""); setTcText(""); setAddPlatform(""); setAddFeature("");
      setShowAdd(false); setReqMode("text"); setTcMode("text");
      await load();
    } catch (err) { alert("Ошибка: " + String(err)); }
    finally { setAddLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эталон?")) return;
    try {
      await deleteEtalon(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) { alert("Ошибка: " + String(err)); }
  };

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-text-main">Эталонные тест-кейсы</h1>
            <p className="text-sm text-text-muted">
              {stats.pairs ?? 0} пар · {stats.requirements ?? 0} требований
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
              hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md"
          >
            <Plus className="w-4 h-4" />
            Добавить эталон
          </button>
        </div>

        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Smartphone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}
              placeholder="Платформа..." className={`${INPUT_CLS} pl-8`} />
          </div>
          <div className="relative flex-1">
            <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input value={filterFeature} onChange={(e) => setFilterFeature(e.target.value)}
              placeholder="Фича..." className={`${INPUT_CLS} pl-8`} />
          </div>
          <button onClick={() => load(true)} disabled={refreshing}
            className="flex items-center gap-1.5 px-4 py-2 border border-border-main rounded-lg text-sm
              text-text-muted hover:bg-gray-50 hover:text-text-main transition-all duration-150 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            Обновить
          </button>
        </div>

        {showAdd && (
          <div className="bg-white border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-text-main">Новый эталон</h3>
              <button onClick={() => setShowAdd(false)}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Платформа</label>
                <input value={addPlatform} onChange={(e) => setAddPlatform(e.target.value)}
                  className={INPUT_CLS} placeholder="W, M, iPad..." />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">Фича</label>
                <input value={addFeature} onChange={(e) => setAddFeature(e.target.value)}
                  className={INPUT_CLS} placeholder="Оплата картой..." />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4 items-stretch">
              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-1.5 h-7">
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                    Требование <span className="text-red-400 normal-case font-normal">*</span>
                  </label>
                  <div className="flex rounded-md border border-border-main overflow-hidden text-[11px]">
                    <button onClick={() => setReqMode("text")}
                      className={`flex items-center gap-1 px-2 py-1 transition-colors ${reqMode === "text" ? "bg-indigo-50 text-primary font-semibold" : "text-text-muted hover:bg-gray-50"}`}>
                      <AlignLeft className="w-3 h-3" /> Текст
                    </button>
                    <button onClick={() => setReqMode("file")}
                      className={`flex items-center gap-1 px-2 py-1 border-l border-border-main transition-colors ${reqMode === "file" ? "bg-indigo-50 text-primary font-semibold" : "text-text-muted hover:bg-gray-50"}`}>
                      <Paperclip className="w-3 h-3" /> Файл
                    </button>
                  </div>
                </div>
                {reqMode === "text" ? (
                  <textarea value={reqText} onChange={(e) => setReqText(e.target.value)}
                    className={`${INPUT_CLS} resize-none flex-1 min-h-[200px]`}
                    placeholder="Текст требования..." />
                ) : (
                  <div className="flex flex-col gap-2 flex-1">
                    <FileDropZone onFile={handleReqFile} loading={reqFileLoading} className="flex-1 min-h-[168px]" />
                    {reqText && !reqFileLoading && (
                      <p className="text-[11px] text-green-700 bg-green-50 rounded-lg px-2.5 py-1.5">
                        Извлечено {reqText.length.toLocaleString()} симв.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-1.5 h-7">
                  <label className="text-xs font-semibold text-text-muted uppercase tracking-wide">
                    Тест-кейс (XML/текст) <span className="text-red-400 normal-case font-normal">*</span>
                  </label>
                  <div className="flex rounded-md border border-border-main overflow-hidden text-[11px]">
                    <button onClick={() => setTcMode("text")}
                      className={`flex items-center gap-1 px-2 py-1 transition-colors ${tcMode === "text" ? "bg-indigo-50 text-primary font-semibold" : "text-text-muted hover:bg-gray-50"}`}>
                      <AlignLeft className="w-3 h-3" /> Текст
                    </button>
                    <button onClick={() => setTcMode("file")}
                      className={`flex items-center gap-1 px-2 py-1 border-l border-border-main transition-colors ${tcMode === "file" ? "bg-indigo-50 text-primary font-semibold" : "text-text-muted hover:bg-gray-50"}`}>
                      <Paperclip className="w-3 h-3" /> Файл
                    </button>
                  </div>
                </div>
                {tcMode === "text" ? (
                  <textarea value={tcText} onChange={(e) => setTcText(e.target.value)}
                    className={`${INPUT_CLS} resize-none font-mono text-xs flex-1 min-h-[200px]`}
                    placeholder="XML или текст тест-кейса..." />
                ) : (
                  <div className="flex flex-col gap-2 flex-1">
                    <FileDropZone onFile={handleTcFile} loading={tcFileLoading} className="flex-1 min-h-[168px]" />
                    {tcText && !tcFileLoading && (
                      <p className="text-[11px] text-green-700 bg-green-50 rounded-lg px-2.5 py-1.5">
                        Извлечено {tcText.length.toLocaleString()} симв.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAdd(false)}
                className="flex items-center gap-1.5 px-4 py-2 border border-border-main rounded-lg text-sm text-text-muted hover:bg-gray-50 transition-colors">
                <X className="w-3.5 h-3.5" /> Отмена
              </button>
              <button onClick={handleAdd} disabled={addLoading || !reqText.trim() || !tcText.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                  hover:bg-primary-dark transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
                {addLoading
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохраняю...</>
                  : <><Save className="w-3.5 h-3.5" /> Сохранить</>}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-text-muted text-sm">
            <Loader2 className="w-4 h-4 animate-spin text-primary" /> Загрузка...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white border border-border-main rounded-xl p-10 text-center animate-fade-in">
            <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto mb-3">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
            <p className="text-sm font-medium text-text-main mb-1">Эталонов нет</p>
            <p className="text-xs text-text-muted">Добавьте первый эталонный тест-кейс</p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => (
              <div key={item.id}
                className="bg-white border border-border-main rounded-xl overflow-hidden hover:shadow-sm transition-shadow duration-200 animate-slide-up"
                style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <button onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                    className="flex-1 text-left min-w-0">
                    <p className="text-sm font-medium text-text-main truncate">
                      {item.req_text.slice(0, 80)}{item.req_text.length > 80 ? "..." : ""}
                    </p>
                    <div className="flex items-center gap-3 mt-0.5">
                      {item.platform && (
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <Smartphone className="w-3 h-3" />{item.platform}
                        </span>
                      )}
                      {item.feature && (
                        <span className="flex items-center gap-1 text-xs text-text-muted">
                          <Tag className="w-3 h-3" />{item.feature}
                        </span>
                      )}
                    </div>
                  </button>
                  <button onClick={() => handleDelete(item.id)}
                    className="flex items-center gap-1 text-xs text-red-400 hover:text-red-600 hover:bg-red-50
                      rounded-lg px-2.5 py-1.5 transition-all duration-150 flex-shrink-0">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ChevronDown
                    className={`w-4 h-4 text-text-muted flex-shrink-0 transition-transform duration-200 cursor-pointer
                      ${expanded === item.id ? "rotate-180" : ""}`}
                    onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  />
                </div>
                {expanded === item.id && (
                  <div className="border-t border-border-main grid grid-cols-2 gap-0 divide-x divide-border-main animate-fade-in">
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Требование</p>
                      <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed">{item.req_text}</pre>
                    </div>
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Тест-кейс</p>
                      <pre className="text-xs text-text-main whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">
                        {item.tc_text}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
