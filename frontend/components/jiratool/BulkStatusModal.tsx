"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, MinusCircle, XCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { RESOLUTIONS, WORKFLOWS, categoryOf, transitionsOf, type Issue } from "@/lib/jiraTool";

export interface StatusChange { key: string; status: string; resolution: string | null }

type Verdict = { issue: Issue; kind: "go" | "same" | "no-transition" | "epic" };

/**
 * Массовая смена статуса. В Jira статус меняется только переходом workflow,
 * поэтому для каждой задачи проверяем, есть ли переход из её текущего статуса.
 * Эпики пропускаем: их этап считается по сторям, руками его не двигаем.
 */
export default function BulkStatusModal({ open, issues, onApply, onClose }: {
  open: boolean;
  issues: Issue[];
  onApply: (changes: StatusChange[]) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [resolution, setResolution] = useState("");

  const movable = issues.filter(i => categoryOf(i) !== "epic");
  const epics = issues.length - movable.length;

  // Куда можно перевести и сколько задач туда перейдёт.
  const counts = new Map<string, number>();
  for (const i of movable) for (const t of transitionsOf(i)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const targets = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const verdicts: Verdict[] = issues.map(issue => {
    if (categoryOf(issue) === "epic") return { issue, kind: "epic" };
    if (!target) return { issue, kind: "no-transition" };
    if (issue.fields.status === target) return { issue, kind: "same" };
    return { issue, kind: transitionsOf(issue).includes(target) ? "go" : "no-transition" };
  });
  const go = verdicts.filter(v => v.kind === "go");
  const needRes = go.some(v => WORKFLOWS[categoryOf(v.issue)].needResolution.includes(target));

  // Почему нельзя: группируем по исходному статусу — так видно, какой переход отсутствует.
  const blocked = new Map<string, number>();
  for (const v of verdicts) if (target && v.kind === "no-transition") {
    const s = String(v.issue.fields.status ?? "");
    blocked.set(s, (blocked.get(s) ?? 0) + 1);
  }

  const apply = () => {
    onApply(go.map(v => ({ key: v.issue.key, status: target, resolution: needRes ? resolution : null })));
    onClose();
  };
  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={onClose} title={`Сменить статус: выбрано ${issues.length}`} size="max-w-2xl">
      <div className="space-y-4">
        {movable.length === 0 ? (
          <p className="text-sm text-text-muted">Выбраны только эпики. Их этап считается по сторям — двигайте стори.</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold text-text-muted mb-1.5">Перевести в статус</p>
              <div className="flex flex-wrap gap-1.5">
                {targets.length === 0 && <span className="text-sm text-text-muted">Из текущих статусов переходов нет.</span>}
                {targets.map(([t, n]) => (
                  <button key={t} type="button" onClick={() => { setTarget(t); setResolution(""); }} aria-pressed={target === t}
                    className={`px-3 py-1.5 rounded-lg border text-sm transition-colors
                      ${target === t ? "border-primary bg-primary/10 text-primary font-medium" : "border-border-main text-text-main hover:bg-bg-subtle"}`}>
                    {t} <span className="text-[11px] text-text-muted">· {n} из {movable.length}</span>
                  </button>
                ))}
              </div>
            </div>

            {target && needRes && (
              <div>
                <label htmlFor="bulk-res" className="block text-xs font-semibold text-text-muted mb-1.5">
                  Решение — Jira требует его при переходе в «{target}»
                </label>
                <select id="bulk-res" value={resolution} onChange={e => setResolution(e.target.value)} className={field}>
                  <option value="">— выберите</option>
                  {RESOLUTIONS.map(r => <option key={r}>{r}</option>)}
                </select>
              </div>
            )}

            {target && (
              <div className="border border-border-main rounded-xl divide-y divide-border-main text-sm">
                <p className="flex items-center gap-2 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4" /> Перейдут в «{target}»: <b>{go.length}</b>
                </p>
                {[...blocked.entries()].map(([from, n]) => (
                  <p key={from} className="flex items-center gap-2 px-3 py-2 text-text-muted">
                    <XCircle className="w-4 h-4 text-red-500" /> Нет перехода из «{from}» <ArrowRight className="w-3 h-3" /> «{target}»: <b>{n}</b>
                  </p>
                ))}
                {verdicts.some(v => v.kind === "same") && (
                  <p className="flex items-center gap-2 px-3 py-2 text-text-muted">
                    <MinusCircle className="w-4 h-4" /> Уже в этом статусе: <b>{verdicts.filter(v => v.kind === "same").length}</b>
                  </p>
                )}
              </div>
            )}
          </>
        )}
        {epics > 0 && (
          <p className="text-xs text-text-muted">Эпики ({epics}) пропущены: их этап считается по сторям.</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <p className="text-[11px] text-text-muted">Демо: статус меняется в мок-Jira этого браузера.</p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" onClick={apply} disabled={!go.length || (needRes && !resolution)}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              Перевести {go.length || ""}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
