"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Bug, CheckCircle2, CheckSquare, ChevronUp, ExternalLink, Loader2, Minus, Send, Settings2, Sparkles } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { FORM_DOCK_ID } from "@/components/FormHost";
import type { FormControl } from "@/lib/backgroundForms";
import { notify } from "@/lib/notifications";
import EpicPicker from "./EpicPicker";
import AttachmentsField from "./AttachmentsField";
import { PARSEABLE_RE, withUniqueNames } from "@/lib/attachments";
import JiraSettingsModal from "@/components/settings/JiraSettingsModal";
import { formatLoadedAt, matchPriority, readEpicsCache, writeEpicsCache, type EpicsCache } from "@/components/JiraRegisterPanel";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { formatBug, formatTask } from "@/lib/api";
import {
  addLabelPresets, attachJiraFiles, createJiraDefect, defaultAssignee, getJiraMeta, getJiraSettings, labelName, loadJiraEpics,
  type JiraProjectMeta, type JiraSettings,
} from "@/lib/jiraApi";
import { updateAqaIssue } from "@/lib/aqaApi";
import JiraUserField from "./JiraUserField";
import RequirementsPicker, { CONFLUENCE_REF_RE, type RequirementsSource } from "./RequirementsPicker";
import { CREATE_TYPES, PRIORITIES, TESTING, inDirection, loadState, type Participant } from "@/lib/jiraTool";
import { issueCache } from "@/lib/jiraToolCache";
import { RefreshIcon } from "@/components/ui/RefreshButton";

/** Что уходит в список: черновик Shark или созданная в Jira задача (тогда есть jiraKey/url). */
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

const GEN_IMAGE_RE = /\.(png|jpe?g)$/i;
// В «Требованиях (st)» бывают и ссылки на другие системы, например Figma.

