"use client";

import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { formatBug } from "@/lib/api";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { PRIORITIES, mockGenerated, projectOf, type Participant } from "@/lib/jiraTool";

const PLATFORMS = ["Back", "Front", "Mobile", "Analytics", "Design", "DevOps"];

export interface NewDefect {
  summary: string;
  description: string;
  priority: string;
  component: string;
  participantId: string;
}

/**
 * Новый дефект из списка. Тема и описание пишутся своими словами;
 * «Сгенерировать» (по желанию) прогоняет текст через привычную генерацию
 * баг-репорта и заполняет тему и описание. Если LLM недоступна — показывает
 * пример, чтобы путь можно было пройти и без неё.
 */
export default function CreateDefectModal({ open, project, participants, onCreate, onClose }: {
  open: boolean;
  project: string;
  participants: Participant[];
  onCreate: (d: NewDefect) => void;
  onClose: () => void;
}) {
  const { provider } = useWorkspace();
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [platform, setPlatform] = useState("Back");
  const [priority, setPriority] = useState("Средний");
  const components = projectOf(project).components;
  const [component, setComponent] = useState(components[0]);
  const [participantId, setParticipantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [generated, setGenerated] = useState(false);

  const generate = async () => {
    setBusy(true); setNote("");
    try {
      const res = await formatBug({ platform, feature: summary, description, provider });
      setSummary(res.title || summary);
      setDescription(res.description || res.report);
      // Генерация отвечает «Критический», в Jira Сбера — «Критичный».
      const prio = res.priority === "Критический" ? "Критичный" : res.priority;
      if (prio && PRIORITIES.includes(prio)) setPriority(prio);
      setNote("Сгенерировано. Проверьте тему и описание перед созданием.");
    } catch (e) {
      const m = mockGenerated(description || summary, platform);
      setSummary(m.title); setDescription(m.description); setPriority(m.priority);
      setNote(`LLM недоступна (${(e as Error).message.slice(0, 120)}). Подставлен пример генерации, чтобы пройти путь до конца.`);
    }
    setGenerated(true);
    setBusy(false);
  };

  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
  const label = "block text-xs font-semibold text-text-muted mb-1.5";

  return (
    <Modal open={open} onClose={onClose} title={`Новый дефект · ${projectOf(project).name}`} size="max-w-3xl">
      <div className="space-y-4">
        <div>
          <label htmlFor="def-summary" className={label}>Тема</label>
          <input id="def-summary" autoFocus value={summary} onChange={e => setSummary(e.target.value)} maxLength={255}
            placeholder="Коротко, что сломалось — или оставьте пустым и нажмите «Сгенерировать»" className={field} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label htmlFor="def-desc" className="text-xs font-semibold text-text-muted">Описание</label>
            <div className="flex items-center gap-2">
              <select value={platform} onChange={e => setPlatform(e.target.value)} aria-label="Слой для генерации"
                className="text-xs border border-border-main rounded-md px-2 py-1 bg-[var(--color-input-bg)] text-text-main">
                {PLATFORMS.map(p => <option key={p}>{p}</option>)}
              </select>
              <button type="button" onClick={generate} disabled={busy || !(description.trim() || summary.trim())}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-violet-500 to-indigo-500 text-white
                  text-xs font-semibold hover:opacity-90 disabled:opacity-40">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                {busy ? "Генерирую…" : generated ? "Сгенерировать заново" : "Сгенерировать"}
              </button>
            </div>
          </div>
          <textarea id="def-desc" value={description} onChange={e => setDescription(e.target.value)} rows={10}
            placeholder="Опишите своими словами: что делали, что получили, что ожидали. Можно вставить кусок лога или JSON."
            className={`${field} resize-y font-mono text-[13px]`} />
          {note && <p className="text-xs text-text-muted mt-1.5">{note}</p>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="def-prio" className={label}>Приоритет</label>
            <select id="def-prio" value={priority} onChange={e => setPriority(e.target.value)} className={field}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="def-comp" className={label}>Компонент</label>
            <select id="def-comp" value={component} onChange={e => setComponent(e.target.value)} className={field}>
              {components.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="def-ptc" className={label}>Участник</label>
            <select id="def-ptc" value={participantId} onChange={e => setParticipantId(e.target.value)} className={field}>
              <option value="">— не назначен</option>
              {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <p className="text-[11px] text-text-muted">Демо: дефект создаётся в мок-Jira этого браузера, в настоящую Jira ничего не уходит.</p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={!summary.trim() || busy}
              onClick={() => { onCreate({ summary: summary.trim(), description, priority, component, participantId }); onClose(); }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              Создать дефект
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
