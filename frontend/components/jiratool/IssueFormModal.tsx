"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Bug, CheckCircle2, CheckSquare, ExternalLink, Loader2, Paperclip, RefreshCw, Search, Send, Settings2, Sparkles, X,
} from "lucide-react";
import Modal from "@/components/ui/Modal";
import EpicPicker from "./EpicPicker";
import JiraSettingsModal from "@/components/settings/JiraSettingsModal";
import { formatLoadedAt, matchPriority, readEpicsCache, writeEpicsCache, type EpicsCache } from "@/components/JiraRegisterPanel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatBug, formatTask, listRequirements, type Requirement } from "@/lib/api";
import {
  attachJiraFiles, createJiraDefect, getJiraMeta, getJiraSettings, loadJiraEpics,
  type JiraProjectMeta, type JiraSettings,
} from "@/lib/jiraApi";
import { CREATE_TYPES, PRIORITIES, type Participant } from "@/lib/jiraTool";

/** Что уходит в список: черновик SimpleTest или созданная в Jira задача (тогда есть jiraKey/url). */
export interface IssueDraft {
  type: string;
  summary: string;
  description: string;
  priority: string;
  labels: string[];
  epicKey: string;
  components: string[];
  standType: string;
  participantId: string;
  jira?: { key: string; url: string };
  /** false — задача только создаётся в Jira, в текущий список не попадает. */
  addToList?: boolean;
}

const PLATFORMS = ["Back", "Front", "Mobile", "Analytics", "Design", "DevOps"];
const ATTACH_ACCEPT = ".pdf,.docx,.doc,.xlsx,.xls,.xml,.png,.jpg,.jpeg,.txt,.log";
const IMAGE_RE = /\.(png|jpe?g)$/i;

const INPUT = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
const LBL = "block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5";

/**
 * Создание задачи из списка — бывший «Генератор дефектов» + регистрация в Jira в одной форме.
 * Все поля видны сразу: можно заполнить руками, а можно описать своими словами и нажать
 * «Сгенерировать» — ИИ заполнит название и описание (для дефекта — и критичность).
 * Источник для ИИ — документы из раздела «Данные» (требования): контент подстраивается под них.
 * Дальше выбор: «Создать в SimpleTest» (черновик в списке) или сразу «Создать в Jira».
 * С initial — это уже черновик из списка: его можно поправить и сохранить или отправить в Jira.
 */
