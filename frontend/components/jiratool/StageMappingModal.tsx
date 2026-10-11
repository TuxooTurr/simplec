"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { CATEGORY_LABEL, STORY_TYPES, typeCategory, type Category } from "@/lib/jiraTool";
import { STAGES, STAGE_CLS, STAGE_LABEL, defaultMapping, type Stage, type StageMapping } from "@/lib/jiraStages";
import { getProjectStatuses } from "@/lib/jiraToolApi";

type Cat = Exclude<Category, "epic">;
const CATS: Cat[] = ["story", "defect", "other"];

/**
 * Настройка этапов: какой статус Jira какому этапу SimpleTest соответствует.
 * Своя таблица на проект и на группу задач (стори, дефекты, прочие).
 * Эпик не настраивается: его этап считается по сторям.
 * Статусы группы — из workflow проекта в Jira: все статусы её типов задач.
 */
export default function StageMappingModal({ open, project, projects, mapping, onSave, onClose }: {
  open: boolean;
  project: string;
  /** Проекты списков — между ними переключается таблица. */
  projects: string[];
  mapping: StageMapping;
  onSave: (next: StageMapping) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<StageMapping>(() => structuredClone(mapping));
  const [proj, setProj] = useState(project);
  const [cat, setCat] = useState<Cat>("story");

  const [types, setTypes] = useState<Record<string, string[]> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setTypes(null); setErr("");
    getProjectStatuses(proj).then(r => setTypes(r.types)).catch(e => { setTypes({}); setErr((e as Error).message); });
  }, [proj]);

  // Статусы группы — объединение статусов всех её типов задач в проекте.
  const jiraStatuses = Array.from(new Set(Object.entries(types ?? {})
    .filter(([t]) => typeCategory(t) === cat).flatMap(([, st]) => st)));
  const saved = draft[proj]?.[cat];
  const table = saved ?? defaultMapping(jiraStatuses);
  const statuses = Array.from(new Set([...jiraStatuses, ...Object.keys(table)]));

  const set = (status: string, stage: Stage) => setDraft(d => ({
    ...d, [proj]: { ...d[proj], [cat]: { ...(d[proj]?.[cat] ?? defaultMapping(jiraStatuses)), [status]: stage } },
  }));
  const reset = () => setDraft(d => {
    const p = { ...d[proj] };
    delete p[cat];
    return { ...d, [proj]: p };
  });

  const tabCls = (on: boolean) => `px-3 py-1.5 rounded-lg text-sm transition-colors
    ${on ? "bg-primary/10 text-primary font-medium" : "text-text-muted hover:text-text-main"}`;

  return (
    <Modal open={open} onClose={onClose} title="Статус (st): сопоставление со статусами Jira" size="max-w-3xl">
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-sm text-text-muted">
            Проект
            <select value={proj} onChange={e => setProj(e.target.value)}
              className="text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main">
              {Array.from(new Set([project, ...projects])).map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className="flex gap-1" role="tablist">
            {CATS.map(c => (
              <button key={c} type="button" role="tab" aria-selected={cat === c} onClick={() => setCat(c)} className={tabCls(cat === c)}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-xl bg-bg-subtle p-3 text-xs text-text-muted leading-relaxed">
          <b className="text-text-main">Эпик</b> настраивать не нужно: его статус (st) — статус самой отстающей стори, привязанной
          через Epic Link. Стори — это типы {STORY_TYPES.join(", ")}. Стори в «Исключено» не учитываются;
          эпик без сторей остаётся без статуса и подсвечивается красным.
          {!saved && <> Таблица ещё не сохранена — статусы сопоставлены по названиям, проверьте и сохраните.</>}
        </div>
        {err && <p className="text-xs text-red-600">Статусы проекта не загрузились из Jira: {err}</p>}

        <div className="border border-border-main rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-2 bg-bg-subtle text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <span>Статус Jira</span><span>Статус (st)</span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto scrollbar-thin divide-y divide-border-main">
            {types === null && (
              <p className="flex items-center gap-2 px-3 py-3 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю статусы {proj} из Jira…</p>
            )}
            {types !== null && !err && statuses.length === 0 && (
              <p className="px-3 py-3 text-sm text-text-muted">В проекте {proj} нет типов задач группы «{CATEGORY_LABEL[cat]}».</p>
            )}
            {statuses.map(s => (
              <div key={s} className="grid grid-cols-[1fr_auto] gap-x-4 items-center px-3 py-1.5">
                <span className="text-sm text-text-main">{s}</span>
                <div className="flex gap-1" role="radiogroup" aria-label={`Этап для «${s}»`}>
                  {STAGES.map(st => (
                    <button key={st} type="button" role="radio" aria-checked={table[s] === st} onClick={() => set(s, st)}
                      className={`px-2 py-1 rounded-md text-[11px] transition-colors
                        ${table[s] === st ? `${STAGE_CLS[st]} font-semibold ring-1 ring-current` : "text-text-muted hover:bg-bg-subtle"}`}>
                      {STAGE_LABEL[st]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={reset} className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main">
            <RotateCcw className="w-3.5 h-3.5" /> Вернуть сопоставление по названиям статусов
          </button>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" onClick={() => { onSave(draft); onClose(); }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90">Сохранить</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
