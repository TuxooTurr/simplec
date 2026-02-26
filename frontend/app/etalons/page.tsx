"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import { listEtalons, addEtalon, deleteEtalon, getEtalonStats, type Etalon } from "@/lib/api";

export default function EtalonsPage() {
  const [items, setItems] = useState<Etalon[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [filterPlatform, setFilterPlatform] = useState("");
  const [filterFeature, setFilterFeature] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Add form
  const [showAdd, setShowAdd] = useState(false);
  const [reqText, setReqText] = useState("");
  const [tcText, setTcText] = useState("");
  const [addPlatform, setAddPlatform] = useState("");
  const [addFeature, setAddFeature] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [res, st] = await Promise.all([
        listEtalons({ platform: filterPlatform, feature: filterFeature }),
        getEtalonStats(),
      ]);
      setItems(res.items);
      setStats(st);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [filterPlatform, filterFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!reqText.trim() || !tcText.trim()) return;
    setAddLoading(true);
    try {
      await addEtalon({ req_text: reqText, tc_text: tcText, platform: addPlatform, feature: addFeature });
      setReqText("");
      setTcText("");
      setAddPlatform("");
      setAddFeature("");
      setShowAdd(false);
      await load();
    } catch (err) {
      alert("Ошибка: " + String(err));
    } finally {
      setAddLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить эталон?")) return;
    try {
      await deleteEtalon(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      alert("Ошибка: " + String(err));
    }
  };

  return (
    <div className="flex h-screen bg-bg-main overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6 scrollbar-thin">
        <div className="max-w-4xl">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-bold text-text-main">Эталонные тест-кейсы</h1>
              <p className="text-sm text-text-muted">
                {stats.pairs ?? 0} пар · {stats.requirements ?? 0} требований
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark transition-colors"
            >
              + Добавить эталон
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              value={filterPlatform}
              onChange={(e) => setFilterPlatform(e.target.value)}
              placeholder="Фильтр по платформе..."
              className="border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            />
            <input
              value={filterFeature}
              onChange={(e) => setFilterFeature(e.target.value)}
              placeholder="Фильтр по фиче..."
              className="border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 bg-white"
            />
            <button
              onClick={load}
              className="px-4 py-2 border border-border-main rounded-lg text-sm text-text-muted hover:bg-gray-50 transition-colors"
            >
              Обновить
            </button>
          </div>

          {/* Add form */}
          {showAdd && (
            <div className="bg-white border border-border-main rounded-xl p-5 mb-4">
              <h3 className="text-sm font-semibold text-text-main mb-3">Новый эталон</h3>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Платформа</label>
                  <input
                    value={addPlatform}
                    onChange={(e) => setAddPlatform(e.target.value)}
                    className="w-full border border-border-main rounded-lg px-3 py-2 text-sm"
                    placeholder="W, M, iPad..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Фича</label>
                  <input
                    value={addFeature}
                    onChange={(e) => setAddFeature(e.target.value)}
                    className="w-full border border-border-main rounded-lg px-3 py-2 text-sm"
                    placeholder="Оплата картой..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Требование *</label>
                  <textarea
                    value={reqText}
                    onChange={(e) => setReqText(e.target.value)}
                    rows={5}
                    className="w-full border border-border-main rounded-lg px-3 py-2 text-sm resize-none"
                    placeholder="Текст требования..."
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Тест-кейс (XML/текст) *</label>
                  <textarea
                    value={tcText}
                    onChange={(e) => setTcText(e.target.value)}
                    rows={5}
                    className="w-full border border-border-main rounded-lg px-3 py-2 text-sm resize-none font-mono text-xs"
                    placeholder="XML или текст тест-кейса..."
                  />
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAdd(false)}
                  className="px-4 py-2 border border-border-main rounded-lg text-sm text-text-muted hover:bg-gray-50"
                >
                  Отмена
                </button>
                <button
                  onClick={handleAdd}
                  disabled={addLoading || !reqText.trim() || !tcText.trim()}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-50"
                >
                  {addLoading ? "Сохраняю..." : "Сохранить"}
                </button>
              </div>
            </div>
          )}

          {/* List */}
          {loading ? (
            <p className="text-sm text-text-muted">Загрузка...</p>
          ) : items.length === 0 ? (
            <div className="bg-white border border-border-main rounded-xl p-8 text-center">
              <p className="text-text-muted text-sm">Эталонов нет. Добавьте первый!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="bg-white border border-border-main rounded-xl overflow-hidden">
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                      className="flex-1 text-left"
                    >
                      <p className="text-sm font-medium text-text-main truncate">
                        {item.req_text.slice(0, 80)}...
                      </p>
                      <p className="text-xs text-text-muted mt-0.5">
                        {item.platform && <span className="mr-2">📱 {item.platform}</span>}
                        {item.feature && <span>🏷 {item.feature}</span>}
                      </p>
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="text-red-400 hover:text-red-600 transition-colors text-sm px-2"
                    >
                      Удалить
                    </button>
                    <span className="text-text-muted">{expanded === item.id ? "▲" : "▼"}</span>
                  </div>
                  {expanded === item.id && (
                    <div className="border-t border-border-main grid grid-cols-2 gap-0 divide-x divide-border-main">
                      <div className="px-4 py-3">
                        <p className="text-xs font-semibold text-text-muted mb-2">Требование</p>
                        <pre className="text-xs text-text-main whitespace-pre-wrap">{item.req_text}</pre>
                      </div>
                      <div className="px-4 py-3">
                        <p className="text-xs font-semibold text-text-muted mb-2">Тест-кейс</p>
                        <pre className="text-xs text-text-main whitespace-pre-wrap font-mono overflow-x-auto">
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
      </main>
    </div>
  );
}
