"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, RefreshCw, RotateCcw, Save } from "lucide-react";

import { Select } from "@/components/ui";
import {
  getDatagenSchema, getTcsConfig, listTestDataConnections, resetTcsConfig, saveTcsConfig,
  type DbSchemaTable, type TcsConfig, type TestDataConnection,
} from "@/lib/api";

/** Настройки сценария ТКС: какая база, какие схема и таблицы.
 *  Всё выбирается из того, что реально прочитано из БД — руками имена не вводятся. */
export default function TcsConfigPanel() {
  const [conns, setConns] = useState<TestDataConnection[]>([]);
  const [cfg, setCfg] = useState<TcsConfig | null>(null);
  const [tables, setTables] = useState<DbSchemaTable[]>([]);
  const [schemas, setSchemas] = useState<string[]>([]);
  const [schema, setSchema] = useState("");

  const [loading, setLoading] = useState(true);
  const [loadingSchema, setLoadingSchema] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [list, saved] = await Promise.all([listTestDataConnections(), getTcsConfig()]);
        setConns(list);
        setCfg(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadSchema = useCallback(async (connId: string, refresh = false) => {
    if (!connId) { setTables([]); setSchemas([]); return; }
    setLoadingSchema(true);
    setError("");
    try {
      const res = await getDatagenSchema(connId, refresh);
      setTables(res.tables);
      setSchemas(res.schemas);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTables([]); setSchemas([]);
    } finally {
      setLoadingSchema(false);
    }
  }, []);

  useEffect(() => { if (cfg?.connection_id) loadSchema(cfg.connection_id); }, [cfg?.connection_id, loadSchema]);

  // Схема берётся из сохранённой таблицы, чтобы список сразу был отфильтрован.
  useEffect(() => {
    if (!schema && cfg?.parent_table?.includes(".")) setSchema(cfg.parent_table.split(".")[0]);
  }, [cfg?.parent_table, schema]);

  const visibleTables = useMemo(
    () => (schema ? tables.filter(t => t.schema === schema) : tables),
    [tables, schema],
  );

  const columnsOf = useCallback(
    (full: string) => tables.find(t => t.full_name === full)?.columns ?? [],
    [tables],
  );

  const set = (patch: Partial<TcsConfig>) => setCfg(c => (c ? { ...c, ...patch } : c));

  const save = async () => {
    if (!cfg) return;
    setSaving(true); setError(""); setSaved(false);
    try {
      setCfg(await saveTcsConfig(cfg));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true); setError("");
    try { setCfg(await resetTcsConfig()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-sm text-text-muted py-3">
      <Loader2 className="w-4 h-4 animate-spin text-primary" /> Загрузка настроек…
    </div>
  );
  if (!cfg) return <p className="text-xs text-red-600">{error || "Не удалось загрузить настройки"}</p>;

  /** Выпадающий список колонок выбранной таблицы. */
  const columnSelect = (
    table: string, value: string, onPick: (v: string) => void, label: string, hint?: string,
  ) => {
    const cols = columnsOf(table);
    return (
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">{label}</label>
        <Select value={value} onChange={onPick} disabled={!table || !cols.length}>
          {!cols.length && <option value={value}>{value || "— выберите таблицу —"}</option>}
          {cols.map(c => (
            <option key={c.name} value={c.name}>
              {c.name} · {c.type}{c.pk ? " · PK" : ""}{c.fk ? ` → ${c.fk.table}` : ""}
            </option>
          ))}
        </Select>
        {hint && <p className="mt-1 text-[11px] text-text-muted/70">{hint}</p>}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* База и схема */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1">База данных</label>
          <Select value={cfg.connection_id} onChange={v => { set({ connection_id: v }); loadSchema(v); }}>
            <option value="">— выберите подключение —</option>
            {conns.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
          </Select>
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-text-muted">
              Схема {schemas.length > 0 && <span className="text-text-muted/60">— {schemas.length}</span>}
            </label>
            <button type="button" onClick={() => loadSchema(cfg.connection_id, true)}
              disabled={!cfg.connection_id || loadingSchema}
              title="Перечитать схему из базы"
              className="p-1 rounded text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors">
              <RefreshCw className={`w-3.5 h-3.5 ${loadingSchema ? "animate-spin" : ""}`} />
            </button>
          </div>
          <Select value={schema} onChange={setSchema} disabled={!schemas.length}>
            <option value="">— все схемы —</option>
            {schemas.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
        </div>
      </div>

      {loadingSchema && (
        <p className="flex items-center gap-2 text-xs text-text-muted">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Читаю таблицы…
        </p>
      )}

      {/* Таблица ТКС */}
      <div className="rounded-lg border border-border-main bg-bg-subtle p-3 space-y-3">
        <p className="text-xs font-semibold text-text-main">Таблица ТКС</p>
        <Select value={cfg.parent_table} onChange={v => set({ parent_table: v })}
          disabled={!visibleTables.length} searchable searchPlaceholder="Поиск таблицы…">
          {!visibleTables.length && <option value={cfg.parent_table}>{cfg.parent_table || "— нет данных —"}</option>}
          {visibleTables.map(t => <option key={t.full_name} value={t.full_name}>{t.full_name}</option>)}
        </Select>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {columnSelect(cfg.parent_table, cfg.parent_id_column, v => set({ parent_id_column: v }), "Ключ")}
          {columnSelect(cfg.parent_table, cfg.parent_label_column, v => set({ parent_label_column: v }), "Название в списке")}
          {columnSelect(cfg.parent_table, cfg.parent_count_column, v => set({ parent_count_column: v }), "Счётчик участников")}
        </div>
      </div>

      {/* Таблица участников */}
      <div className="rounded-lg border border-border-main bg-bg-subtle p-3 space-y-3">
        <p className="text-xs font-semibold text-text-main">Таблица участников</p>
        <Select value={cfg.child_table} onChange={v => set({ child_table: v })}
          disabled={!visibleTables.length} searchable searchPlaceholder="Поиск таблицы…">
          {!visibleTables.length && <option value={cfg.child_table}>{cfg.child_table || "— нет данных —"}</option>}
          {visibleTables.map(t => <option key={t.full_name} value={t.full_name}>{t.full_name}</option>)}
        </Select>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {columnSelect(cfg.child_table, cfg.child_id_column, v => set({ child_id_column: v }), "Ключ")}
          {columnSelect(cfg.child_table, cfg.child_fk_column, v => set({ child_fk_column: v }), "Ссылка на ТКС")}
          {columnSelect(cfg.child_table, cfg.child_marker_column, v => set({ child_marker_column: v }), "Поле с меткой")}
        </div>
        <p className="text-[11px] text-text-muted/70">
          По полю с меткой отличаются свои строки от чужих: удаляются только те, что начинаются
          с метки, остальные участники не трогаются.
        </p>
      </div>

      {/* Метка */}
      <div>
        <label className="block text-xs font-medium text-text-muted mb-1">Метка тестовых данных</label>
        <input
          value={cfg.marker}
          onChange={e => set({ marker: e.target.value })}
          placeholder="ТЕСТ"
          className="w-full px-2.5 py-1.5 text-sm border border-border-main rounded-lg
            bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
      </div>

      {cfg.parent_table && cfg.parent_table === cfg.child_table && (
        <p className="text-xs tone-danger border rounded-lg px-3 py-2">
          Таблица ТКС и таблица участников должны быть разными
        </p>
      )}
      {error && <p className="text-xs tone-danger border rounded-lg px-3 py-2">{error}</p>}

      <div className="flex items-center gap-2">
        <button type="button" onClick={save}
          disabled={saving || (!!cfg.parent_table && cfg.parent_table === cfg.child_table)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold
            text-white hover:bg-primary-dark disabled:opacity-40 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Сохранить
        </button>
        <button type="button" onClick={reset} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2
            text-sm text-text-muted hover:bg-bg-subtle disabled:opacity-40 transition-colors">
          <RotateCcw className="w-3.5 h-3.5" /> Сбросить
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
            <CheckCircle2 className="w-3.5 h-3.5" /> Сохранено
          </span>
        )}
      </div>
    </div>
  );
}
