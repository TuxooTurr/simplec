"use client";

import { useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { CATEGORY_LABEL, STORY_TYPES, typeCategory, type Category } from "@/lib/jiraTool";
import {
  DEFAULT_STAGE_STYLE, STAGES, STAGE_KEYS, defaultMapping, stageStyle,
  type Stage, type StageKey, type StageMapping, type StageStyles,
} from "@/lib/jiraStages";
import { getProjectStatuses } from "@/lib/jiraToolApi";

type Cat = Exclude<Category, "epic">;
const CATS: Cat[] = ["story", "defect", "other"];
type Tab = Cat | "look";

/** Подписи, которые уже заняты служебными состояниями — статус (st) так назвать нельзя (спутаются группы). */
const RESERVED = ["нет сторей", "не сопоставлен"];

/**
 * Настройка этапов: какой статус Jira какому этапу SimpleTest соответствует.
 * Своя таблица на проект и на группу задач (стори, дефекты, прочие).
 * Эпик не настраивается: его этап считается по сторям.
 * Статусы группы — из workflow проекта в Jira: все статусы её типов задач.
 * Вкладка «Названия и цвета» — свои названия и цвета статусов (st), общие на все списки.
 */
export default function StageMappingModal({ open, project, projects, mapping, styles, onSave, onClose }: {
  open: boolean;
  project: string;
  /** Проекты списков — между ними переключается таблица. */
  projects: string[];
  mapping: StageMapping;
  styles: StageStyles;
  onSave: (next: StageMapping, styles: StageStyles) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<StageMapping>(() => structuredClone(mapping));
  const [proj, setProj] = useState(project);
  const [tab, setTab] = useState<Tab>("story");
  const cat: Cat = tab === "look" ? "story" : tab;
  const [look, setLook] = useState<StageStyles>(() => structuredClone(styles));
  const lbl = (k: StageKey) => look[k]?.label ?? DEFAULT_STAGE_STYLE[k].label;
  const col = (k: StageKey) => look[k]?.color ?? DEFAULT_STAGE_STYLE[k].color;
  const setLookOf = (k: StageKey, p: { label?: string; color?: string }) => setLook(l => ({ ...l, [k]: { ...l[k], ...p } }));
  const resetLook = (k: StageKey) => setLook(l => { const n = { ...l }; delete n[k]; return n; });

  // Названия должны быть разными: по названию статус (st) группируется и сортируется.
  const names = STAGE_KEYS.map(k => lbl(k).trim().toLowerCase());
  const lookErr = names.some(n => !n) ? "Название статуса не может быть пустым"
    : names.some((n, i) => names.indexOf(n) !== i) ? "Названия статусов (st) должны различаться"
    : names.some(n => RESERVED.includes(n)) ? "«Нет сторей» и «Не сопоставлен» — служебные подписи, выберите другое название" : "";

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
          {tab !== "look" && (
            <label className="flex items-center gap-2 text-sm text-text-muted">
              Проект
              <select value={proj} onChange={e => setProj(e.target.value)}
                className="text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main">
                {Array.from(new Set([project, ...projects])).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          )}
          <div className="flex gap-1" role="tablist">
            {CATS.map(c => (
              <button key={c} type="button" role="tab" aria-selected={tab === c} onClick={() => setTab(c)} className={tabCls(tab === c)}>
                {CATEGORY_LABEL[c]}
              </button>
            ))}
            <button type="button" role="tab" aria-selected={tab === "look"} onClick={() => setTab("look")} className={tabCls(tab === "look")}>
              Названия и цвета
            </button>
          </div>
        </div>

        {tab === "look" ? (
          <>
            <div className="rounded-xl bg-bg-subtle p-3 text-xs text-text-muted leading-relaxed">
              Название и цвет каждого статуса (st) — общие для всех списков и проектов. Смысл статуса не меняется:
              эпик по-прежнему берёт самую отстающую стори, «Заблокирован» ставится по блокирующему дефекту.
            </div>
            <div className="border border-border-main rounded-xl divide-y divide-border-main">
              {STAGE_KEYS.map(k => (
                <div key={k} className="flex items-center gap-3 px-3 py-2">
                  <input type="color" value={col(k)} onChange={e => setLookOf(k, { color: e.target.value })}
                    aria-label={`Цвет статуса «${lbl(k)}»`} title="Цвет"
                    className="w-8 h-8 flex-shrink-0 rounded-md border border-border-main bg-transparent cursor-pointer p-0.5" />
                  <input value={lbl(k)} onChange={e => setLookOf(k, { label: e.target.value })} maxLength={40}
                    aria-label={`Название статуса (по умолчанию «${DEFAULT_STAGE_STYLE[k].label}»)`}
                    className="min-w-0 flex-1 text-sm border border-border-main rounded-lg px-2.5 py-1.5 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <span className="w-36 flex-shrink-0">
                    <span className="inline-block max-w-full truncate px-2 py-0.5 rounded-md text-[11px] font-medium align-middle"
                      style={stageStyle(k, col(k))}>{lbl(k) || "—"}</span>
                  </span>
                  <span className="w-20 flex-shrink-0 text-[10px] text-text-muted">
                    {k === "blocked" ? "блок. дефект" : k === "excluded" ? "не считается" : "этап"}
                  </span>
                  <button type="button" onClick={() => resetLook(k)} disabled={!look[k]} title={`Вернуть «${DEFAULT_STAGE_STYLE[k].label}» и цвет по умолчанию`}
                    aria-label={`Вернуть по умолчанию: ${DEFAULT_STAGE_STYLE[k].label}`}
                    className="p-1.5 rounded-md text-text-muted hover:text-text-main disabled:opacity-30"><RotateCcw className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            {lookErr && <p className="text-xs text-red-600" role="alert">{lookErr}</p>}
          </>
        ) : (
          <>
            <div className="rounded-xl bg-bg-subtle p-3 text-xs text-text-muted leading-relaxed">
              <b className="text-text-main">Эпик</b> настраивать не нужно: его статус (st) — статус самой отстающей стори, привязанной
              через Epic Link. Стори — это типы {STORY_TYPES.join(", ")}. Стори в «{lbl("excluded")}» не учитываются;
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
                          style={table[s] === st ? stageStyle(st, col(st)) : undefined}
                          className={`px-2 py-1 rounded-md text-[11px] transition-colors
                            ${table[s] === st ? "font-semibold" : "text-text-muted hover:bg-bg-subtle"}`}>
                          {lbl(st)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-2">
          {tab !== "look" && (
            <button type="button" onClick={reset} className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-main">
              <RotateCcw className="w-3.5 h-3.5" /> Вернуть сопоставление по названиям статусов
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={!!lookErr} title={lookErr || undefined}
              onClick={() => {
                // Названия — без пробелов по краям; совпадающее с умолчанием не храним.
                const clean: StageStyles = {};
                for (const k of STAGE_KEYS) {
                  const label = lbl(k).trim(), color = col(k);
                  const v: { label?: string; color?: string } = {};
                  if (label !== DEFAULT_STAGE_STYLE[k].label) v.label = label;
                  if (color.toLowerCase() !== DEFAULT_STAGE_STYLE[k].color) v.color = color;
                  if (v.label || v.color) clean[k] = v;
                }
                onSave(draft, clean); onClose();
              }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">Сохранить</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
