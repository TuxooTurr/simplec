"use client";

import { useState, useEffect, useRef } from "react";
import {
  BookOpen, Plus, RefreshCw, Trash2, ChevronDown,
  Loader2, Smartphone, Tag, X, Save, Paperclip, FileText,
  Code2, Bug,
} from "lucide-react";
import {
  listEtalons, addEtalon, deleteEtalon, getEtalonStats, parseFile,
  listAutotests, addAutotest, deleteAutotest,
  listDefects, addDefect, deleteDefect,
  type Etalon, type Autotest, type Defect,
} from "@/lib/api";

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow duration-150";

const LABEL_CLS = "text-xs font-semibold text-text-muted uppercase tracking-wide";

type Tab = "testcases" | "autotests" | "defects";

const ACCEPT_FILES = ".pdf,.docx,.doc,.xlsx,.xls,.xml,.png,.jpg,.jpeg,.txt";

/** Кнопка «Загрузить из файла» + чип с именем файла */
function FileAttachRow({
  loading, fileName,
  onPick, onClear,
}: {
  loading: boolean; fileName: string;
  onPick: () => void; onClear: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onPick}
        disabled={loading}
        className="flex items-center gap-1.5 px-2.5 py-1 border border-dashed border-border-main rounded-lg
          text-xs text-text-muted hover:border-primary/50 hover:text-primary disabled:opacity-50 transition-all duration-150"
      >
        {loading
          ? <><Loader2 className="w-3 h-3 animate-spin" /> Загружаю...</>
          : <><Paperclip className="w-3 h-3" /> Загрузить из файла</>}
      </button>
      {fileName && !loading && (
        <span className="flex items-center gap-1 text-xs text-text-muted bg-gray-50 border border-border-main rounded-lg px-2 py-1">
          <FileText className="w-3 h-3 flex-shrink-0 text-indigo-400" />
          {fileName}
          <button type="button" onClick={onClear} className="ml-0.5 hover:text-red-500 transition-colors">
            <X className="w-3 h-3" />
          </button>
        </span>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Тест-кейсы (существующая вкладка)
// ══════════════════════════════════════════════════════════════════════════════

function TestCasesTab() {
  const [items, setItems]               = useState<Etalon[]>([]);
  const [stats, setStats]               = useState<Record<string, number>>({});
  const [loading, setLoading]           = useState(true);
  const [filterPlatforms, setFilterPlatforms] = useState<string[]>([]);
  const [filterFeature, setFilterFeature]     = useState("");
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [refreshing, setRefreshing]     = useState(false);
  const [showAdd, setShowAdd]           = useState(false);

  const [reqText, setReqText]           = useState("");
  const [reqFileLoading, setReqFileLoading] = useState(false);
  const [reqFileName, setReqFileName]   = useState("");
  const reqFileRef = useRef<HTMLInputElement>(null);

  const [qaText, setQaText]             = useState("");
  const [qaFileLoading, setQaFileLoading]   = useState(false);
  const [qaFileName, setQaFileName]     = useState("");
  const qaFileRef = useRef<HTMLInputElement>(null);

  const [tcText, setTcText]             = useState("");
  const [tcFileLoading, setTcFileLoading]   = useState(false);
  const [tcFileName, setTcFileName]     = useState("");
  const tcFileRef = useRef<HTMLInputElement>(null);

  const [addPlatforms, setAddPlatforms] = useState<string[]>([]);
  const [addFeature, setAddFeature]     = useState("");
  const [addName, setAddName]           = useState("");
  const [addLoading, setAddLoading]     = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const [res, st] = await Promise.all([
        listEtalons({ platform: filterPlatforms.join(","), feature: filterFeature }),
        getEtalonStats(),
      ]);
      setItems(res.items);
      setStats(st);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [filterPlatforms.join(","), filterFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeInputHandler = (
    setText: (v: string) => void,
    setFileLoading: (v: boolean) => void,
    setFileName: (v: string) => void,
  ) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    setFileName(file.name);
    try { const r = await parseFile(file); setText(r.text); }
    catch (err) { alert("Ошибка: " + String(err)); setFileName(""); }
    finally { setFileLoading(false); if (e.target) e.target.value = ""; }
  };

  const handleAdd = async () => {
    if (!reqText.trim() || !tcText.trim()) return;
    setAddLoading(true);
    try {
      await addEtalon({
        req_text: reqText,
        tc_text: tcText,
        qa_doc: qaText.trim() || undefined,
        platform: addPlatforms.join(", "),
        feature: addFeature,
        name: addName,
      });
      setReqText(""); setQaText(""); setTcText("");
      setReqFileName(""); setQaFileName(""); setTcFileName("");
      setAddPlatforms([]); setAddFeature(""); setAddName("");
      setShowAdd(false);
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
    <div>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">
          {stats.pairs ?? 0} пар · {stats.requirements ?? 0} требований
        </p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
            hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm hover:shadow-md"
        >
          <Plus className="w-4 h-4" /> Добавить эталон
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {["Web", "Desktop", "iOS", "Android"].map((p) => (
          <button
            key={p}
            onClick={() => setFilterPlatforms((prev) =>
              prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
            )}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150
              ${filterPlatforms.includes(p)
                ? "border-primary bg-indigo-50 text-primary"
                : "border-border-main text-text-muted hover:border-primary/40 hover:text-text-main"}`}
          >
            {p}
          </button>
        ))}
        <div className="relative flex-1 min-w-[140px]">
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

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-main">Новый эталон</h3>
            <button onClick={() => setShowAdd(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-gray-100 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-3">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Название <span className="normal-case font-normal text-text-muted/60">(необязательно)</span></label>
            <input value={addName} onChange={(e) => setAddName(e.target.value)}
              className={INPUT_CLS} placeholder="Например: Авторизация через СберID..." />
          </div>

          <div className="mb-3">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Платформа</label>
            <div className="flex flex-wrap gap-1.5">
              {["Web", "Desktop", "iOS", "Android"].map((p) => (
                <button key={p} type="button"
                  onClick={() => setAddPlatforms((prev) =>
                    prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]
                  )}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-150
                    ${addPlatforms.includes(p)
                      ? "border-primary bg-indigo-50 text-primary"
                      : "border-border-main text-text-muted hover:border-primary/40 hover:text-text-main"}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Фича</label>
            <input value={addFeature} onChange={(e) => setAddFeature(e.target.value)}
              className={INPUT_CLS} placeholder="Оплата картой..." />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3 items-start">
            <div>
              <label className={`block ${LABEL_CLS} mb-1.5`}>
                Требование <span className="text-red-400 normal-case font-normal">*</span>
              </label>
              <input ref={reqFileRef} type="file" accept={ACCEPT_FILES} className="hidden"
                onChange={makeInputHandler(setReqText, setReqFileLoading, setReqFileName)} />
              <textarea value={reqText} onChange={(e) => setReqText(e.target.value)}
                className={`${INPUT_CLS} resize-none min-h-[160px]`}
                placeholder="Текст требования, user story..." />
              <FileAttachRow loading={reqFileLoading} fileName={reqFileName}
                onPick={() => reqFileRef.current?.click()}
                onClear={() => { setReqText(""); setReqFileName(""); }} />
            </div>

            <div>
              <label className={`block ${LABEL_CLS} mb-1.5`}>
                QA Документация
                <span className="ml-1 text-[10px] text-text-muted/60 normal-case font-normal">(необязательно)</span>
              </label>
              <input ref={qaFileRef} type="file" accept={ACCEPT_FILES} className="hidden"
                onChange={makeInputHandler(setQaText, setQaFileLoading, setQaFileName)} />
              <textarea value={qaText} onChange={(e) => setQaText(e.target.value)}
                className={`${INPUT_CLS} resize-none min-h-[160px]`}
                placeholder="Промежуточная QA документация..." />
              <FileAttachRow loading={qaFileLoading} fileName={qaFileName}
                onPick={() => qaFileRef.current?.click()}
                onClear={() => { setQaText(""); setQaFileName(""); }} />
            </div>
          </div>

          <div className="mb-4">
            <label className={`block ${LABEL_CLS} mb-1.5`}>
              XML кейсов <span className="text-red-400 normal-case font-normal">*</span>
            </label>
            <input ref={tcFileRef} type="file" accept={ACCEPT_FILES} className="hidden"
              onChange={makeInputHandler(setTcText, setTcFileLoading, setTcFileName)} />
            <textarea value={tcText} onChange={(e) => setTcText(e.target.value)}
              className={`${INPUT_CLS} resize-none font-mono text-xs min-h-[140px]`}
              placeholder="XML или текст тест-кейса..." />
            <FileAttachRow loading={tcFileLoading} fileName={tcFileName}
              onPick={() => tcFileRef.current?.click()}
              onClear={() => { setTcText(""); setTcFileName(""); }} />
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

      {/* List */}
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
                    {item.name || item.req_text.slice(0, 80) + (item.req_text.length > 80 ? "..." : "")}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {item.name && (
                      <span className="text-xs text-text-muted truncate max-w-[240px]">
                        {item.req_text.slice(0, 60)}{item.req_text.length > 60 ? "…" : ""}
                      </span>
                    )}
                    {item.platform && (
                      <span className="flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
                        <Smartphone className="w-3 h-3" />{item.platform}
                      </span>
                    )}
                    {item.feature && (
                      <span className="flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
                        <Tag className="w-3 h-3" />{item.feature}
                      </span>
                    )}
                    {item.qa_doc && (
                      <span className="flex items-center gap-1 text-xs text-indigo-400 flex-shrink-0">
                        <FileText className="w-3 h-3" />QA doc
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
                <div className="border-t border-border-main animate-fade-in">
                  <div className={`grid gap-0 divide-x divide-border-main ${item.qa_doc ? "grid-cols-2" : "grid-cols-1"}`}>
                    <div className="px-4 py-3">
                      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Требование</p>
                      <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed">{item.req_text}</pre>
                    </div>
                    {item.qa_doc && (
                      <div className="px-4 py-3">
                        <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-2">QA Документация</p>
                        <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed">{item.qa_doc}</pre>
                      </div>
                    )}
                  </div>
                  <div className="border-t border-border-main px-4 py-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">XML кейсов</p>
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
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Автотесты
// ══════════════════════════════════════════════════════════════════════════════

function AutotestsTab() {
  const [items, setItems]         = useState<Autotest[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filterFeature, setFilterFeature] = useState("");
  const [expanded, setExpanded]   = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd]     = useState(false);

  const [xmlText, setXmlText]     = useState("");
  const [xmlFileLoading, setXmlFileLoading] = useState(false);
  const [xmlFileName, setXmlFileName]   = useState("");
  const xmlFileRef = useRef<HTMLInputElement>(null);

  const [javaText, setJavaText]   = useState("");
  const [javaFileLoading, setJavaFileLoading] = useState(false);
  const [javaFileName, setJavaFileName] = useState("");
  const javaFileRef = useRef<HTMLInputElement>(null);

  const [addFeature, setAddFeature] = useState("");
  const [addName, setAddName]       = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await listAutotests({ feature: filterFeature });
      setItems(res.items);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [filterFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  const makeInputHandler = (
    setText: (v: string) => void,
    setFileLoading: (v: boolean) => void,
    setFileName: (v: string) => void,
  ) => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileLoading(true);
    setFileName(file.name);
    try { const r = await parseFile(file); setText(r.text); }
    catch (err) { alert("Ошибка: " + String(err)); setFileName(""); }
    finally { setFileLoading(false); if (e.target) e.target.value = ""; }
  };

  const handleAdd = async () => {
    if (!xmlText.trim() || !javaText.trim()) return;
    setAddLoading(true);
    try {
      await addAutotest({ xml_text: xmlText, java_text: javaText, feature: addFeature, name: addName });
      setXmlText(""); setJavaText(""); setAddFeature(""); setAddName("");
      setXmlFileName(""); setJavaFileName("");
      setShowAdd(false);
      await load();
    } catch (err) { alert("Ошибка: " + String(err)); }
    finally { setAddLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить пару автотеста?")) return;
    try {
      await deleteAutotest(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) { alert("Ошибка: " + String(err)); }
  };

  return (
    <div>
      {/* Описание */}
      <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 mb-4 text-xs text-violet-700">
        Пары <span className="font-semibold">XML мануального кейса → Java автотест</span> используются как контекст
        для LLM при автоматическом переводе тест-кейсов в автотесты.
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">{items.length} пар</p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
            hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm"
        >
          <Plus className="w-4 h-4" /> Добавить пару
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[140px]">
          <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input value={filterFeature} onChange={(e) => setFilterFeature(e.target.value)}
            placeholder="Фильтр по фиче..." className={`${INPUT_CLS} pl-8`} />
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 border border-border-main rounded-lg text-sm
            text-text-muted hover:bg-gray-50 transition-all duration-150 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-main">Новая пара автотеста</h3>
            <button onClick={() => setShowAdd(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-gray-100 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-3">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Название <span className="normal-case font-normal text-text-muted/60">(необязательно)</span></label>
            <input value={addName} onChange={(e) => setAddName(e.target.value)}
              className={INPUT_CLS} placeholder="Например: Авторизация — позитивный сценарий..." />
          </div>

          <div className="mb-4">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Фича</label>
            <input value={addFeature} onChange={(e) => setAddFeature(e.target.value)}
              className={INPUT_CLS} placeholder="Авторизация, оплата..." />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 items-start">
            {/* XML */}
            <div>
              <label className={`block ${LABEL_CLS} mb-1.5`}>
                Мануальные кейсы (XML) <span className="text-red-400 normal-case font-normal">*</span>
              </label>
              <input ref={xmlFileRef} type="file" accept={ACCEPT_FILES} className="hidden"
                onChange={makeInputHandler(setXmlText, setXmlFileLoading, setXmlFileName)} />
              <textarea value={xmlText} onChange={(e) => setXmlText(e.target.value)}
                className={`${INPUT_CLS} resize-none font-mono text-xs min-h-[200px]`}
                placeholder="<?xml version=..." />
              <FileAttachRow loading={xmlFileLoading} fileName={xmlFileName}
                onPick={() => xmlFileRef.current?.click()}
                onClear={() => { setXmlText(""); setXmlFileName(""); }} />
            </div>

            {/* Java */}
            <div>
              <label className={`block ${LABEL_CLS} mb-1.5`}>
                Java автотест <span className="text-red-400 normal-case font-normal">*</span>
              </label>
              <input ref={javaFileRef} type="file" accept={ACCEPT_FILES} className="hidden"
                onChange={makeInputHandler(setJavaText, setJavaFileLoading, setJavaFileName)} />
              <textarea value={javaText} onChange={(e) => setJavaText(e.target.value)}
                className={`${INPUT_CLS} resize-none font-mono text-xs min-h-[200px]`}
                placeholder="@Test&#10;public void testLogin() {..." />
              <FileAttachRow loading={javaFileLoading} fileName={javaFileName}
                onPick={() => javaFileRef.current?.click()}
                onClear={() => { setJavaText(""); setJavaFileName(""); }} />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)}
              className="flex items-center gap-1.5 px-4 py-2 border border-border-main rounded-lg text-sm text-text-muted hover:bg-gray-50 transition-colors">
              <X className="w-3.5 h-3.5" /> Отмена
            </button>
            <button onClick={handleAdd} disabled={addLoading || !xmlText.trim() || !javaText.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                hover:bg-primary-dark transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
              {addLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохраняю...</>
                : <><Save className="w-3.5 h-3.5" /> Сохранить</>}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Загрузка...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-border-main rounded-xl p-10 text-center animate-fade-in">
          <div className="w-12 h-12 rounded-xl bg-violet-50 flex items-center justify-center mx-auto mb-3">
            <Code2 className="w-6 h-6 text-violet-500" />
          </div>
          <p className="text-sm font-medium text-text-main mb-1">Автотестов нет</p>
          <p className="text-xs text-text-muted">Добавьте первую пару XML → Java</p>
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
                    {item.name || item.feature || "Автотест"}
                  </p>
                  <p className="text-xs text-text-muted font-mono truncate mt-0.5">
                    {item.xml_text.slice(0, 70)}{item.xml_text.length > 70 ? "…" : ""}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-violet-500 flex items-center gap-1">
                      <Code2 className="w-3 h-3" /> Java
                    </span>
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
                <div className="border-t border-border-main animate-fade-in grid grid-cols-2 divide-x divide-border-main">
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">XML (мануальный)</p>
                    <pre className="text-xs text-text-main whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">{item.xml_text}</pre>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-violet-500 uppercase tracking-wide mb-2">Java (автотест)</p>
                    <pre className="text-xs text-text-main whitespace-pre-wrap font-mono overflow-x-auto leading-relaxed">{item.java_text}</pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Дефекты
// ══════════════════════════════════════════════════════════════════════════════

function DefectsTab() {
  const [items, setItems]           = useState<Defect[]>([]);
  const [loading, setLoading]       = useState(true);
  const [filterFeature, setFilterFeature] = useState("");
  const [expanded, setExpanded]     = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd]       = useState(false);

  const [description, setDescription] = useState("");
  const [defectBody, setDefectBody]   = useState("");
  const [addFeature, setAddFeature]   = useState("");
  const [addName, setAddName]         = useState("");
  const [addLoading, setAddLoading]   = useState(false);

  const load = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await listDefects({ feature: filterFeature });
      setItems(res.items);
    } catch { /* ignore */ } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, [filterFeature]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAdd = async () => {
    if (!description.trim() || !defectBody.trim()) return;
    setAddLoading(true);
    try {
      await addDefect({ description, defect_body: defectBody, feature: addFeature, name: addName });
      setDescription(""); setDefectBody(""); setAddFeature(""); setAddName("");
      setShowAdd(false);
      await load();
    } catch (err) { alert("Ошибка: " + String(err)); }
    finally { setAddLoading(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Удалить дефект?")) return;
    try {
      await deleteDefect(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) { alert("Ошибка: " + String(err)); }
  };

  return (
    <div>
      {/* Описание */}
      <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 mb-4 text-xs text-rose-700">
        Пары <span className="font-semibold">описание дефекта → оформленный дефект</span> используются как контекст
        для LLM при форматировании новых дефектов.
      </div>

      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-text-muted">{items.length} дефектов</p>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
            hover:bg-primary-dark transition-all duration-150 active:scale-[0.98] shadow-sm"
        >
          <Plus className="w-4 h-4" /> Добавить дефект
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[140px]">
          <Tag className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
          <input value={filterFeature} onChange={(e) => setFilterFeature(e.target.value)}
            placeholder="Фильтр по фиче..." className={`${INPUT_CLS} pl-8`} />
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-1.5 px-4 py-2 border border-border-main rounded-lg text-sm
            text-text-muted hover:bg-gray-50 transition-all duration-150 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> Обновить
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="bg-white border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-text-main">Новый дефект</h3>
            <button onClick={() => setShowAdd(false)}
              className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:bg-gray-100 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mb-3">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Название <span className="normal-case font-normal text-text-muted/60">(необязательно)</span></label>
            <input value={addName} onChange={(e) => setAddName(e.target.value)}
              className={INPUT_CLS} placeholder="Например: Ошибка при оплате картой..." />
          </div>

          <div className="mb-4">
            <label className={`block ${LABEL_CLS} mb-1.5`}>Фича</label>
            <input value={addFeature} onChange={(e) => setAddFeature(e.target.value)}
              className={INPUT_CLS} placeholder="Авторизация, оплата..." />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className={`block ${LABEL_CLS} mb-1.5`}>
                Описание дефекта <span className="text-red-400 normal-case font-normal">*</span>
              </label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                className={`${INPUT_CLS} resize-none min-h-[200px]`}
                placeholder="Краткое описание: что сломано, при каких условиях..." />
            </div>
            <div>
              <label className={`block ${LABEL_CLS} mb-1.5`}>
                Дефект (оформленный) <span className="text-red-400 normal-case font-normal">*</span>
              </label>
              <textarea value={defectBody} onChange={(e) => setDefectBody(e.target.value)}
                className={`${INPUT_CLS} resize-none min-h-[200px]`}
                placeholder="Полностью оформленный дефект с шагами, ожидаемым и фактическим результатом..." />
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowAdd(false)}
              className="flex items-center gap-1.5 px-4 py-2 border border-border-main rounded-lg text-sm text-text-muted hover:bg-gray-50 transition-colors">
              <X className="w-3.5 h-3.5" /> Отмена
            </button>
            <button onClick={handleAdd} disabled={addLoading || !description.trim() || !defectBody.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold
                hover:bg-primary-dark transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]">
              {addLoading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохраняю...</>
                : <><Save className="w-3.5 h-3.5" /> Сохранить</>}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin text-primary" /> Загрузка...
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-border-main rounded-xl p-10 text-center animate-fade-in">
          <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center mx-auto mb-3">
            <Bug className="w-6 h-6 text-rose-500" />
          </div>
          <p className="text-sm font-medium text-text-main mb-1">Дефектов нет</p>
          <p className="text-xs text-text-muted">Добавьте первый эталонный дефект</p>
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
                    {item.name || item.description.slice(0, 80) + (item.description.length > 80 ? "..." : "")}
                  </p>
                  <div className="flex items-center gap-3 mt-0.5">
                    {item.name && (
                      <span className="text-xs text-text-muted truncate max-w-[240px]">
                        {item.description.slice(0, 60)}{item.description.length > 60 ? "…" : ""}
                      </span>
                    )}
                    {item.feature && (
                      <span className="flex items-center gap-1 text-xs text-text-muted flex-shrink-0">
                        <Tag className="w-3 h-3" />{item.feature}
                      </span>
                    )}
                    <span className="text-xs text-rose-500 flex items-center gap-1 flex-shrink-0">
                      <Bug className="w-3 h-3" /> дефект
                    </span>
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
                <div className="border-t border-border-main animate-fade-in grid grid-cols-2 divide-x divide-border-main">
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">Описание дефекта</p>
                    <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed">{item.description}</pre>
                  </div>
                  <div className="px-4 py-3">
                    <p className="text-xs font-semibold text-rose-500 uppercase tracking-wide mb-2">Дефект (оформленный)</p>
                    <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed">{item.defect_body}</pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// Корневой компонент с вкладками
// ══════════════════════════════════════════════════════════════════════════════

export default function EtalonsSection() {
  const [tab, setTab] = useState<Tab>("testcases");

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "testcases", label: "Тест-кейсы",  icon: <BookOpen className="w-4 h-4" /> },
    { id: "autotests", label: "Автотесты",   icon: <Code2    className="w-4 h-4" /> },
    { id: "defects",   label: "Дефекты",     icon: <Bug      className="w-4 h-4" /> },
  ];

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up">
      <div className="w-full">
        {/* Заголовок */}
        <div className="mb-5">
          <h1 className="text-xl font-bold text-text-main mb-1">Эталоны</h1>
          <p className="text-sm text-text-muted">База знаний для RAG: примеры тест-кейсов, повышающие качество генерации.</p>
        </div>

        {/* Вкладки */}
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 w-fit">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150
                ${tab === t.id
                  ? "bg-white text-text-main shadow-sm"
                  : "text-text-muted hover:text-text-main"}`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Контент */}
        {tab === "testcases" && <TestCasesTab />}
        {tab === "autotests" && <AutotestsTab />}
        {tab === "defects"   && <DefectsTab />}
      </div>
    </div>
  );
}
