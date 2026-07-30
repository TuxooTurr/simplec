"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import {
  AlertTriangle, Check, Database, Loader2, Pencil, Play, Plus, Save, Settings2, Trash2,
} from "lucide-react";

import {
  ConnectionsModal, ConnectionRow, FilePathInput, INPUT_CLS, PasswordInput, Select, Tabs,
} from "@/components/ui";
import {
  listTestDataConnections, createTestDataConnection, updateTestDataConnection,
  deleteTestDataConnection, testTestDataConnection, introspectTestDataConnection,
  listJdbcDrivers, createJdbcDriver, updateJdbcDriver, deleteJdbcDriver,
  uploadJdbcDriverLibrary, setJdbcDriverLibraryPath, removeJdbcDriverLibrary, testJdbcDriver,
  type TestDataConnection, type TestDataConnectionCreate, type JdbcDriver, type JdbcDriverSettings,
} from "@/lib/api";

// ── Подключения к БД ──────────────────────────────────────────────────────────

const EMPTY_TD_CONN: TestDataConnectionCreate = {
  display_name: "", driver_id: "", host: "localhost", port: 5432, db_name: "", login: "", password: "",
};

export function TestDataConnectionsModal({ open, onClose, connections, drivers, onRefresh, onManageDrivers }: {
  open: boolean; onClose: () => void;
  connections: TestDataConnection[];
  drivers: JdbcDriver[];
  onRefresh: () => Promise<void>;
  onManageDrivers: () => void;
}) {
  const [form, setForm] = useState<TestDataConnectionCreate & { id?: string }>(EMPTY_TD_CONN);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [introspecting, setIntrospecting] = useState<string | null>(null);

  function setField<K extends keyof (TestDataConnectionCreate & { id?: string })>(key: K, value: (TestDataConnectionCreate & { id?: string })[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  const reset = () => { setForm(EMPTY_TD_CONN); setMsg(null); };

  const save = async () => {
    if (!form.display_name.trim() || !form.host.trim() || !form.db_name.trim()) { setMsg({ ok: false, text: "Укажите название, хост и имя БД" }); return; }
    if (!form.driver_id) { setMsg({ ok: false, text: "Выберите драйвер" }); return; }
    setBusy(true); setMsg(null);
    try {
      if (form.id) await updateTestDataConnection(form.id, form);
      else await createTestDataConnection(form);
      await onRefresh(); reset();
      setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const test = async (id: string) => {
    setBusy(true); setMsg(null);
    try { const r = await testTestDataConnection(id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setBusy(false); }
  };

  const introspect = async (id: string) => {
    setIntrospecting(id); setMsg(null);
    try {
      const r = await introspectTestDataConnection(id);
      setMsg({ ok: true, text: `Схема получена: ${r.table_count} таблиц, ${r.column_count} колонок` });
      await onRefresh();
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setIntrospecting(null); }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Удалить подключение?")) return;
    setBusy(true);
    try { await deleteTestDataConnection(id); await onRefresh(); if (form.id === id) reset(); }
    finally { setBusy(false); }
  };

  const selectedDriver = drivers.find(d => d.id === form.driver_id);

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Тестовые данные — подключения к БД" message={msg}
      listTitle={`Сохранённые (${connections.length})`}
      list={<>
        {connections.length === 0 && <p className="text-xs text-text-muted/60">Пока нет подключений.</p>}
        {connections.map((c) => {
          const dbLabel = drivers.find(d => d.id === c.driver_id)?.name ?? "неизвестный драйвер";
          const schemaNote = c.cached_schema ? ` · схема: ${Object.keys(c.cached_schema).length} таблиц` : "";
          return (
            <ConnectionRow
              key={c.id}
              name={c.display_name}
              subtitle={`${dbLabel} · ${c.host}:${c.port}/${c.db_name}${schemaNote}`}
              actions={[
                { key: "test", icon: <Check className="h-3.5 w-3.5" />, title: "Проверить", onClick: () => test(c.id), disabled: busy, hoverClass: "hover:text-emerald-600" },
                { key: "schema", icon: <Database className="h-3.5 w-3.5" />, title: "Получить схему", onClick: () => introspect(c.id), disabled: introspecting === c.id, hoverClass: "hover:text-teal-600" },
                { key: "edit", icon: <Pencil className="h-3.5 w-3.5" />, title: "Изменить", onClick: () => { setForm({ ...EMPTY_TD_CONN, ...c, id: c.id, password: c.password }); setMsg(null); }, hoverClass: "hover:text-primary" },
                { key: "delete", icon: <Trash2 className="h-3.5 w-3.5" />, title: "Удалить", onClick: () => remove(c.id), hoverClass: "hover:bg-red-50 hover:text-red-500" },
              ]}
            />
          );
        })}
      </>}
      formTitle={form.id ? "Изменить" : "Новое подключение"}
      form={<>
        <input className={INPUT_CLS} value={form.display_name} onChange={e => setField("display_name", e.target.value)} placeholder="Название (напр. Продуктовая БД)" />
        {/* min-w-0 на списке: без него flex-элемент не сжимается меньше своего
            содержимого, и кнопка с длинной подписью вылезала за край формы. */}
        <div className="flex gap-2 min-w-0">
          <Select className="flex-1 min-w-0" value={form.driver_id}
            onChange={(value) => {
              const driverId = value;
              const drv = drivers.find(d => d.id === driverId);
              setForm(prev => ({
                ...prev, driver_id: driverId,
                port: drv?.default_port ?? prev.port,
                db_name: prev.db_name || drv?.default_db_name || "",
                login: prev.login || drv?.default_login || "",
              }));
            }}>
            <option value="">— выберите драйвер —</option>
            {drivers.map(d => <option key={d.id} value={d.id}>{d.name}{d.built_in ? "" : " (свой)"}</option>)}
          </Select>
          <button type="button" onClick={onManageDrivers} title="Настройка драйверов"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border-main px-2.5 py-2 text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline whitespace-nowrap">Настройка драйверов</span>
          </button>
        </div>
        {selectedDriver && !selectedDriver.jar_path && !selectedDriver.jar_filename && (
          <p className="text-xs text-amber-600">У драйвера «{selectedDriver.name}» не подключена библиотека — укажите .jar в «Настройке драйверов».</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <input className={INPUT_CLS} value={form.host} onChange={e => setField("host", e.target.value)} placeholder="Хост" spellCheck={false} />
          <input className={INPUT_CLS} type="number" value={form.port} onChange={e => setField("port", parseInt(e.target.value) || 0)} placeholder="Порт" />
        </div>
        <input className={INPUT_CLS} value={form.db_name} onChange={e => setField("db_name", e.target.value)} placeholder="Имя БД" spellCheck={false} />
        <input className={INPUT_CLS} value={form.login} onChange={e => setField("login", e.target.value)} placeholder="Логин" spellCheck={false} />
        <PasswordInput fieldKey="password" value={form.password} onChange={(_, v) => setField("password", v)} placeholder="Пароль" />
        {selectedDriver?.sql_dialect === "oracle" && (
          <input className={INPUT_CLS} value={form.schema_name ?? ""} onChange={e => setField("schema_name" as "display_name", e.target.value)} placeholder="Schema name" spellCheck={false} />
        )}
        <div className="flex justify-end gap-2 pt-1">
          {form.id && <button type="button" onClick={reset} className="rounded-lg border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-bg-subtle">Отмена</button>}
          <button type="button" onClick={save} disabled={busy}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {form.id ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </>}
    />
  );
}

// ── Настройка драйверов (DBeaver-style: список + вкладки Настройки/Библиотека) ──

const NEW_DRIVER_ID = "__new__";
const EMPTY_DRIVER_SETTINGS: JdbcDriverSettings = {
  name: "", driver_class: "", url_template: "", default_port: null, default_db_name: "", default_login: "",
};

export function DriverManagerModal({ open, onClose, drivers, onRefresh }: {
  open: boolean; onClose: () => void;
  drivers: JdbcDriver[];
  onRefresh: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [activeTab, setActiveTab] = useState<"settings" | "library">("settings");
  const [settingsForm, setSettingsForm] = useState<JdbcDriverSettings>(EMPTY_DRIVER_SETTINGS);
  const [pathInput, setPathInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const selected = selectedId === NEW_DRIVER_ID ? undefined : drivers.find(d => d.id === selectedId);
  const hasLibrary = (d: JdbcDriver) => !!(d.jar_path || d.jar_filename);

  useEffect(() => {
    if (open && !selectedId && drivers.length > 0) setSelectedId(drivers[0].id);
  }, [open, drivers, selectedId]);

  useEffect(() => {
    if (selected) {
      setSettingsForm({
        name: selected.name, driver_class: selected.driver_class, url_template: selected.url_template,
        default_port: selected.default_port, default_db_name: selected.default_db_name, default_login: selected.default_login,
      });
      setPathInput(selected.jar_path ?? "");
    } else if (selectedId === NEW_DRIVER_ID) {
      setSettingsForm(EMPTY_DRIVER_SETTINGS);
      setPathInput("");
    }
    setMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const saveDriverSettings = async () => {
    if (!settingsForm.name.trim() || !settingsForm.driver_class.trim() || !settingsForm.url_template.trim()) {
      setMsg({ ok: false, text: "Укажите имя, класс драйвера и шаблон URL" }); return;
    }
    setBusy(true); setMsg(null);
    try {
      if (selectedId === NEW_DRIVER_ID) {
        const r = await createJdbcDriver(settingsForm);
        await onRefresh();
        setSelectedId(r.driver.id);
        setActiveTab("library");
        setMsg({ ok: true, text: "Драйвер создан — теперь добавьте библиотеку" });
      } else if (selected) {
        await updateJdbcDriver(selected.id, settingsForm);
        await onRefresh();
        setMsg({ ok: true, text: "Настройки сохранены" });
      }
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const uploadLibrary = async (file: File) => {
    if (!selected) return;
    setBusy(true); setMsg(null);
    try { await uploadJdbcDriverLibrary(selected.id, file); await onRefresh(); setMsg({ ok: true, text: "Библиотека загружена" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const saveLibraryPath = async () => {
    if (!selected) return;
    const p = pathInput.trim();
    if (!p) { setMsg({ ok: false, text: "Укажите путь к .jar-файлу" }); return; }
    setBusy(true); setMsg(null);
    try { await setJdbcDriverLibraryPath(selected.id, p); await onRefresh(); setMsg({ ok: true, text: "Путь к библиотеке сохранён" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const removeLibrary = async () => {
    if (!selected) return;
    setBusy(true); setMsg(null);
    try { await removeJdbcDriverLibrary(selected.id); await onRefresh(); setMsg({ ok: true, text: "Библиотека удалена" }); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }); }
    finally { setBusy(false); }
  };

  const testDriver = async () => {
    if (!selected) return;
    setTesting(true); setMsg(null);
    try { const r = await testJdbcDriver(selected.id); setMsg({ ok: r.status === "green", text: r.message }); }
    catch (e) { setMsg({ ok: false, text: String(e) }); }
    finally { setTesting(false); }
  };

  const deleteDriver = async () => {
    if (!selected || selected.built_in) return;
    if (!window.confirm("Удалить драйвер? Подключения, использующие его, перестанут работать.")) return;
    setBusy(true);
    try {
      await deleteJdbcDriver(selected.id);
      await onRefresh();
      setSelectedId(drivers.find(d => d.id !== selected.id)?.id ?? "");
    } finally { setBusy(false); }
  };

  const showForm = !!selected || selectedId === NEW_DRIVER_ID;

  return (
    <ConnectionsModal
      open={open} onClose={onClose} title="Настройка драйверов" message={msg} size="max-w-3xl"
      listTitle={`Драйверы (${drivers.length})`}
      list={<>
        {drivers.map((d) => (
          <button key={d.id} type="button" onClick={() => setSelectedId(d.id)}
            className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
              selectedId === d.id ? "border-primary bg-primary/5" : "border-border-main hover:bg-bg-subtle"
            }`}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-main">{d.name}</p>
              <p className="truncate text-[11px] text-text-muted">
                {d.built_in ? "Встроенный" : "Свой"} · {hasLibrary(d) ? (d.original_filename ?? "библиотека") : "библиотека не подключена"}
              </p>
            </div>
            {!hasLibrary(d) && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          </button>
        ))}
        <button type="button" onClick={() => setSelectedId(NEW_DRIVER_ID)}
          className={`flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed px-2.5 py-2 text-xs font-semibold transition-colors ${
            selectedId === NEW_DRIVER_ID ? "border-primary bg-primary/5 text-primary" : "border-border-main text-text-muted hover:bg-bg-subtle"
          }`}>
          <Plus className="h-3.5 w-3.5" /> Новый драйвер
        </button>
      </>}
      formTitle={selected ? selected.name : selectedId === NEW_DRIVER_ID ? "Новый драйвер" : "Выберите драйвер слева"}
      form={showForm ? <>
        <Tabs tabs={[{ id: "settings", label: "Настройки" }, { id: "library", label: "Библиотека" }]}
          active={activeTab} onChange={(id) => setActiveTab(id as "settings" | "library")} />
        {activeTab === "settings" ? (
          <div className="space-y-2 pt-3">
            <input className={INPUT_CLS} value={settingsForm.name} onChange={e => setSettingsForm(f => ({ ...f, name: e.target.value }))} placeholder="Имя драйвера" />
            <input className={`${INPUT_CLS} font-mono`} value={settingsForm.driver_class} onChange={e => setSettingsForm(f => ({ ...f, driver_class: e.target.value }))} placeholder="Класс драйвера (напр. org.postgresql.Driver)" spellCheck={false} />
            <input className={`${INPUT_CLS} font-mono`} value={settingsForm.url_template} onChange={e => setSettingsForm(f => ({ ...f, url_template: e.target.value }))} placeholder="jdbc:postgresql://{host}:{port}/{db_name}" spellCheck={false} />
            <div className="grid grid-cols-3 gap-2">
              <input className={INPUT_CLS} type="number" value={settingsForm.default_port ?? ""} onChange={e => setSettingsForm(f => ({ ...f, default_port: e.target.value ? parseInt(e.target.value) : null }))} placeholder="Порт" />
              <input className={INPUT_CLS} value={settingsForm.default_db_name ?? ""} onChange={e => setSettingsForm(f => ({ ...f, default_db_name: e.target.value }))} placeholder="БД по умолчанию" />
              <input className={INPUT_CLS} value={settingsForm.default_login ?? ""} onChange={e => setSettingsForm(f => ({ ...f, default_login: e.target.value }))} placeholder="Логин по умолчанию" />
            </div>
            <div className="flex items-center justify-between pt-1">
              {selected && !selected.built_in ? (
                <button type="button" onClick={deleteDriver} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50">
                  <Trash2 className="h-3.5 w-3.5" /> Удалить драйвер
                </button>
              ) : <span />}
              <button type="button" onClick={saveDriverSettings} disabled={busy}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 pt-3">
            {selectedId === NEW_DRIVER_ID ? (
              <p className="text-xs text-text-muted/70">Сначала сохраните настройки драйвера во вкладке «Настройки» — библиотеку можно будет подключить сразу после.</p>
            ) : selected && (
              <>
                {/* Текущее состояние библиотеки */}
                <div className="flex items-center justify-between rounded-lg border border-border-main px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text-main">{hasLibrary(selected) ? (selected.original_filename ?? "библиотека") : "Библиотека не подключена"}</p>
                    {hasLibrary(selected) && (
                      <p className="truncate text-[11px] text-text-muted">{selected.jar_path ? `по пути: ${selected.jar_path}` : "загруженный файл"}</p>
                    )}
                  </div>
                  {hasLibrary(selected) && (
                    <button type="button" onClick={removeLibrary} title="Отключить библиотеку" className="rounded p-1 text-text-muted hover:bg-red-50 hover:text-red-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {/* Единый вид со всеми файловыми настройками: путь можно вписать
                    руками или выбрать файл — он загрузится в приложение. */}
                <FilePathInput
                  label="Библиотека драйвера (.jar)"
                  value={pathInput}
                  onChange={setPathInput}
                  uploader={async (file) => {
                    // .jar уходит своим эндпоинтом: приложение хранит файл у себя,
                    // поэтому путь в поле не подставляем — состояние обновит onRefresh.
                    await uploadLibrary(file);
                    return "";
                  }}
                  accept=".jar"
                  placeholder="/Users/you/drivers/postgresql-42.7.jar"
                  disabled={busy}
                  hint="По пути файл не копируется — драйвер читается с диска. Заменить версию = положить новый .jar по тому же пути, перезапуск бэкенда не нужен."
                />
                <div className="flex justify-end">
                  <button type="button" onClick={saveLibraryPath} disabled={busy || !pathInput.trim()}
                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark disabled:opacity-40">
                    Указать путь
                  </button>
                </div>

                <div className="flex justify-end">
                  <button type="button" onClick={testDriver} disabled={testing || !hasLibrary(selected)}
                    className="flex items-center gap-1.5 rounded-lg border border-border-main px-3 py-1.5 text-xs font-medium text-text-main hover:bg-bg-subtle disabled:opacity-50">
                    {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Проверить загрузку класса
                  </button>
                </div>
              </>
            )}
            <p className="text-[11px] text-text-muted/70">
              Драйвер загружается «на лету» при каждом подключении — заменённую библиотеку не нужно ждать до перезапуска бэкенда.
            </p>
          </div>
        )}
      </> : <p className="text-xs text-text-muted/60">Выберите драйвер слева или создайте новый.</p>}
    />
  );
}

// ── Готовая к встраиванию в раздел связка «подключения + драйверы» ────────────

/**
 * Настройки подключений к БД для раздела: сама грузит списки и сама их обновляет.
 *
 * Разделу достаточно открыть окно — состояние подключений и драйверов
 * компонент ведёт сам, а через onChanged сообщает разделу, что список изменился.
 */
export default function TestDataSettingsModal({ open, onClose, onChanged }: {
  open: boolean; onClose: () => void;
  onChanged?: () => void;
}) {
  const [connections, setConnections] = useState<TestDataConnection[]>([]);
  const [drivers, setDrivers] = useState<JdbcDriver[]>([]);
  const [driversOpen, setDriversOpen] = useState(false);

  // Колбэк держим в ref: вызывающий часто передаёт inline-стрелку, и зависимость
  // от неё заставляла refresh меняться каждый рендер — загрузка зацикливалась.
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  const refresh = useCallback(async () => {
    const [conns, drv] = await Promise.all([listTestDataConnections(), listJdbcDrivers()]);
    setConnections(conns);
    setDrivers(drv);
    onChangedRef.current?.();
  }, []);

  useEffect(() => { if (open) refresh().catch(() => {}); }, [open, refresh]);

  return (
    <>
      <TestDataConnectionsModal
        open={open && !driversOpen}
        onClose={onClose}
        connections={connections}
        drivers={drivers}
        onRefresh={refresh}
        onManageDrivers={() => setDriversOpen(true)}
      />
      <DriverManagerModal
        open={driversOpen}
        onClose={() => setDriversOpen(false)}
        drivers={drivers}
        onRefresh={refresh}
      />
    </>
  );
}
