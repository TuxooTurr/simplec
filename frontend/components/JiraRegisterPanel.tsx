"use client";

/**
 * Панель «Зарегистрировать в Jira» — под готовым баг-репортом.
 * Проект/критичность/лейблы/эпик(автопоиск)/компонент/исполнитель/КЭ/среда/стенд.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2, Plus, X, ExternalLink, Send, AlertTriangle, CheckCircle2, Settings2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui";
import {
  getJiraSettings, saveJiraSettings, getJiraMeta, searchJiraEpics, searchJiraUsers,
  createJiraDefect, getJiraProjects,
  type JiraProjectMeta, type JiraEpic, type JiraUser, type JiraSettings, type JiraProject,
} from "@/lib/jiraApi";

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

const LBL = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* Приоритет от ИИ (рус.) → варианты названий в Jira (рус./англ.) */
const PRIORITY_SYNONYMS: Record<string, string[]> = {
  "критический": ["критический", "critical", "blocker", "блокирующий"],
  "высокий":     ["высокий", "high", "major"],
  "средний":     ["средний", "medium", "normal"],
  "низкий":      ["низкий", "low", "minor", "trivial"],
};

function matchPriority(hint: string, jiraPriorities: string[]): string {
  const h = hint.trim().toLowerCase();
  if (!h) return "";
  const exact = jiraPriorities.find(p => p.toLowerCase() === h);
  if (exact) return exact;
  const syns = PRIORITY_SYNONYMS[h] ?? [h];
  return jiraPriorities.find(p => syns.some(s => p.toLowerCase().includes(s))) ?? "";
}

