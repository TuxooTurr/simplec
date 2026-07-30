"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Play, Save, XCircle } from "lucide-react";

import { Modal } from "@/components/ui";
import { getSettings, saveSettings, testKafkaMetrics, type TestResult } from "@/lib/settingsApi";
import { METRICS_KAFKA_FIELDS, renderField } from "./fields";

/**
 * Настройки Kafka, из которой раздел «Метрики ОД» читает поток.
 *
 * Раньше жили только на общей странице настроек — из самого раздела попасть в них
 * было нельзя. Теперь открываются кнопкой из шапки раздела.
 */
export default function KafkaMetricsSettingsModal({ open, onClose, onSaved }: {
  open: boolean; onClose: () => void;
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const map = await getSettings();
      const vals: Record<string, string> = {};
      const descs: Record<string, string> = {};
      for (const [k, v] of Object.entries(map)) { vals[k] = v.value; descs[k] = v.description; }
      setValues(vals); setDescriptions(descs);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) { setMsg(null); load(); } }, [open, load]);

  const change = (k: string, v: string) => setValues(prev => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true); setMsg(null);
    try {
      // Сохраняем только ключи этого раздела, чтобы не перетереть чужие настройки.
      const payload: Record<string, string> = {};
      for (const f of METRICS_KAFKA_FIELDS) payload[f.key] = values[f.key] ?? "";
      await saveSettings(payload);
      await load();
      setMsg({ ok: true, text: "Сохранено" });
      onSaved?.();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setResult(null);
    try { setResult(await testKafkaMetrics()); }
    catch { setResult({ status: "red", message: "Ошибка" }); }
    finally { setTesting(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Метрики ОД — подключение к Kafka" size="max-w-xl">
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin text-primary" /> Загрузка настроек…
        </div>
      ) : (
        <div className="space-y-3">
          {METRICS_KAFKA_FIELDS.map(f => renderField(f, values, descriptions, change))}

          {result && (
            <p className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs ${
              result.status === "green" ? "tone-success" : "tone-danger"}`}>
              {result.status === "green"
                ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                : <XCircle className="h-3.5 w-3.5 shrink-0" />}
              {result.message}
            </p>
          )}
          {msg && (
            <p className={`rounded-lg border px-3 py-2 text-xs ${msg.ok ? "tone-success" : "tone-danger"}`}>
              {msg.text}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={test} disabled={testing}
              className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-2 text-sm
                text-text-main hover:bg-bg-subtle disabled:opacity-40">
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Проверить
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold
                text-white hover:bg-primary-dark disabled:opacity-40">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Сохранить
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
