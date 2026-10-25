"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Plug, Save, Upload } from "lucide-react";
import { BTN, BTN_PRIMARY, INPUT } from "@/components/incidents/ui";
import { listKafkaConnections, testKafkaConnection, type KafkaConnection } from "@/lib/kafkaApi";
import { listTestDataConnections, type TestDataConnection } from "@/lib/api";
import { getIncState, importIncFile, saveIncSettings, type IncSettings } from "@/lib/incidentGenApi";

const LABEL = "block text-xs font-medium text-text-muted mb-1";
const SQL_PARAMS = ["incident_sm_id", "incident_instruction", "system_cis", "incident_technical_description", "incident_short_description",
  "incident_summarization", "instruction_req_uuid", "sberesm_uuid", "monitoring_system_ci", "monitoring_system_name",
  "user_id", "user_name", "user_employee_number"];

/**
 * Настройки генератора: куда слать (подключение из «Просмотра Kafka», топик, партиция), поля сообщения от команды
 * (исполнитель, система-источник) и запись инструкций (подключение из «Тестовых данных» и SQL-шаблон).
 */
export default function IncidentGenSettings({ initial, onSaved }: { initial: IncSettings; onSaved: (s: IncSettings, blocked: string) => void }) {
  const [s, setS] = useState(initial);
  const [kafka, setKafka] = useState<KafkaConnection[]>([]);
  const [dbs, setDbs] = useState<TestDataConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** test_sql_templates.json из набора ноутбука → SQL-шаблон инструкции (create_incident_instruction). */
  const importSql = async (f: File | undefined) => {
    if (!f) return;
    setMsg(null);
    try {
      const r = await importIncFile(f);
      if (r.kind !== "sql") { setMsg({ ok: false, text: "В файле нет create_incident_instruction — нужен test_sql_templates.json" }); return; }
      const st = await getIncState();
      setS(x => ({ ...x, instruction_sql: st.settings.instruction_sql }));
      onSaved(st.settings, st.instructionsBlocked);
      setMsg({ ok: true, text: "SQL-шаблон загружен из файла" });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  useEffect(() => {
    listKafkaConnections().then(setKafka, () => undefined);
    listTestDataConnections().then(setDbs, () => undefined);
  }, []);
  const set = (patch: Partial<IncSettings>) => { setS(x => ({ ...x, ...patch })); setMsg(null); if ("kafka_connection_id" in patch) setTestMsg(null); };
  const params = Array.from(new Set((s.instruction_sql.match(/\{(\w+)\}/g) ?? []).map(x => x.slice(1, -1))));

  const save = async () => {
    setBusy(true); setMsg(null);
    try { const r = await saveIncSettings(s); onSaved(r.settings, r.instructionsBlocked); setMsg({ ok: true, text: "Сохранено" }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
    setBusy(false);
  };
  const test = async () => {
    setTesting(true); setTestMsg(null);
    try {
      const r = await testKafkaConnection(s.kafka_connection_id);
      setTestMsg({ ok: true, text: `Kafka отвечает · топиков: ${r.topics_count}` });
    } catch (e) { setTestMsg({ ok: false, text: (e as Error).message }); }
    setTesting(false);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-main">Куда отправлять</h3>
        <div className="grid grid-cols-[1fr_1fr_110px] gap-3">
          <label className="block"><span className={LABEL}>Подключение Kafka (из «Просмотра Kafka»)</span>
            <select value={s.kafka_connection_id} onChange={e => set({ kafka_connection_id: e.target.value })} className={INPUT}>
              <option value="">— не выбрано —</option>
              {kafka.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select></label>
          <label className="block"><span className={LABEL}>Топик</span>
            <input value={s.topic} onChange={e => set({ topic: e.target.value })} className={`${INPUT} font-mono text-xs`} /></label>
          <label className="block"><span className={LABEL}>Партиция</span>
            <input type="number" min={0} value={s.partition ?? ""} placeholder="авто" onChange={e => set({ partition: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })} className={INPUT} /></label>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={BTN} disabled={!s.kafka_connection_id || testing} onClick={() => void test()}>
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />} {testing ? "Проверяю…" : "Проверить подключение"}</button>
          {testMsg && <span className={`text-sm ${testMsg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>{testMsg.text}</span>}
        </div>
      </section>

      <section className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-main">Поля сообщения</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className={LABEL}>Система-источник (systemCreatedBy, CI)</span>
            <input value={s.system_created_by} onChange={e => set({ system_created_by: e.target.value })} className={`${INPUT} font-mono text-xs`} /></label>
          <label className="block"><span className={LABEL}>Название системы-источника (для инструкции)</span>
            <input value={s.monitoring_system_name} onChange={e => set({ monitoring_system_name: e.target.value })} className={INPUT} /></label>
          <label className="block"><span className={LABEL}>Исполнитель и автор: idBhb</span>
            <input value={s.assignee_id_bhb} onChange={e => set({ assignee_id_bhb: e.target.value })} placeholder="пусто — null" className={`${INPUT} font-mono text-xs`} /></label>
          <label className="block"><span className={LABEL}>Исполнитель и автор: personalNumber</span>
            <input value={s.assignee_personal_number} onChange={e => set({ assignee_personal_number: e.target.value })} placeholder="пусто — null" className={`${INPUT} font-mono text-xs`} /></label>
        </div>
      </section>

      <section className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-text-main">Инструкции — запись в БД инцидентов</h3>
        <p className="text-xs text-text-muted">Нужны подключение и SQL-шаблон <code className="font-mono">create_incident_instruction</code> из test_sql_templates.json
          (можно загрузить «Импортом»). Пока их нет, инциденты отправляются без инструкций.</p>
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <label className="block"><span className={LABEL}>Подключение к БД (из «Тестовых данных»)</span>
            <select value={s.db_connection_id} onChange={e => set({ db_connection_id: e.target.value })} className={INPUT}>
              <option value="">— не выбрано —</option>
              {dbs.map(d => <option key={d.id} value={d.id}>{d.display_name}</option>)}
            </select></label>
          <label className="block"><span className={LABEL}>Ждать инцидент в БД, сек</span>
            <input type="number" min={0} max={120} value={s.instruction_wait_sec} onChange={e => set({ instruction_wait_sec: Math.min(120, Math.max(0, Number(e.target.value) || 0)) })} className={INPUT} /></label>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e => { void importSql(e.target.files?.[0]); e.target.value = ""; }} />
          <button type="button" className={BTN} onClick={() => fileRef.current?.click()}><Upload className="w-4 h-4" /> Загрузить test_sql_templates.json</button>
        </div>
        <label className="block"><span className={LABEL}>SQL-шаблон (параметры в фигурных скобках; должен вернуть id инструкции)</span>
          <textarea value={s.instruction_sql} onChange={e => set({ instruction_sql: e.target.value })} rows={8} spellCheck={false}
            placeholder="INSERT INTO … VALUES ({instruction_req_uuid}, {incident_sm_id}, {incident_instruction}, …) RETURNING id"
            className={`${INPUT} resize-y font-mono text-xs`} /></label>
        <p className="text-xs text-text-muted">
          Доступно: {SQL_PARAMS.map(p => <code key={p} className={`font-mono mr-1 ${params.includes(p) ? "text-primary" : ""}`}>{`{${p}}`}</code>)}.
          {params.filter(p => !SQL_PARAMS.includes(p) && p !== "incident_id" && p !== "incident_it_npi_update_seq").length > 0 &&
            <span className="text-amber-700 dark:text-amber-300"> Неизвестные — подставятся как NULL: {params.filter(p => !SQL_PARAMS.includes(p) && p !== "incident_id" && p !== "incident_it_npi_update_seq").join(", ")}.</span>}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className={LABEL}>Автор инструкции: user_id</span>
            <input value={s.instruction_user_id} onChange={e => set({ instruction_user_id: e.target.value })} className={INPUT} /></label>
          <label className="block"><span className={LABEL}>user_name</span>
            <input value={s.instruction_user_name} onChange={e => set({ instruction_user_name: e.target.value })} className={INPUT} /></label>
          <label className="block"><span className={LABEL}>user_employee_number</span>
            <input value={s.instruction_user_number} onChange={e => set({ instruction_user_number: e.target.value })} className={INPUT} /></label>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" className={BTN_PRIMARY} disabled={busy || !s.topic.trim()} onClick={() => void save()}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Сохранить настройки</button>
        {msg && <span className={`text-sm inline-flex items-center gap-1 ${msg.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
          {msg.ok && <Check className="w-4 h-4" />}{msg.text}</span>}
      </div>
    </div>
  );
}