export default function IssueFormModal({ open, project, participants, listName, initial, onSave, onClose }: {
  open: boolean;
  /** Название текущего списка — для галочки «Добавить в список». */
  listName?: string;
  /** Черновик из списка (его ключ и поля) — форма открывается заполненной. */
  initial?: IssueDraft & { key: string };
  project: string;
  participants: Participant[];
  onSave: (d: IssueDraft) => void;
  onClose: () => void;
}) {
  const { provider } = useWorkspace();
  const [type, setType] = useState<string>(initial?.type === "Задача" ? "Задача" : "Дефект");
  const isDefect = type === "Дефект";
  /**
   * Добавить созданную задачу в текущий список (по умолчанию — да). Без галочки задача только уходит в Jira,
   * поэтому «Создать в SimpleTest» недоступно: черновику без списка негде жить. У черновика из списка галочки нет.
   */
  const [addToList, setAddToList] = useState(true);

  /* ── Исходные данные для ИИ ── */
  const [platform, setPlatform] = useState("Back");
  const [feature, setFeature] = useState("");
  const [raw, setRaw] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [reqIds, setReqIds] = useState<string[]>([]);
  const [reqQuery, setReqQuery] = useState("");
  const [reqOpen, setReqOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genNote, setGenNote] = useState("");
  const [screenshotNames, setScreenshotNames] = useState<string[]>([]);

  /* ── Поля задачи ── */
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "");
  const [labels, setLabels] = useState<string[]>(initial?.labels ?? []);
  const [newLabel, setNewLabel] = useState("");
  const [components, setComponents] = useState<string[]>(initial?.components ?? []);
  const [standType, setStandType] = useState(initial?.standType ?? "");
  const [epicKey, setEpicKey] = useState(initial?.epicKey ?? "");
  const [participantId, setParticipantId] = useState(initial?.participantId ?? "");

  /* ── Jira ── */
  const [settings, setSettings] = useState<JiraSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [meta, setMeta] = useState<JiraProjectMeta | null>(null);
  const [epicsCache, setEpicsCache] = useState<EpicsCache | null>(() => readEpicsCache(project));
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [created, setCreated] = useState<{ key: string; url: string; warnings: string[] } | null>(null);

  const jiraReady = Boolean(settings && (settings.token || settings.token_path));
  const reloadSettings = () => getJiraSettings().then(setSettings).catch(() => setSettings(null));
  useEffect(() => { reloadSettings(); listRequirements().then(setReqs).catch(() => setReqs([])); }, []);
  useEffect(() => {
    if (!jiraReady) return;
    getJiraMeta(project).then(m => { setMeta(m); setStandType(s => s || m.default_stand_type); }).catch(() => setMeta(null));
  }, [jiraReady, project]);
  // Эпики выгружаем сами один раз за сессию — при первом открытии формы; дальше — из сессии, обновление по кнопке.
  useEffect(() => {
    if (jiraReady && !readEpicsCache(project)) void loadEpics();
  }, [jiraReady, project]); // eslint-disable-line react-hooks/exhaustive-deps

  // Справочники — из Jira (метаданные проекта); без подключения списки пустые, поля заполняются руками.
  const priorities = meta?.priorities?.length ? meta.priorities : PRIORITIES;
  const componentList = meta?.components ?? [];
  // Пустой список в настройках — не «лейблов нет», а «не настроены»: тогда берём следующий источник.
  const baseLabels = meta?.labels_presets?.length ? meta.labels_presets : settings?.labels ?? [];
  const labelPresets = Array.from(new Set([...baseLabels, ...labels]));
  const standTypes = meta?.stand_types ?? [];
  const epicOptions = (epicsCache?.epics ?? []).map(e => ({ key: e.key, summary: e.summary }));
  const mobiles = new Set(meta?.mobile_components ?? ["iOS", "Android"]);

  const toggleComponent = (c: string) => setComponents(prev => {
    if (prev.includes(c)) return prev.filter(x => x !== c);
    if (!isDefect) return [...prev, c];
    // Дефект: до 2 компонентов, второй — только если среди них мобильный (правило регистрации SBER911).
    if (prev.length === 0) return [c];
    const anyMobile = prev.some(x => mobiles.has(x)) || mobiles.has(c);
    return prev.length === 1 && anyMobile ? [...prev, c] : [c];
  });

  const filteredReqs = useMemo(() => {
    const q = reqQuery.trim().toLowerCase();
    return reqs.filter(r => !q || r.name.toLowerCase().includes(q) || (r.feature ?? "").toLowerCase().includes(q));
  }, [reqs, reqQuery]);

  /* ── Генерация: заполняет название и описание (необязательна) ── */
  const generate = async () => {
    setGenerating(true); setGenNote("");
    try {
      // Своими словами не написано — генерируем из названия: кнопка активна и в этом случае.
      const text = raw.trim() || summary.trim();
      const res = isDefect
        ? await formatBug({ platform, feature, description: text, provider, files, requirementIds: reqIds })
        : await formatTask({ feature, description: text, provider, files, requirementIds: reqIds });
      setSummary(res.title || summary);
      setDescription(res.description || res.report);
      if (isDefect && res.priority) setPriority(p => matchPriority(res.priority, priorities) || p);
      setScreenshotNames(res.screenshots ?? []);
      setGenNote(`Сгенерировано${reqIds.length ? ` с учётом требований: ${reqIds.length}` : ""}. Проверьте название и описание.`);
    } catch (e) {
      // Без подстановки шаблона: выдуманный текст легко отправить в Jira, не заметив.
      setGenNote(`Генерация не удалась: ${(e as Error).message.slice(0, 200)}. Заполните поля руками или повторите.`);
    }
    setGenerating(false);
  };

  const draft = (): IssueDraft => ({
    type, summary: summary.trim(), description, priority, labels, epicKey, components, standType: isDefect ? standType : "", participantId,
  });

  /* ── Создание в Jira: та же регистрация, что была у генератора дефектов ── */
  const sendToJira = async () => {
    setSending(true); setSendErr("");
    try {
      const res = await createJiraDefect({
        project, summary: summary.trim(), description, priority, labels, epic_key: epicKey, components,
        assignee: "", ke: "", environment: "", stand_type: isDefect ? standType : "", issuetype: type,
      });
      const warnings = [...res.warnings];
      const shots = files.filter(f => IMAGE_RE.test(f.name));
      if (isDefect && shots.length && screenshotNames.length) {
        try {
          const att = await attachJiraFiles(res.key, shots, screenshotNames);
          warnings.push(...att.warnings);
        } catch (e) {
          warnings.push(`Создано, но скриншоты не приложились: ${String(e)}. Приложите их в Jira вручную.`);
        }
      }
      setCreated({ key: res.key, url: res.url, warnings });
      onSave({ ...draft(), jira: { key: res.key, url: res.url }, addToList: initial ? true : addToList });
    } catch (e) { setSendErr((e as Error).message); }
    setSending(false);
  };

  const loadEpics = async () => {
    setEpicsLoading(true);
    try { setEpicsCache(writeEpicsCache(project, (await loadJiraEpics(project)).epics)); }
    catch (e) { setSendErr(`Эпики не выгрузились: ${(e as Error).message}`); }
    setEpicsLoading(false);
  };

  if (created) {
    return (
      <Modal open={open} onClose={onClose} title="Создано в Jira" size="max-w-lg">
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-text-main">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> {type} <b>{created.key}</b> создан
            {initial ? <> — черновик {initial.key} заменён на него в списке.</> : addToList ? " и добавлен в список." : " (в список не добавлен)."}
          </p>
          <a href={created.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
            Открыть в Jira <ExternalLink className="w-3.5 h-3.5" />
          </a>
          {created.warnings.length > 0 && (
            <ul className="text-xs text-amber-700 dark:text-amber-300 space-y-1 list-disc pl-4">{created.warnings.map(w => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold">Готово</button></div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} size="max-w-6xl"
      title={initial ? `Черновик ${initial.key}` : `Создать задачу · ${project}`}>
      <div className="space-y-4">
        {/* Тип */}
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Тип задачи">
          {CREATE_TYPES.map(({ type: t, hint }) => {
            const Icon = t === "Дефект" ? Bug : CheckSquare;
            return (
              <button key={t} type="button" role="radio" aria-checked={type === t} onClick={() => setType(t)} title={hint}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors
                  ${type === t ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border-main text-text-main hover:bg-bg-subtle"}`}>
                <Icon className={`w-4 h-4 ${t === "Дефект" ? "text-red-500" : ""}`} /> {t}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5">
          {/* ── Слева: исходные данные для ИИ ── */}
          <section className="space-y-3 rounded-xl bg-bg-subtle/60 border border-border-main p-4" aria-label="Данные для генерации">
            <p className="text-xs font-semibold text-text-main flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-500" /> Генерация (по желанию)</p>
            {isDefect && (
              <div>
                <span className={LBL}>Слой</span>
                <div className="flex flex-wrap gap-1">
                  {PLATFORMS.map(p => (
                    <button key={p} type="button" onClick={() => setPlatform(p)} aria-pressed={platform === p}
                      className={`px-2.5 py-1 rounded-md text-xs border ${platform === p ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border-main text-text-muted hover:text-text-main"}`}>{p}</button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label htmlFor="if-feature" className={LBL}>Фича / модуль</label>
              <input id="if-feature" value={feature} onChange={e => setFeature(e.target.value)} placeholder="Например, Карточка инцидента" className={INPUT} />
            </div>
            <div>
              <label htmlFor="if-raw" className={LBL}>{isDefect ? "Что случилось — своими словами" : "Что нужно сделать — своими словами"}</label>
              <textarea id="if-raw" value={raw} onChange={e => setRaw(e.target.value)} rows={6} className={`${INPUT} resize-y`}
                placeholder={isDefect ? "Что делали, что получили, что ожидали. Можно кусок лога или JSON." : "Цель, что сделать, к какому сроку."} />
            </div>
            <div>
              <span className={LBL}>Вложения</span>
              <input ref={fileInput} type="file" multiple accept={ATTACH_ACCEPT} className="hidden"
                onChange={e => { setFiles(f => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
              <div className="flex flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => fileInput.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-card">
                  <Paperclip className="w-3.5 h-3.5" /> Приложить файл
                </button>
                {files.map((f, i) => (
                  <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-bg-card border border-border-main text-xs text-text-main max-w-[180px]">
                    <span className="truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles(x => x.filter((_, j) => j !== i))} aria-label={`Убрать ${f.name}`}><X className="w-3 h-3 text-text-muted hover:text-red-500" /></button>
                  </span>
                ))}
              </div>
              {files.length > 0 && <p className="text-[11px] text-text-muted mt-1">Текст файлов уйдёт в контекст; скриншоты дефекта — ещё и вложениями в Jira.</p>}
            </div>
            <div>
              <span className={LBL}>Источник для ИИ — документы из «Данных»</span>
              <button type="button" onClick={() => setReqOpen(o => !o)} aria-expanded={reqOpen}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border-main text-xs text-text-main hover:bg-bg-card">
                <BookOpen className="w-3.5 h-3.5" /> {reqIds.length ? `Требования: ${reqIds.length}` : "Выбрать требования"}
              </button>
              {reqIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {reqIds.map(id => {
                    const r = reqs.find(x => x.id === id);
                    return (
                      <span key={id} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/10 text-xs text-text-main max-w-[220px]">
                        <span className="truncate">{r?.name ?? id}</span>
                        <button type="button" onClick={() => setReqIds(x => x.filter(y => y !== id))} aria-label="Убрать требование"><X className="w-3 h-3" /></button>
                      </span>
                    );
                  })}
                </div>
              )}
              {reqOpen && (
                <div className="mt-2 rounded-lg border border-border-main bg-bg-card p-2">
                  <label className="flex items-center gap-2 px-2 py-1 mb-1 rounded-md border border-border-main bg-[var(--color-input-bg)]">
                    <Search className="w-3.5 h-3.5 text-text-muted" />
                    <input value={reqQuery} onChange={e => setReqQuery(e.target.value)} placeholder="Поиск по названию или фиче" aria-label="Поиск требований"
                      className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
                  </label>
                  <div className="max-h-40 overflow-y-auto scrollbar-thin">
                    {filteredReqs.length === 0 && <p className="text-xs text-text-muted p-2">{reqs.length ? "Ничего не нашлось" : "В разделе «Данные» пока нет требований"}</p>}
                    {filteredReqs.map(r => (
                      <label key={r.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-subtle text-sm cursor-pointer">
                        <input type="checkbox" checked={reqIds.includes(r.id)}
                          onChange={() => setReqIds(x => (x.includes(r.id) ? x.filter(y => y !== r.id) : [...x, r.id]))} />
                        <span className="truncate flex-1 text-text-main">{r.name}</span>
                        {r.feature && <span className="text-[10px] text-text-muted">{r.feature}</span>}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <button type="button" onClick={generate} disabled={generating || !(raw.trim() || summary.trim())}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? "Генерирую…" : "Сгенерировать название и описание"}
            </button>
            {genNote && <p className="text-[11px] text-text-muted">{genNote}</p>}
          </section>

          {/* ── Справа: поля задачи ── */}
          <section className="space-y-3" aria-label="Поля задачи">
            <div>
              <label htmlFor="if-summary" className={LBL}>Название *</label>
              <input id="if-summary" value={summary} onChange={e => setSummary(e.target.value)} maxLength={250} className={INPUT}
                placeholder={isDefect ? "[Back][Модуль] Краткая суть" : "Проверить… / Подготовить…"} />
            </div>
            <div>
              <label htmlFor="if-desc" className={LBL}>Описание</label>
              <textarea id="if-desc" value={description} onChange={e => setDescription(e.target.value)} rows={9}
                className={`${INPUT} resize-y font-mono text-[13px]`} placeholder="Заполните сами или нажмите «Сгенерировать» слева" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="if-prio" className={LBL}>Критичность</label>
                <select id="if-prio" value={priority} onChange={e => setPriority(e.target.value)} className={INPUT}>
                  <option value="">— приоритет —</option>
                  {priorities.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              {isDefect ? (
                <div>
                  <label htmlFor="if-stand" className={LBL}>Тип стенда</label>
                  <select id="if-stand" value={standType} onChange={e => setStandType(e.target.value)} className={INPUT}>
                    <option value="">— по умолчанию —</option>
                    {standTypes.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              ) : <div />}
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="if-epic" className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Эпик</label>
                  {jiraReady && (
                    <button type="button" onClick={loadEpics} disabled={epicsLoading}
                      title="Выгрузить список эпиков из Jira заново"
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50">
                      <RefreshCw className={`w-3 h-3 ${epicsLoading ? "animate-spin" : ""}`} />
                      {epicsCache ? `выгрузить заново · ${formatLoadedAt(epicsCache.loadedAt)}` : "выгрузить эпики из Jira"}
                    </button>
                  )}
                </div>
                <EpicPicker id="if-epic" value={epicKey} options={epicOptions} onChange={setEpicKey}
                  loading={epicsLoading} loadedAt={epicsCache ? formatLoadedAt(epicsCache.loadedAt) : null}
                  canLoad={jiraReady} onReload={loadEpics} />
              </div>
              <div className="col-span-2">
                <span className={LBL}>Компоненты{isDefect ? " (до 2; второй — только мобильный)" : ""}</span>
                <div className="flex flex-wrap gap-1">
                  {componentList.length === 0 && (
                    <span className="text-[11px] text-text-muted">{jiraReady ? "У проекта нет компонентов или они не загрузились" : "Подключите Jira — подтянутся компоненты проекта"}</span>
                  )}
                  {componentList.map(c => (
                    <button key={c} type="button" onClick={() => toggleComponent(c)} aria-pressed={components.includes(c)}
                      className={`px-2.5 py-1 rounded-md text-xs border ${components.includes(c) ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border-main text-text-muted hover:text-text-main"}`}>{c}</button>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <span className={LBL}>Лейблы</span>
                <div className="flex flex-wrap items-center gap-1">
                  {labelPresets.map(l => (
                    <button key={l} type="button" onClick={() => setLabels(x => (x.includes(l) ? x.filter(y => y !== l) : [...x, l]))} aria-pressed={labels.includes(l)}
                      className={`px-2.5 py-1 rounded-full text-xs border ${labels.includes(l) ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border-main text-text-muted hover:text-text-main"}`}>{l}</button>
                  ))}
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="+ лейбл" aria-label="Новый лейбл"
                    onKeyDown={e => { if (e.key === "Enter" && newLabel.trim()) { e.preventDefault(); setLabels(x => Array.from(new Set([...x, newLabel.trim()]))); setNewLabel(""); } }}
                    className="w-24 border border-dashed border-border-main rounded-full px-2.5 py-1 text-xs bg-transparent text-text-main focus:outline-none focus:border-primary/50" />
                </div>
              </div>
              <div className="col-span-2">
                <label htmlFor="if-ptc" className={LBL}>Участник (st)</label>
                <select id="if-ptc" value={participantId} onChange={e => setParticipantId(e.target.value)} className={INPUT}>
                  <option value="">— не назначен</option>
                  {participants.map(p => <option key={p.id} value={p.id}>{p.role ? `${p.name} · ${p.role}` : p.name}</option>)}
                </select>
              </div>
            </div>
          </section>
        </div>

        {sendErr && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">{sendErr}</p>}

        <div className="flex items-center gap-3 border-t border-border-main pt-3 flex-wrap">
          {!initial && (
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer select-none"
              title="Без галочки задача только создаётся в Jira, в список не попадает">
              <input type="checkbox" checked={addToList} onChange={e => setAddToList(e.target.checked)} />
              Добавить в список{listName ? <> «{listName}»</> : ""}
            </label>
          )}
          <p className="text-[11px] text-text-muted flex items-center gap-1.5 min-w-0">
            {jiraReady ? <>Jira подключена · проект {project}</> : (
              <>Jira не подключена — можно создать только в SimpleTest.
                <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Settings2 className="w-3 h-3" /> Подключить</button></>
            )}
          </p>
          <div className="ml-auto flex gap-2 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={!summary.trim() || sending || (!initial && !addToList)} onClick={() => { onSave(draft()); onClose(); }}
              title={!initial && !addToList ? "Черновик живёт только в списке — включите «Добавить в список»" : "Черновик в списке — в Jira не уходит"}
              className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
              {initial ? "Сохранить черновик" : "Создать в SimpleTest"}</button>
            <button type="button" disabled={!summary.trim() || !jiraReady || sending} onClick={sendToJira}
              title={jiraReady ? `Создать ${type.toLowerCase()} в Jira (${project})` : "Сначала подключите Jira"}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {initial ? "Отправить в Jira" : "Создать в Jira"}
            </button>
          </div>
        </div>
      </div>
      <JiraSettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); reloadSettings(); }} />
    </Modal>
  );
}