export default function JiraRegisterPanel({
  summary, description, priorityHint = "",
}: { summary: string; description: string; priorityHint?: string }) {
  const router = useRouter();

  const [settings, setSettings] = useState<JiraSettings | null>(null);
  const [settingsErr, setSettingsErr] = useState("");

  const [project, setProject] = useState(() => {
    try { return localStorage.getItem("st_jira_project") ?? ""; } catch { return ""; }
  });
  const [projects, setProjects] = useState<JiraProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [meta, setMeta] = useState<JiraProjectMeta | null>(null);
  const [metaLoading, setMetaLoading] = useState(false);
  const [metaErr, setMetaErr] = useState("");

  const [issueSummary, setIssueSummary] = useState(summary);
  const [priority, setPriority] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [component, setComponent] = useState("");
  const [ke, setKe] = useState("");
  const [environment, setEnvironment] = useState("");
  const [stand, setStand] = useState("");

  // Эпик: автопоиск по части названия
  const [epicQuery, setEpicQuery] = useState("");
  const [epicKey, setEpicKey] = useState("");
  const [epics, setEpics] = useState<JiraEpic[]>([]);
  const [epicOpen, setEpicOpen] = useState(false);
  const debEpic = useDebounced(epicQuery, 400);

  // Исполнитель: автопоиск
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [assignee, setAssignee] = useState("");
  const [users, setUsers] = useState<JiraUser[]>([]);
  const [userOpen, setUserOpen] = useState(false);
  const debUser = useDebounced(assigneeQuery, 400);

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ key: string; url: string; warnings?: string[] } | null>(null);
  const [createErr, setCreateErr] = useState("");

  useEffect(() => { setIssueSummary(summary); setCreated(null); }, [summary]);

  // Новый отчёт → пере-подставить приоритет из ИИ (если мета уже загружена)
  useEffect(() => {
    if (!priorityHint || !meta) return;
    const m = matchPriority(priorityHint, meta.priorities);
    if (m) setPriority(m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityHint, meta]);

  useEffect(() => {
    getJiraSettings().then(setSettings).catch(e => setSettingsErr(String(e)));
  }, []);

  const tokenConfigured = Boolean(settings && (settings.token || settings.token_path));

  /* ── Мета проекта (приоритеты, компоненты, поля) ─────────────────── */
  const loadMeta = useCallback(async (proj: string) => {
    if (!proj.trim() || !tokenConfigured) return;
    setMetaLoading(true); setMetaErr(""); setMeta(null);
    try {
      const m = await getJiraMeta(proj.trim());
      setMeta(m);
      // приоритет из ИИ-отчёта → соответствующий приоритет Jira
      setPriority(prev => prev || matchPriority(priorityHint, m.priorities));
      try { localStorage.setItem("st_jira_project", proj.trim()); } catch { /* ignore */ }
    } catch (e) { setMetaErr(String(e)); }
    setMetaLoading(false);
  }, [tokenConfigured, priorityHint]);

  // Список всех доступных проектов — один раз при появлении токена
  useEffect(() => {
    if (!tokenConfigured) return;
    setProjectsLoading(true);
    getJiraProjects()
      .then(r => setProjects(r.projects))
      .catch(e => setMetaErr(String(e)))
      .finally(() => setProjectsLoading(false));
  }, [tokenConfigured]);

  useEffect(() => {
    if (project && tokenConfigured) loadMeta(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenConfigured]);

  /* ── Автопоиск эпиков ────────────────────────────────────────────── */
  useEffect(() => {
    if (!debEpic.trim() || !project.trim() || !tokenConfigured) { setEpics([]); return; }
    let alive = true;
    searchJiraEpics(project.trim(), debEpic.trim())
      .then(r => { if (alive) { setEpics(r.epics); setEpicOpen(true); } })
      .catch(() => { if (alive) setEpics([]); });
    return () => { alive = false; };
  }, [debEpic, project, tokenConfigured]);

  /* ── Автопоиск исполнителя — среди участников выбранного проекта ── */
  useEffect(() => {
    if (debUser.trim().length < 2 || !tokenConfigured) { setUsers([]); return; }
    let alive = true;
    searchJiraUsers(debUser.trim(), project.trim())
      .then(r => { if (alive) { setUsers(r.users); setUserOpen(true); } })
      .catch(() => { if (alive) setUsers([]); });
    return () => { alive = false; };
  }, [debUser, project, tokenConfigured]);

  /* ── Лейблы ──────────────────────────────────────────────────────── */
  const labelPresets = meta?.labels_presets ?? settings?.labels ?? [];
  const toggleLabel = (l: string) =>
    setLabels(prev => prev.includes(l) ? prev.filter(x => x !== l) : [...prev, l]);

  const addNewLabel = async () => {
    const l = newLabel.trim();
    if (!l) return;
    setNewLabel("");
    if (!labels.includes(l)) setLabels(prev => [...prev, l]);
    // новый пресет — сохраняем в настройки, чтобы был в списке в следующий раз
    if (settings && !labelPresets.includes(l)) {
      const next = { ...settings, labels: [...labelPresets, l] };
      setSettings(next);
      try { await saveJiraSettings(next); } catch { /* не критично */ }
    }
  };

  /* ── Создание ────────────────────────────────────────────────────── */
  const handleCreate = async () => {
    setCreating(true); setCreateErr(""); setCreated(null);
    try {
      const res = await createJiraDefect({
        project: project.trim(),
        summary: issueSummary.trim(),
        description,
        priority,
        labels,
        epic_key: epicKey,
        component,
        assignee,
        ke,
        environment,
        stand,
      });
      setCreated({ key: res.key, url: res.url, warnings: res.warnings });
    } catch (e) { setCreateErr(String(e)); }
    setCreating(false);
  };

  /* ── Нет токена — подсказка ──────────────────────────────────────── */
  if (settings && !tokenConfigured) return (
    <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-main mb-1">Jira не подключена</p>
          <p className="text-sm text-text-muted mb-3">
            Чтобы регистрировать дефекты в Jira, получите токен по логину/паролю Сигмы
            или укажите путь к файлу токена в настройках.
          </p>
          <button onClick={() => router.push("/settings")}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border-main rounded-lg text-xs font-semibold text-text-muted hover:bg-bg-subtle">
            <Settings2 className="w-3.5 h-3.5" /> Открыть настройки
          </button>
        </div>
      </div>
    </div>
  );

  if (settingsErr) return null;
  if (!settings) return null;

  const envField = meta?.fields?.environment;
  const standField = meta?.fields?.stand;

  return (
    <div className="bg-bg-card border border-border-main rounded-xl p-5 mb-4 animate-slide-up">
      <h3 className="text-sm font-semibold text-text-main mb-4 flex items-center gap-2">
        <Send className="w-4 h-4 text-primary" /> Регистрация в Jira
      </h3>

      {/* Проект */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
        <div>
          <label className={LBL}>
            Проект * {projectsLoading && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}
          </label>
          <Select
            value={project}
            onChange={(v) => { setProject(v); if (v) loadMeta(v); }}
            placeholder={projectsLoading ? "Загружаю проекты…" : "— выберите проект —"}
            searchable
            searchPlaceholder="Поиск по ключу или названию…"
          >
            <option value="">— выберите проект —</option>
            {projects.map(p => <option key={p.key} value={p.key}>{`${p.key} — ${p.name}`}</option>)}
          </Select>
          {metaErr && <p className="text-xs text-red-500 mt-1">{metaErr}</p>}
          {meta && !metaLoading && <p className="text-xs text-green-600 mt-1">Тип задачи: {meta.issuetype}</p>}
          {metaLoading && <p className="text-xs text-text-muted mt-1">Загружаю справочники проекта…</p>}
          {meta && meta.warnings.length > 0 && (
            <p className="text-xs text-amber-600 mt-1">{meta.warnings.join(" · ")}</p>
          )}
        </div>

        {/* Критичность */}
        <div>
          <label className={LBL}>Критичность</label>
          <Select value={priority} onChange={setPriority} placeholder="— приоритет —">
            <option value="">— приоритет —</option>
            {(meta?.priorities ?? []).map(p => <option key={p} value={p}>{p}</option>)}
          </Select>
        </div>

        {/* Название */}
        <div className="sm:col-span-2">
          <label className={LBL}>Название дефекта *</label>
          <input value={issueSummary} onChange={e => setIssueSummary(e.target.value)}
            placeholder="Краткое название дефекта" className={INPUT_CLS} />
        </div>

        {/* Лейблы */}
        <div className="sm:col-span-2">
          <label className={LBL}>Лейблы</label>
          <div className="flex flex-wrap items-center gap-1.5">
            {labelPresets.map(l => (
              <button key={l} type="button" onClick={() => toggleLabel(l)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                  labels.includes(l)
                    ? "border-primary/50 bg-[var(--color-active-bg)] text-primary"
                    : "border-border-main text-text-muted hover:text-text-main"
                }`}>
                {l}
              </button>
            ))}
            {labels.filter(l => !labelPresets.includes(l)).map(l => (
              <span key={l} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border border-primary/50 bg-[var(--color-active-bg)] text-primary">
                {l}
                <button onClick={() => toggleLabel(l)}><X className="w-3 h-3" /></button>
              </span>
            ))}
            <span className="flex items-center gap-1">
              <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addNewLabel()}
                placeholder="+ новый лейбл" className="w-28 border border-dashed border-border-main rounded-full px-2.5 py-1 text-xs bg-transparent text-text-main placeholder:text-text-muted/60 focus:outline-none focus:border-primary/50" />
              {newLabel.trim() && (
                <button onClick={addNewLabel} className="p-1 rounded-full text-primary hover:bg-bg-subtle">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              )}
            </span>
          </div>
        </div>

        {/* Эпик — автопоиск */}
        <div className="relative">
          <label className={LBL}>Эпик</label>
          <input
            value={epicKey ? `${epicKey} — ${epicQuery}` : epicQuery}
            onChange={e => { setEpicKey(""); setEpicQuery(e.target.value); }}
            onFocus={() => epics.length > 0 && setEpicOpen(true)}
            onBlur={() => setTimeout(() => setEpicOpen(false), 200)}
            placeholder="Начните вводить название эпика…"
            className={INPUT_CLS}
          />
          {epicOpen && epics.length > 0 && !epicKey && (
            <div className="absolute z-20 mt-1 w-full max-h-52 overflow-auto rounded-lg border border-border-main bg-bg-card shadow-lg">
              {epics.map(ep => (
                <button key={ep.key} type="button"
                  onMouseDown={() => { setEpicKey(ep.key); setEpicQuery(ep.summary); setEpicOpen(false); }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-bg-subtle">
                  <span className="font-mono text-xs text-primary mr-2">{ep.key}</span>
                  <span className="text-text-main">{ep.summary}</span>
                </button>
              ))}
            </div>
          )}
          {epicKey && (
            <button onClick={() => { setEpicKey(""); setEpicQuery(""); }}
              className="absolute right-2 top-8 p-1 text-text-muted hover:text-red-500">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Компонент */}
        <div>
          <label className={LBL}>Компонент</label>
          <Select value={component} onChange={setComponent} placeholder="— компонент —" searchable>
            <option value="">— компонент —</option>
            {(meta?.components ?? []).map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
        </div>

        {/* Исполнитель — автопоиск */}
        <div className="relative">
          <label className={LBL}>Исполнитель</label>
          <input
            value={assignee || assigneeQuery}
            onChange={e => { setAssignee(""); setAssigneeQuery(e.target.value); }}
            onFocus={() => users.length > 0 && setUserOpen(true)}
            onBlur={() => setTimeout(() => setUserOpen(false), 200)}
            placeholder="Логин или ФИО…"
            className={INPUT_CLS}
          />
          {userOpen && users.length > 0 && !assignee && (
            <div className="absolute z-20 mt-1 w-full max-h-52 overflow-auto rounded-lg border border-border-main bg-bg-card shadow-lg">
              {users.map(u => (
                <button key={u.name} type="button"
                  onMouseDown={() => { setAssignee(u.name); setUserOpen(false); }}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-bg-subtle">
                  <span className="text-text-main">{u.display}</span>
                  <span className="font-mono text-xs text-text-muted ml-2">{u.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* КЭ */}
        <div>
          <label className={LBL}>КЭ {meta?.fields?.ke ? `(${meta.fields.ke.name})` : ""}</label>
          <input value={ke} onChange={e => setKe(e.target.value)}
            placeholder="CI02264516" className={`${INPUT_CLS} font-mono`} />
        </div>

        {/* Среда обнаружения */}
        <div>
          <label className={LBL}>Среда обнаружения</label>
          {envField && envField.allowed.length > 0 ? (
            <Select value={environment} onChange={setEnvironment} placeholder="— среда —">
              <option value="">— среда —</option>
              {envField.allowed.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          ) : (
            <input value={environment} onChange={e => setEnvironment(e.target.value)}
              placeholder="ИФТ / ПСИ / ПРОМ" className={INPUT_CLS} />
          )}
        </div>

        {/* Стенд */}
        <div>
          <label className={LBL}>Стенд</label>
          {standField && standField.allowed.length > 0 ? (
            <Select value={stand} onChange={setStand} placeholder="— стенд —">
              <option value="">— стенд —</option>
              {standField.allowed.map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          ) : (
            <input value={stand} onChange={e => setStand(e.target.value)}
              placeholder="Название стенда" className={INPUT_CLS} />
          )}
        </div>
      </div>

      {/* Результат / ошибка / кнопка */}
      {createErr && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {createErr}
        </div>
      )}
      {created && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Дефект создан:
            <a href={created.url} target="_blank" rel="noreferrer"
              className="font-semibold underline flex items-center gap-1">
              {created.key} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
          {created.warnings && created.warnings.length > 0 && (
            <p className="mt-1 text-xs text-amber-700">{created.warnings.join(" · ")}</p>
          )}
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <button onClick={handleCreate}
          disabled={creating || !project.trim() || !issueSummary.trim() || Boolean(created)}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-40 transition-all">
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {creating ? "Создаю…" : created ? "Создано" : "Зарегистрировать в Jira"}
        </button>
      </div>
    </div>
  );
}
