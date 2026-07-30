"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, Database, Loader2, Minus, Play, Plus,
  RefreshCw, Users,
} from "lucide-react";

import { SectionSettingsButton, Select } from "@/components/ui";
import TcsSettingsModal from "@/components/settings/TcsSettingsModal";
import TestDataSettingsModal from "@/components/settings/TestDataSettingsModal";
import {
  getTcsParents, planTcsSync, runTcsSync,
  listTestDataConnections,
  type TcsParent, type TcsSyncPlan, type TestDataConnection,
} from "@/lib/api";

const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium " +
  "rounded-lg bg-primary text-white shadow-sm hover:bg-primary-dark " +
  "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const BTN_GHOST =
  "inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium " +
  "rounded-lg border border-border-main text-text-main hover:bg-bg-subtle " +
  "disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

const MAX_TARGET = 500;

type LogLine = { ts: string; kind: "ok" | "err" | "info"; text: string };

export default function TcsGeneratorSection() {
  const [connections, setConnections] = useState<TestDataConnection[]>([]);
  const [connId, setConnId] = useState("");
  const [loadingConns, setLoadingConns] = useState(true);
  const [tcsSettingsOpen, setTcsSettingsOpen] = useState(false);
  const [dbSettingsOpen, setDbSettingsOpen] = useState(false);

  const [parents, setParents] = useState<TcsParent[]>([]);
  const [parentId, setParentId] = useState("");
  const [loadingParents, setLoadingParents] = useState(false);

  const [target, setTarget] = useState(3);
  const [plan, setPlan] = useState<TcsSyncPlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [log, setLog] = useState<LogLine[]>([]);

  const addLog = (kind: LogLine["kind"], text: string) =>
    setLog(l => [{ ts: new Date().toLocaleTimeString("ru-RU"), kind, text }, ...l].slice(0, 50));

  /* ── Подключения ── */
  const loadConnections = useCallback(async () => {
    try {
      const list = await listTestDataConnections();
      setConnections(list);
      // Выбор не сбрасываем, если он ещё существует: после правки настроек
      // раздел должен остаться на той же базе.
      setConnId(prev => (list.some(c => c.id === prev) ? prev : (list[0]?.id ?? "")));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingConns(false);
    }
  }, []);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  /* ── Список ТКС ── */
  const loadParents = useCallback(async (id: string) => {
    if (!id) return;
    setLoadingParents(true);
    setError("");
    setParents([]);
    setParentId("");
    setPlan(null);
    try {
      const res = await getTcsParents(id);
      setParents(res.items);
      if (res.items.length) setParentId(String(res.items[0].id));
      addLog("info", `Загружено ТКС: ${res.items.length}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingParents(false);
    }
  }, []);

  useEffect(() => { if (connId) loadParents(connId); }, [connId, loadParents]);

  // Замысел изменился — прошлый предпросмотр больше не актуален.
  useEffect(() => { setPlan(null); }, [parentId, target]);

  const doPlan = async () => {
    if (!connId || !parentId) return;
    setPlanning(true); setError(""); setPlan(null);
    try {
      const p = await planTcsSync({ connection_id: connId, parent_id: Number(parentId), target });
      setPlan(p);
      addLog("info", `Предпросмотр: ${p.summary}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanning(false);
    }
  };

  const doRun = async () => {
    if (!connId || !parentId) return;
    setRunning(true); setError("");
    try {
      const r = await runTcsSync({ connection_id: connId, parent_id: Number(parentId), target });
      addLog("ok",
        `Готово: добавлено ${r.inserted}, удалено ${r.deleted}` +
        (r.count_updated ? `, счётчик обновлён` : ""));
      setPlan(null);
      // Число участников изменилось — перечитываем состояние.
      await doPlanSilently();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      addLog("err", msg);
    } finally {
      setRunning(false);
    }
  };

  const doPlanSilently = async () => {
    try {
      const p = await planTcsSync({ connection_id: connId, parent_id: Number(parentId), target });
      setPlan(p);
    } catch { /* необязательное обновление */ }
  };

  const selectedParent = parents.find(p => String(p.id) === parentId);
  const busy = planning || running;

  /* ── Загрузка подключений: иначе на миг мелькает пустая форма ── */
  if (loadingConns) return (
    <div className="flex items-center justify-center h-full">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );

  /* ── Нет подключений ── */
  if (connections.length === 0) return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-20">
      <div className="w-16 h-16 rounded-2xl bg-bg-subtle flex items-center justify-center mb-4">
        <Database className="w-8 h-8 text-text-muted/40" />
      </div>
      <h2 className="text-lg font-bold text-text-main mb-2">Нет подключений к базе</h2>
      <p className="text-sm text-text-muted mb-6 max-w-md">
        Генератор ТКС работает с таблицами <code className="font-mono">tcs</code> и{" "}
        <code className="font-mono">tcsmember</code>. Добавьте подключение к базе в настройках.
      </p>
      <button onClick={() => setDbSettingsOpen(true)} className={BTN_PRIMARY}>
        <Database className="w-4 h-4" /> Добавить подключение
      </button>
      <TestDataSettingsModal
        open={dbSettingsOpen}
        onClose={() => setDbSettingsOpen(false)}
        onChanged={loadConnections}
      />
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
      <div className="max-w-3xl mx-auto space-y-4">

        {/* Шапка раздела: настройки сценария всегда вверху справа */}
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-text-main">ТКС</h2>
          <div className="flex-1" />
          <SectionSettingsButton
            label="Схема и таблицы"
            title="Настройки сценария ТКС"
            onClick={() => setTcsSettingsOpen(true)}
          />
          <SectionSettingsButton
            label="Подключения"
            title="Подключения к базам данных"
            onClick={() => setDbSettingsOpen(true)}
          />
        </div>

        <TcsSettingsModal open={tcsSettingsOpen} onClose={() => setTcsSettingsOpen(false)} />
        <TestDataSettingsModal
          open={dbSettingsOpen}
          onClose={() => setDbSettingsOpen(false)}
          onChanged={loadConnections}
        />

        {/* Предупреждение: пишем в реальную базу */}
        <div className="tone-warning border rounded-xl px-4 py-3 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="leading-relaxed">
            Операция изменяет данные в базе: добавляет и удаляет строки в{" "}
            <code className="font-mono">tcsmember</code> и обновляет счётчик{" "}
            <code className="font-mono">cnt</code> в выбранной ТКС. Удаляются только участники
            с меткой <b>ТЕСТ</b> — созданные не нами строки не трогаются.
          </p>
        </div>

        {/* Подключение */}
        <div className="bg-bg-card border border-border-main rounded-xl p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
              База данных
            </label>
            <Select value={connId} onChange={setConnId} disabled={busy}>
              {connections.map(c => (
                <option key={c.id} value={c.id}>{c.display_name}</option>
              ))}
            </Select>
          </div>

          {/* ТКС */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide">
                ТКС {parents.length > 0 && <span className="normal-case font-normal text-text-muted/60">— {parents.length} шт.</span>}
              </label>
              <button onClick={() => loadParents(connId)} disabled={loadingParents || busy}
                className="p-1 rounded text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors"
                title="Обновить список">
                <RefreshCw className={`w-3.5 h-3.5 ${loadingParents ? "animate-spin" : ""}`} />
              </button>
            </div>
            {loadingParents ? (
              <div className="flex items-center gap-2 text-sm text-text-muted py-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Загружаю список…
              </div>
            ) : (
              <Select value={parentId} onChange={setParentId} disabled={busy || !parents.length}
                searchable searchPlaceholder="Поиск по названию…">
                {parents.length === 0 && <option value="">— нет записей —</option>}
                {parents.map(p => (
                  <option key={p.id} value={String(p.id)}>{p.label}</option>
                ))}
              </Select>
            )}
            {selectedParent && (
              <p className="mt-1 text-[11px] text-text-muted/70 font-mono">id = {selectedParent.id}</p>
            )}
          </div>

          {/* Количество участников */}
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
              Сколько участников должно быть
            </label>
            <div className="flex items-center gap-2">
              <button onClick={() => setTarget(t => Math.max(0, t - 1))} disabled={busy || target <= 0}
                className={BTN_GHOST} title="Меньше">
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="number" min={0} max={MAX_TARGET} value={target}
                onChange={e => setTarget(Math.max(0, Math.min(MAX_TARGET, Number(e.target.value) || 0)))}
                disabled={busy}
                className="w-24 text-center px-3 py-2 text-sm font-semibold border border-border-main rounded-lg
                  bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button onClick={() => setTarget(t => Math.min(MAX_TARGET, t + 1))} disabled={busy || target >= MAX_TARGET}
                className={BTN_GHOST} title="Больше">
                <Plus className="w-4 h-4" />
              </button>
              <div className="flex gap-1.5 ml-2">
                {[1, 3, 5, 10].map(n => (
                  <button key={n} onClick={() => setTarget(n)} disabled={busy}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                      target === n ? "border-primary bg-[var(--color-active-bg)] text-primary"
                                   : "border-border-main text-text-muted hover:border-primary/40"}`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Действия */}
          <div className="flex items-center gap-2 pt-1">
            <button onClick={doPlan} disabled={busy || !parentId} className={BTN_GHOST}>
              {planning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
              Предпросмотр
            </button>
            <button onClick={doRun} disabled={busy || !parentId || !plan} className={BTN_PRIMARY}
              title={!plan ? "Сначала посмотрите, что изменится" : undefined}>
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
              Запустить
            </button>
          </div>

          {error && (
            <p role="alert" className="text-xs tone-danger border rounded-lg px-3 py-2">{error}</p>
          )}
        </div>

        {/* Предпросмотр */}
        {plan && (
          <div className="bg-bg-card border border-border-main rounded-xl p-5 animate-fade-in">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-text-main">Что произойдёт</h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Сейчас наших", value: plan.current },
                { label: "Нужно", value: plan.target },
                { label: "Добавим", value: plan.to_insert, accent: "text-green-600 dark:text-green-400" },
                { label: "Удалим", value: plan.to_delete, accent: "text-red-600 dark:text-red-400" },
              ].map(({ label, value, accent }) => (
                <div key={label} className="bg-bg-subtle rounded-lg px-3 py-2">
                  <p className="text-[10px] text-text-muted uppercase tracking-wide">{label}</p>
                  <p className={`text-lg font-bold ${accent ?? "text-text-main"}`}>{value}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-text-muted">
              Счётчик <code className="font-mono">cnt</code> в ТКС станет{" "}
              <b className="text-text-main">{plan.count_after}</b> — это все участники, включая
              созданных не нами.
            </p>
          </div>
        )}

        {/* Журнал */}
        {log.length > 0 && (
          <div className="bg-bg-card border border-border-main rounded-xl p-5">
            <h3 className="text-sm font-semibold text-text-main mb-2">Журнал</h3>
            <div className="space-y-1 max-h-56 overflow-y-auto scrollbar-thin">
              {log.map((l, i) => (
                <div key={i} className="flex gap-2 text-xs font-mono leading-relaxed">
                  <span className="text-text-muted/60 flex-shrink-0">{l.ts}</span>
                  <span className={
                    l.kind === "ok"  ? "text-green-600 dark:text-green-400" :
                    l.kind === "err" ? "text-red-600 dark:text-red-400" : "text-text-muted"}>
                    {l.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