function withoutScreenshot(description: string, name: string): string {
  return description.replace(`![${name}](${name})`, "")
    .replace(/^## Скриншоты[ \t]*\n(?:[ \t]*\n)*(?=## |\s*$)/m, "").trimEnd();
}

const INPUT = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
const LBL = "block text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5";

/**
 * Создание задачи из списка — бывший «Генератор дефектов» + регистрация в Jira в одной форме.
 * Все поля видны сразу: можно заполнить руками, а можно описать своими словами и нажать
 * кнопку рядом с названием — ИИ оформит задачу по описанию, вложениям и требованиям эпика.
 * Дальше выбор: «Создать в Shark» (черновик в списке) или сразу «Создать в Jira».
 * С initial — это уже черновик из списка: его можно поправить и сохранить или отправить в Jira.
 *
 * Форму открывают через openForm (lib/backgroundForms.ts), и она живёт выше раздела. «Свернуть» убирает её на полку внизу
 * справа: генерация и отправка идут дальше, можно работать и в других разделах. Итог приходит уведомлением, а не
 * ушедшая в Jira форма остаётся на полке — с данными и причиной. Крестик во время работы тоже сворачивает: отправку
 * нельзя отменить, а молча потерять её результат нельзя.
 */
export default function IssueFormModal({ control, project, participants, listName, initial, prefill, linkTo, jiraOnly, files: initialFiles, extraFields, afterCreate, createBlocked, epicNote, epicChoices, onSave }: {
  control: FormControl;
  /** Свои поля вместо «Тестировщик (st)» — в сетке из двух колонок (плановые даты и исполнитель в «Трекинге AQA»). */
  extraFields?: ReactNode;
  /** Выполнить сразу после создания в Jira, до onSave; вернуть предупреждения. Сбой — предупреждением: задача уже создана. */
  afterCreate?: (key: string) => Promise<string[]>;
  /** Создание пока нельзя: свои поля заполнены неверно. */
  createBlocked?: boolean;
  /** Эпик — только из этого списка, и он обязателен (дефект из запуска автотестов — к эпикам роадмапа AQA). */
  epicChoices?: { key: string; summary: string }[];
  /** Своя подсказка о подставленном эпике. */
  epicNote?: ReactNode;
  /** Новая задача с заранее заполненными полями (например, дефект из упавшего шага в Zephyr Tool или к эпику). */
  prefill?: Partial<Pick<IssueDraft, "type" | "summary" | "description" | "priority" | "labels" | "epicKey">>;
  /** Связать созданную в Jira задачу с этой (дефект к стори из окна «Дефекты»). */
  linkTo?: { key: string; summary: string };
  /** Только создание в Jira: без списка Shark — ни галочки «Добавить в список», ни черновика. */
  jiraOnly?: boolean;
  /** Вложения с самого начала (например, скриншоты из плеера). */
  files?: File[];
  /** Название текущего списка — для галочки «Добавить в список». */
  listName?: string;
  /** Черновик из списка (его ключ и поля) — форма открывается заполненной. */
  initial?: IssueDraft & { key: string };
  project: string;
  participants: Participant[];
  onSave: (d: IssueDraft) => void;
}) {
  const { provider } = useWorkspace();
  const { minimized, minimize, restore, close: onClose } = control;
  const open = !minimized;
  // Читается после долгих запросов: важно, свёрнута ли форма сейчас, а не в момент нажатия.
  const minimizedRef = useRef(minimized);
  minimizedRef.current = minimized;
  const [type, setType] = useState<string>((initial?.type ?? prefill?.type) === "Задача" ? "Задача" : "Дефект");
  const isDefect = type === "Дефект";
  /**
   * Добавить созданную задачу в текущий список (по умолчанию — да). Без галочки задача только уходит в Jira,
   * поэтому «Создать в Shark» недоступно: черновику без списка негде жить. У черновика из списка галочки нет.
   */
  const [addToList, setAddToList] = useState(true);

  const [files, setFiles] = useState<File[]>(() => withUniqueNames([], initialFiles ?? []));
  /**
   * Имена, под которыми генерация сослалась на скриншоты в описании (!имя!): файл → имя.
   * Привязка к самому файлу, а не к порядку — добавили или убрали файл после генерации, имена не съедут.
   */
  const [shotNames, setShotNames] = useState<Map<File, string>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [genError, setGenError] = useState("");
  const [componentMissing, setComponentMissing] = useState(false);
  const [requestSources, setRequestSources] = useState(false);
  const [sourceRef, setSourceRef] = useState("");
  const [sourceFile, setSourceFile] = useState<File>();
  /**
   * Требования для ИИ: ссылка Confluence и документы «Данных» (несколько). По умолчанию — привязанные к эпику
   * (как раньше подставлялись сами); после правки руками эпик их больше не перезаписывает.
   */
  const [reqPick, setReqPick] = useState<RequirementsSource>({ ref: "", ids: [] });
  const reqTouched = useRef(false);

  /* ── Поля задачи ── */
  const [summary, setSummary] = useState(initial?.summary ?? prefill?.summary ?? "");
  const [description, setDescription] = useState(initial?.description ?? prefill?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? prefill?.priority ?? "");
  const [labels, setLabels] = useState<string[]>(initial?.labels ?? prefill?.labels ?? []);
  const [newLabel, setNewLabel] = useState("");
  const [components, setComponents] = useState<string[]>(initial?.components ?? []);
  const [componentGenerated, setComponentGenerated] = useState(false);
  const [standType, setStandType] = useState(initial?.standType ?? "");
  const [epicKey, setEpicKey] = useState(initial?.epicKey ?? prefill?.epicKey ?? "");
  const [participantId, setParticipantId] = useState(initial?.participantId ?? "");
  /**
   * Плановое начало и окончание (поля Jira «Плановое начало / окончание», как в «Трекинге AQA») и исполнитель из Jira —
   * необязательны, пишутся в задачу сразу после создания тем же кодом, что окно задачи (/api/aqa/issue/{key}):
   * поля плановых дат у каждого сервера свои, а createmeta корп. Jira закрыт.
   */
  const [planStart, setPlanStart] = useState("");
  const [planEnd, setPlanEnd] = useState("");
  const [assignee, setAssignee] = useState({ jiraName: "", jiraDisplay: "" });

  /* ── Jira ── */
  const [settings, setSettings] = useState<JiraSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [meta, setMeta] = useState<JiraProjectMeta | null>(null);
  const metaRequest = useRef<Promise<JiraProjectMeta | null> | null>(null);
  const [epicsCache, setEpicsCache] = useState<EpicsCache | null>(() => readEpicsCache(project));
  const [epicsLoading, setEpicsLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [created, setCreated] = useState<{ key: string; url: string; warnings: string[] } | null>(null);

  const jiraReady = Boolean(settings && (settings.token || settings.token_path));
  const reloadSettings = () => getJiraSettings().then(setSettings).catch(() => setSettings(null));
  useEffect(() => { reloadSettings(); }, []);
  useEffect(() => {
    setMeta(null);
    if (!jiraReady) return;
    const request = getJiraMeta(project).catch(() => null);
    metaRequest.current = request;
    void request.then(m => {
      if (metaRequest.current !== request || !m) return;
      setMeta(m);
      setStandType(s => s || m.default_stand_type);
    });
    return () => { metaRequest.current = null; };
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
  /** Новый лейбл: отмечаем в задаче и сразу сохраняем в общий список пресетов — навсегда, у всех. */
  const addLabel = async () => {
    const l = labelName(newLabel);
    if (!l) return;
    setNewLabel("");
    setLabels(x => Array.from(new Set([...x, l])));
    if (baseLabels.some(p => p.toLowerCase() === l.toLowerCase())) return;
    try {
      const r = await addLabelPresets([l]);
      setSettings(st => (st ? { ...st, labels: r.labels } : st));
      setMeta(m => (m ? { ...m, labels_presets: r.labels } : m));
    } catch { /* не сохранился — лейбл всё равно уйдёт в эту задачу */ }
  };
  const standTypes = meta?.stand_types ?? [];
  const epicOptions = (epicsCache?.epics ?? []).map(e => ({ key: e.key, summary: e.summary }));
  const mobiles = new Set(meta?.mobile_components ?? ["iOS", "Android"]);
  /**
   * Исполнитель по компоненту и метке (правила SBER911 из метаданных проекта): подставляется при выборе.
   * Выбранный вручную исполнитель не перезаписывается — меняется только тот, что подставило правило.
   */
  const autoAssignee = useRef("");
  const ruleAssignee = defaultAssignee(meta?.assignee_rules, components, labels);
  useEffect(() => {
    setAssignee(cur => {
      if (cur.jiraName && cur.jiraName !== autoAssignee.current) return cur;
      autoAssignee.current = ruleAssignee?.login ?? "";
      return ruleAssignee ? { jiraName: ruleAssignee.login, jiraDisplay: ruleAssignee.name } : { jiraName: "", jiraDisplay: "" };
    });
  }, [ruleAssignee?.login]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = generating || sending;

  const toggleComponent = (c: string) => {
    setComponentMissing(false);
    setComponentGenerated(false);
    setGenerated(false);
    setComponents(prev => {
      if (prev.includes(c)) return prev.filter(x => x !== c);
      if (!isDefect) return [...prev, c];
      // Для дефекта второй компонент допустим, если один из них мобильный.
      const anyMobile = prev.some(x => mobiles.has(x)) || mobiles.has(c);
      return prev.length === 1 && anyMobile ? [...prev, c] : [c];
    });
  };

  const changeEpic = (key: string) => {
    setEpicKey(key);
    setRequestSources(false);
    setSourceRef("");
    setSourceFile(undefined);
    setGenError("");
    setGenerated(false);
  };

  const addFiles = (added: File[]) => {
    if (busy || !added.length) return;
    setFiles(current => [...current, ...withUniqueNames(current, added)]);
    setGenerated(false);
  };

  const removeFile = (index: number) => {
    if (busy) return;
    const file = files[index];
    const name = shotNames.get(file);
    if (name) {
      setDescription(text => withoutScreenshot(text, name));
      setShotNames(current => {
        const next = new Map(current);
        next.delete(file);
        return next;
      });
    }
    setFiles(current => current.filter((_, i) => i !== index));
    setGenerated(false);
  };

  const canGenerate = Boolean(summary.trim() || description.trim() || files.some(f => PARSEABLE_RE.test(f.name)));
  useEffect(() => {
    if (reqTouched.current) return;
    const key = epicKey.trim().toUpperCase();
    const { reqLinks, reqUrls } = loadState();
    const ref = reqUrls[key]?.trim() ?? "";
    setReqPick({ ref: CONFLUENCE_REF_RE.test(ref) ? ref : "", ids: reqLinks[key] ?? [] });
  }, [epicKey]);
  const generate = async (withoutRequirements = false) => {
    if (busy || !canGenerate) return;
    setGenerating(true);
    setGenerated(false);
    setGenError("");
    const key = epicKey.trim().toUpperCase();
    const { lists } = loadState();
    const pickedRef = CONFLUENCE_REF_RE.test(reqPick.ref.trim()) ? reqPick.ref.trim() : "";
    const confluenceRef = withoutRequirements ? "" : sourceRef.trim() || pickedRef;
    try {
      const listedEpic = lists.some(list => list.keys.includes(key)) ? issueCache().issues[key] : undefined;
      const epicSummary = String(listedEpic?.fields.summary ??
        (epicChoices ?? epicOptions).find(e => e.key === key)?.summary ?? "");
      const generationMeta = meta ?? await metaRequest.current;
      const availableComponents = generationMeta?.components ?? [];
      const availablePriorities = generationMeta?.priorities?.length ? generationMeta.priorities : PRIORITIES;
      const selectedComponents = componentGenerated ? [] : components;
      const readable = files.filter(f => PARSEABLE_RE.test(f.name));
      const text = [...shotNames.values()].reduce(withoutScreenshot, description).trim();
      const res = await (isDefect ? formatBug : formatTask)({
        feature: "", description: text, provider, files: readable,
        requirementIds: withoutRequirements ? [] : reqPick.ids,
        requirementFile: withoutRequirements ? undefined : sourceFile,
        jiraContext: {
          summary: summary.trim().slice(0, 250), epic: key, epic_summary: epicSummary.slice(0, 500),
          components: availableComponents, selected_components: selectedComponents,
          attachment_names: files.filter(f => !PARSEABLE_RE.test(f.name)).map(f => f.name),
          confluence_ref: confluenceRef, allow_without_requirements: withoutRequirements,
        },
      });
      if (res.needs_requirements) {
        setRequestSources(true);
        setSourceRef(confluenceRef);
        if (minimizedRef.current) notify({ kind: "info", title: "Нужны требования для генерации", text: "Разверните форму, чтобы указать источник или продолжить без него." });
        return;
      }
      setSummary(res.title);
      setDescription(res.description);
      if (isDefect && res.priority) setPriority(p => matchPriority(res.priority, availablePriorities) || p);
      const matchedComponent = availableComponents.includes(res.component);
      if (!selectedComponents.length) {
        setComponents(matchedComponent ? [res.component] : []);
        setComponentGenerated(matchedComponent);
        setComponentMissing(availableComponents.length > 0 && !matchedComponent);
      }
      const shots = readable.filter(f => GEN_IMAGE_RE.test(f.name));
      setShotNames(new Map(shots.map((f, i) => [f, res.screenshots?.[i] ?? f.name])));
      setRequestSources(false);
      setGenerated(true);
      if (minimizedRef.current) notify({ kind: "success", title: "Название и описание готовы", text: "Разверните форму внизу справа, проверьте и отправьте." });
    } catch (e) {
      setGenError(`Генерация не удалась: ${(e as Error).message.slice(0, 300)}`);
      if (confluenceRef || (!withoutRequirements && sourceFile)) {
        setRequestSources(true);
        setSourceRef(confluenceRef);
      }
      if (minimizedRef.current) notify({ kind: "error", title: "Генерация описания не удалась", text: (e as Error).message.slice(0, 200) });
    } finally {
      setGenerating(false);
    }
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
        ...(linkTo ? { link_key: linkTo.key } : {}),
      });
      const warnings = [...res.warnings];
      // Все вложения — и у дефекта, и у задачи, с генерацией и без; скриншоты — под именем из описания.
      if (files.length) {
        try {
          const att = await attachJiraFiles(res.key, files, files.map(f => shotNames.get(f) ?? f.name));
          warnings.push(...att.warnings);
        } catch (e) {
          warnings.push(`${res.key} создана, но вложения не приложились: ${(e as Error).message}. Приложите их в Jira вручную.`);
        }
      }
      if (planStart || planEnd || assignee.jiraName) {
        try {
          const r = await updateAqaIssue(res.key, {
            ...(planStart ? { planStart } : {}), ...(planEnd ? { planEnd } : {}),
            ...(assignee.jiraName ? { assignee: assignee.jiraName } : {}),
          });
          warnings.push(...r.warnings);
        } catch (e) {
          warnings.push(`${res.key} создана, но плановые даты и исполнитель не записались: ${(e as Error).message}. Укажите их в окне задачи.`);
        }
      }
      if (afterCreate) {
        try { warnings.push(...await afterCreate(res.key)); }
        catch (e) { warnings.push(`${res.key} создана, но поля не записались: ${(e as Error).message}. Заполните их в окне задачи.`); }
      }
      setCreated({ key: res.key, url: res.url, warnings });
      onSave({ ...draft(), jira: { key: res.key, url: res.url }, addToList: jiraOnly ? false : initial ? true : addToList });
      notify({
        kind: warnings.length ? "info" : "success", title: `${type} ${res.key} создан${isDefect ? "" : "а"} в Jira`,
        text: [summary.trim(), ...warnings].join(" · "), links: [{ label: `${res.key} в Jira`, href: res.url }],
        silent: !minimizedRef.current,                    // форма открыта — итог и так на экране
      });
      if (minimizedRef.current) { onClose(); return; }
    } catch (e) {
      setSendErr((e as Error).message);
      notify({ kind: "error", title: `${type} не создан${isDefect ? "" : "а"} в Jira`, text: `${summary.trim()} · ${(e as Error).message}`, silent: !minimizedRef.current });
    }
    setSending(false);
  };

  /** Закрыть нельзя, пока идёт работа: результат потерялся бы. Сворачиваем. */
  const requestClose = () => { if (sending || generating) minimize(); else onClose(); };
  const dock = typeof document !== "undefined" ? document.getElementById(FORM_DOCK_ID) : null;
  const chip = minimized && dock && createPortal(
    <button type="button" onClick={restore} title="Развернуть форму"
      className="flex w-72 items-center gap-2 rounded-xl border border-border-main bg-[var(--color-modal-bg)] px-3 py-2 text-left text-sm shadow-lg hover:border-primary/50">
      {sending || generating ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
        : sendErr ? <AlertTriangle className="h-4 w-4 flex-shrink-0 text-red-500" />
        : isDefect ? <Bug className="h-4 w-4 flex-shrink-0 text-red-500" /> : <CheckSquare className="h-4 w-4 flex-shrink-0 text-primary" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-main">{summary.trim() || (isDefect ? "Новый дефект" : "Новая задача")}</span>
        <span className={`block truncate text-[11px] ${sendErr && !sending ? "text-red-600 dark:text-red-400" : "text-text-muted"}`}>
          {sending ? "Отправляю в Jira…" : generating ? "Генерирую…" : sendErr ? "Не отправлено — откройте форму" : "Свёрнута"}</span>
      </span>
      <ChevronUp className="h-4 w-4 flex-shrink-0 text-text-muted" />
    </button>,
    dock,
  );

  const loadEpics = async () => {
    setEpicsLoading(true);
    try { setEpicsCache(writeEpicsCache(project, (await loadJiraEpics(project)).epics)); }
    catch (e) { setSendErr(`Эпики не выгрузились: ${(e as Error).message}`); }
    setEpicsLoading(false);
  };

  if (created) {
    return (
      <Modal open={open} onClose={onClose} title="Создано в Jira" size="max-w-lg" minimizable={false}>
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-text-main">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" /> {type} <b>{created.key}</b> создан{isDefect ? "" : "а"}
            {jiraOnly ? "." : initial ? <> — черновик {initial.key} заменён на {isDefect ? "него" : "неё"} в списке.</> : addToList ? ` и добавлен${isDefect ? "" : "а"} в список.` : ` (в список не добавлен${isDefect ? "" : "а"}).`}
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
    <>
    {chip}
    <Modal open={open} onClose={requestClose} size="max-w-6xl" minimizable={false}
      title={initial ? `Черновик ${initial.key}` : `Создать задачу · ${project}`}
      headerExtra={(
        <button type="button" onClick={minimize} title="Свернуть: работа продолжится, итог придёт уведомлением" aria-label="Свернуть форму"
          className="rounded-lg p-1 text-text-muted transition-colors hover:bg-bg-subtle hover:text-text-main"><Minus className="h-4 w-4" /></button>
      )}>
      {/* ⌘V / Ctrl+V со скриншотом или файлом — в любом месте формы; обычный текст вставляется как всегда. */}
      <div className="space-y-4" onPaste={e => {
        const pasted = Array.from(e.clipboardData.files);
        if (!pasted.length) return;
        e.preventDefault();
        addFiles(pasted);
      }}>
        {(linkTo || prefill?.epicKey) && (
          <p className="text-xs rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-text-main">
            {epicNote && !linkTo ? epicNote : linkTo
              ? <>После создания в Jira {type.toLowerCase()} свяжется с <b>{linkTo.key}</b> {linkTo.summary && <>«{linkTo.summary}»</>} — и появится в её «Дефектах (st)».</>
              : <>Эпик подставлен: <b>{prefill?.epicKey}</b> — {type.toLowerCase()} попадёт в «Дефекты (st)» эпика.</>}
          </p>
        )}
        {/* Тип */}
        <div className="flex items-center gap-2" role="radiogroup" aria-label="Тип задачи">
          {CREATE_TYPES.map(({ type: t, hint }) => {
            const Icon = t === "Дефект" ? Bug : CheckSquare;
            return (
              <button key={t} type="button" role="radio" aria-checked={type === t} disabled={busy} onClick={() => { setType(t); setGenerated(false); }} title={hint}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors
                  ${type === t ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border-main text-text-main hover:bg-bg-subtle"}`}>
                <Icon className={`w-4 h-4 ${t === "Дефект" ? "text-red-500" : ""}`} /> {t}
              </button>
            );
          })}
        </div>

        <fieldset disabled={busy} className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <section className="space-y-3" aria-label="Название, описание и вложения">
            <div>
              <label htmlFor="if-summary" className={LBL}>Название *</label>
              <div className="flex items-stretch gap-2">
                <input id="if-summary" value={summary} onChange={e => { setSummary(e.target.value); setGenerated(false); }}
                  maxLength={250} className={`${INPUT} min-w-0`}
                  placeholder={isDefect ? "[Bc][Название фичи] Краткая суть" : "Проверить… / Подготовить…"} />
                <button type="button" onClick={() => void generate()} disabled={busy || !canGenerate}
                  aria-label={generated ? "Готово — сгенерировать заново" : "Сгенерировать с ИИ"}
                  title={canGenerate ? "Оформить название и описание по полям формы и вложениям" : "Добавьте описание, название или файл"}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold disabled:opacity-50
                    ${generated ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"}`}>
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : generated ? <CheckCircle2 className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                  <span role="status">{generating ? "Генерирую…" : generated ? "Готово" : "ИИ"}</span>
                </button>
              </div>
            </div>
            <details className="rounded-lg border border-border-main px-3 py-2">
              <summary className="text-xs cursor-pointer select-none">Требования для ИИ · {reqPick.ids.length + (reqPick.ref.trim() ? 1 : 0)}</summary>
              <div className="mt-2"><RequirementsPicker value={reqPick} disabled={busy} onChange={v => { reqTouched.current = true; setReqPick(v); }} /></div>
            </details>
            {requestSources && (
              <section className="space-y-2 rounded-lg border border-border-main bg-bg-subtle p-3 text-xs text-text-main" aria-label="Требования для генерации">
                <p>{epicKey ? `Для эпика ${epicKey} нет доступного текста требований.` : "Эпик не выбран."} Укажите ссылку на Confluence или приложите файл требований.</p>
                <input type="text" value={sourceRef} onChange={e => setSourceRef(e.target.value)}
                  aria-label="Ссылка на требования в Confluence" placeholder="Ссылка на страницу Confluence" className={INPUT} />
                <label className="block">
                  <span className={LBL}>Файл требований</span>
                  <input type="file" accept=".pdf,.doc,.docx,.xlsx,.xls,.xml,.png,.jpg,.jpeg,.txt,.log,.json,.md,.markdown"
                    onChange={e => setSourceFile(e.target.files?.[0])} className="max-w-full text-xs text-text-main" />
                  {sourceFile && <span className="ml-2 break-all">{sourceFile.name}</span>}
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => void generate()} disabled={!canGenerate || !(sourceRef.trim() || sourceFile)}
                    className="rounded-lg bg-primary px-2.5 py-1.5 font-semibold text-white disabled:opacity-50">Использовать требования</button>
                  <button type="button" onClick={() => void generate(true)} disabled={!canGenerate}
                    className="rounded-lg border border-border-main px-2.5 py-1.5 hover:bg-bg-card disabled:opacity-50">Продолжить без требований</button>
                </div>
              </section>
            )}
            {genError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{genError}</p>}
            <div>
              <label htmlFor="if-desc" className={LBL}>Описание</label>
              <textarea id="if-desc" value={description} onChange={e => { setDescription(e.target.value); setGenerated(false); }} rows={12}
                className={`${INPUT} resize-y font-mono text-[13px]`}
                placeholder={isDefect ? "Опишите, что произошло и какого результата ожидали" : "Опишите, что нужно сделать и зачем"} />
            </div>
            <div>
              <span className={LBL}>Вложения{files.length ? ` · ${files.length}` : ""}</span>
              <AttachmentsField files={files} onAdd={addFiles} onRemove={removeFile} />
              {files.length > 0 && (
                <p className="mt-1 text-[11px] text-text-muted">
                  Файлы прикрепятся при создании в Jira.
                  {!jiraOnly && (initial || addToList) && " В черновике Shark вложения не сохраняются."}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-3" aria-label="Поля Jira">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <span className={LBL}>Компоненты{isDefect ? " (до 2; второй — только мобильный)" : ""}</span>
                {componentMissing && <p className="mb-1 text-xs text-amber-700 dark:text-amber-300">ИИ не подобрал компонент. Выберите его вручную.</p>}
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
              <div>
                <label htmlFor="if-plan-start" className={LBL}>Плановое начало</label>
                <input id="if-plan-start" type="date" value={planStart} onChange={e => setPlanStart(e.target.value)} className={INPUT}
                  title="Необязательно. Поле Jira «Плановое начало»: с него задача стоит на графике. Нет — от даты создания" />
              </div>
              <div>
                <label htmlFor="if-plan-end" className={LBL}>Плановое окончание</label>
                <input id="if-plan-end" type="date" value={planEnd} min={planStart || undefined} onChange={e => setPlanEnd(e.target.value)} className={INPUT}
                  title="Необязательно. Поле Jira «Плановое окончание»: по нему считается срок на графике" />
              </div>
              {planStart && planEnd && planStart > planEnd && (
                <p className="col-span-2 -mt-1 text-[11px] text-red-600 dark:text-red-400">Плановое начало позже планового окончания</p>
              )}
              <div className="col-span-2">
                <span className={LBL}>Исполнитель</span>
                <JiraUserField label="" jiraOk={jiraReady} name={assignee.jiraName} display={assignee.jiraDisplay} onChange={setAssignee} />
                {ruleAssignee && assignee.jiraName === ruleAssignee.login && (
                  <p className="mt-1 text-[11px] text-text-muted">Подставлен по правилу: {ruleAssignee.components.length ? `компонент ${ruleAssignee.components.join(" / ")}` : `метка ${ruleAssignee.labels.join(", ")}`}</p>
                )}
              </div>
              <div className="col-span-2">
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="if-epic" className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Эпик</label>
                  {jiraReady && !epicChoices && (
                    <button type="button" onClick={loadEpics} disabled={epicsLoading}
                      title="Выгрузить список эпиков из Jira заново"
                      className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50">
                      <RefreshIcon busy={epicsLoading} className="w-3 h-3" />
                      {epicsCache ? `выгрузить заново · ${formatLoadedAt(epicsCache.loadedAt)}` : "выгрузить эпики из Jira"}
                    </button>
                  )}
                </div>
                {epicChoices ? (
                  <select id="if-epic" value={epicKey} onChange={e => changeEpic(e.target.value)} className={INPUT}>
                    <option value="">— выберите эпик —</option>
                    {epicChoices.map(e => <option key={e.key} value={e.key}>{e.summary ? `${e.key} · ${e.summary}` : e.key}</option>)}
                  </select>
                ) : (
                  <EpicPicker id="if-epic" value={epicKey} options={epicOptions} onChange={changeEpic}
                    loading={epicsLoading} loadedAt={epicsCache ? formatLoadedAt(epicsCache.loadedAt) : null}
                    canLoad={jiraReady} onReload={loadEpics} />
                )}
              </div>
              <div className="col-span-2">
                <span className={LBL}>Лейблы</span>
                <div className="flex flex-wrap items-center gap-1">
                  {labelPresets.map(l => (
                    <button key={l} type="button" onClick={() => setLabels(x => (x.includes(l) ? x.filter(y => y !== l) : [...x, l]))} aria-pressed={labels.includes(l)}
                      className={`px-2.5 py-1 rounded-full text-xs border ${labels.includes(l) ? "border-primary bg-primary/10 text-primary font-semibold" : "border-border-main text-text-muted hover:text-text-main"}`}>{l}</button>
                  ))}
                  <input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="+ лейбл" aria-label="Новый лейбл"
                    title="Enter — добавить. Лейбл сохранится в списке навсегда (убрать — в настройках Jira)"
                    onKeyDown={e => { if (e.key === "Enter" && newLabel.trim()) { e.preventDefault(); void addLabel(); } }}
                    className="w-24 border border-dashed border-border-main rounded-full px-2.5 py-1 text-xs bg-transparent text-text-main focus:outline-none focus:border-primary/50" />
                </div>
              </div>
              {extraFields ?? (
                <div className="col-span-2">
                  <label htmlFor="if-ptc" className={LBL}>Тестировщик (st)</label>
                  <select id="if-ptc" value={participantId} onChange={e => setParticipantId(e.target.value)} className={INPUT}>
                    <option value="">— не назначен</option>
                    {participants.filter(p => inDirection(p, TESTING) || p.id === participantId).map(p => <option key={p.id} value={p.id}>{p.role ? `${p.name} · ${p.role}` : p.name}</option>)}
                  </select>
                </div>
              )}
            </div>
          </section>
        </fieldset>

        {sendErr && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">{sendErr}</p>}

        <div className="flex items-center gap-3 border-t border-border-main pt-3 flex-wrap">
          {!initial && !jiraOnly && (
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer select-none"
              title="Без галочки задача только создаётся в Jira, в список не попадает">
              <input type="checkbox" checked={addToList} onChange={e => setAddToList(e.target.checked)} />
              Добавить в список{listName ? <> «{listName}»</> : ""}
            </label>
          )}
          <p className="text-[11px] text-text-muted flex items-center gap-1.5 min-w-0">
            {jiraReady ? <>Jira подключена · проект {project}</> : (
              <>Jira не подключена — можно создать только в Shark.
                <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Settings2 className="w-3 h-3" /> Подключить</button></>
            )}
          </p>
          <div className="ml-auto flex gap-2 flex-shrink-0">
            <button type="button" onClick={requestClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">
              {sending || generating ? "Свернуть" : "Отмена"}</button>
            {!jiraOnly && <button type="button" disabled={!summary.trim() || busy || (!initial && !addToList)} onClick={() => { onSave(draft()); onClose(); }}
              title={!initial && !addToList ? "Черновик живёт только в списке — включите «Добавить в список»" : "Черновик в списке — в Jira не уходит"}
              className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">
              {initial ? "Сохранить черновик" : "Создать в Shark"}</button>}
            <button type="button" disabled={!summary.trim() || !jiraReady || busy || createBlocked || (!!epicChoices && !epicKey) || (!!planStart && !!planEnd && planStart > planEnd)} onClick={sendToJira}
              title={jiraReady ? `Создать ${isDefect ? "дефект" : "задачу"} в Jira (${project})` : "Сначала подключите Jira"}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} {initial ? "Отправить в Jira" : "Создать в Jira"}
            </button>
          </div>
        </div>
      </div>
      <JiraSettingsModal open={settingsOpen} onClose={() => { setSettingsOpen(false); reloadSettings(); }} />
    </Modal>
    </>
  );
}
