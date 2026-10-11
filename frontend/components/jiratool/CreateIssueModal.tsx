"use client";

import { useState } from "react";
import { BookOpen, Bug, CheckSquare, Flag } from "lucide-react";
import Modal from "@/components/ui/Modal";
import CreateDefectModal, { type NewDefect } from "./CreateDefectModal";
import { CREATE_TYPES, PRIORITIES, projectOf, type Issue, type Participant } from "@/lib/jiraTool";

export interface NewIssue {
  type: string;
  summary: string;
  description: string;
  priority: string;
  component: string;
  epicLink: string;
  participantId: string;
}

const ICONS: Record<string, typeof Bug> = { "Дефект": Bug, "История": BookOpen, "Задача": CheckSquare, "Epic": Flag };

/**
 * «Создать задачу»: сначала тип. Дефект — наша форма с генерацией описания,
 * остальные типы — короткая форма (стори и задачу можно сразу привязать к эпику).
 */
export default function CreateIssueModal({ open, project, participants, epics, onCreateDefect, onCreate, onClose }: {
  open: boolean;
  project: string;
  participants: Participant[];
  /** Эпики проекта — для Epic Link у стори и задачи. */
  epics: Issue[];
  onCreateDefect: (d: NewDefect) => void;
  onCreate: (i: NewIssue) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<string | null>(null);
  const components = projectOf(project).components;
  const [form, setForm] = useState({ summary: "", description: "", priority: "Средний", component: components[0], epicLink: "", participantId: "" });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }));

  if (type === "Дефект") {
    return <CreateDefectModal open project={project} participants={participants} onCreate={onCreateDefect} onClose={onClose} />;
  }

  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
  const label = "block text-xs font-semibold text-text-muted mb-1.5";

  if (!type) {
    return (
      <Modal open={open} onClose={onClose} title={`Создать задачу · ${projectOf(project).name}`} size="max-w-xl">
        <p className="text-sm text-text-muted mb-3">Какой тип задачи создаём?</p>
        <div className="grid grid-cols-2 gap-2">
          {CREATE_TYPES.map(({ type: t, hint }) => {
            const Icon = ICONS[t] ?? CheckSquare;
            return (
              <button key={t} type="button" onClick={() => setType(t)}
                className="flex items-start gap-3 p-3 rounded-xl border border-border-main text-left hover:border-primary/50 hover:bg-primary/5 transition-colors">
                <Icon className={`w-5 h-5 mt-0.5 ${t === "Дефект" ? "text-red-500" : t === "Epic" ? "text-purple-500" : "text-primary"}`} />
                <span>
                  <span className="block text-sm font-semibold text-text-main">{t}</span>
                  <span className="block text-xs text-text-muted">{hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Новая задача: ${type} · ${projectOf(project).name}`} size="max-w-2xl">
      <div className="space-y-4">
        <div>
          <label htmlFor="ni-summary" className={label}>{type === "Epic" ? "Название эпика" : "Тема"}</label>
          <input id="ni-summary" autoFocus value={form.summary} onChange={set("summary")} maxLength={255} className={field} />
        </div>
        <div>
          <label htmlFor="ni-desc" className={label}>Описание</label>
          <textarea id="ni-desc" value={form.description} onChange={set("description")} rows={5} className={`${field} resize-y`} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ni-prio" className={label}>Приоритет</label>
            <select id="ni-prio" value={form.priority} onChange={set("priority")} className={field}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ni-comp" className={label}>Компонент</label>
            <select id="ni-comp" value={form.component} onChange={set("component")} className={field}>
              {components.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          {type !== "Epic" && (
            <div>
              <label htmlFor="ni-epic" className={label}>Эпик (Epic Link)</label>
              <select id="ni-epic" value={form.epicLink} onChange={set("epicLink")} className={field}>
                <option value="">— без эпика</option>
                {epics.map(e => <option key={e.key} value={e.key}>{e.key} · {String(e.fields.summary ?? "")}</option>)}
              </select>
            </div>
          )}
          <div>
            <label htmlFor="ni-ptc" className={label}>Участник</label>
            <select id="ni-ptc" value={form.participantId} onChange={set("participantId")} className={field}>
              <option value="">— не назначен</option>
              {participants.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button type="button" onClick={() => setType(null)} className="text-xs text-text-muted hover:text-text-main">← Другой тип</button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={!form.summary.trim()}
              onClick={() => { onCreate({ type, ...form, summary: form.summary.trim() }); onClose(); }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              Создать
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
