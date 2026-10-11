"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, MinusCircle, XCircle } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { RESOLUTIONS, categoryOf, type Issue } from "@/lib/jiraTool";
import { applyTransitions, getTransitions, type Transition } from "@/lib/jiraToolApi";

type Verdict = { issue: Issue; kind: "go" | "same" | "no-transition" | "epic" | "error"; tr?: Transition };

/**
 * Массовая смена статуса в Jira. Статус меняется только переходом workflow, поэтому
 * сначала спрашиваем у Jira, какие переходы доступны каждой задаче сейчас (с учётом
 * прав токена), и показываем, сколько задач перейдёт и почему остальные — нет.
 * Эпики пропускаем: их статус (st) считается по сторям, руками его не двигаем.
 */
export default function BulkStatusModal({ open, issues, onDone, onClose }: {
  open: boolean;
  issues: Issue[];
  /** Переходы выполнены: ключи задач, которые надо перечитать из Jira. */
  onDone: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState("");
  const [resolution, setResolution] = useState("");
  const [avail, setAvail] = useState<Record<string, { transitions?: Transition[]; error?: string }> | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ key: string; error?: string }[]>([]);

  const movable = issues.filter(i => categoryOf(i) !== "epic" && !i.local);
  const skipped = issues.length - movable.length;
  const movableKeys = movable.map(i => i.key).join(",");

  useEffect(() => {
    if (!movableKeys) return;
    getTransitions(movableKeys.split(",")).then(r => setAvail(r.issues)).catch(e => setLoadErr((e as Error).message));
  }, [movableKeys]);

  const trOf = (i: Issue) => avail?.[i.key]?.transitions ?? [];

  // Куда можно перевести и сколько задач туда перейдёт (по статусу назначения перехода).
  const counts = new Map<string, number>();
  for (const i of movable) for (const to of new Set(trOf(i).map(t => t.to))) counts.set(to, (counts.get(to) ?? 0) + 1);
  const targets = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const verdicts: Verdict[] = issues.map(issue => {
    if (categoryOf(issue) === "epic" || issue.local) return { issue, kind: "epic" };
    if (avail?.[issue.key]?.error) return { issue, kind: "error" };
    if (!target) return { issue, kind: "no-transition" };
    if (issue.fields.status === target) return { issue, kind: "same" };
    const tr = trOf(issue).find(t => t.to === target);
    return tr ? { issue, kind: "go", tr } : { issue, kind: "no-transition" };
  });
  const go = verdicts.filter(v => v.kind === "go");
  const needRes = go.some(v => v.tr?.resolution_required);
  const errors = verdicts.filter(v => v.kind === "error");

  // Почему нельзя: группируем по исходному статусу — так видно, какой переход отсутствует.
  const blocked = new Map<string, number>();
  for (const v of verdicts) if (target && v.kind === "no-transition") {
    const s = String(v.issue.fields.status ?? "");
    blocked.set(s, (blocked.get(s) ?? 0) + 1);
  }

  const apply = async () => {
    setBusy(true); setFailed([]);
    try {
      const r = await applyTransitions(go.map(v => ({ key: v.issue.key, transition_id: v.tr!.id, resolution: needRes ? resolution : "" })));
      onDone(go.map(v => v.issue.key));
      const bad = r.results.filter(x => !x.ok);
      if (bad.length) setFailed(bad); else onClose();
    } catch (e) { setFailed([{ key: "—", error: (e as Error).message }]); }
    setBusy(false);
  };
  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={onClose} title={`Сменить статус в Jira: выбрано ${issues.length}`} size="max-w-2xl">
      <div className="space-y-4">
        {movable.length === 0 ? (
          <p className="text-sm text-text-muted">Выбраны только эпики и черновики. Этап эпика считается по сторям, черновика в Jira ещё нет.</p>
        ) : loadErr ? (
          <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">
            Переходы не загрузились: {loadErr}
          </p>
        ) : !avail ? (
          <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Спрашиваю у Jira доступные переходы…</p>
        ) : (
          <>
            <div>
              <p className="text-xs font-semibold text-text-muted mb-1.5">Перевести в статус</p>
              <div className="flex flex-wrap gap-1.5">
                {targets.length === 0 && <span className="text-sm text-text-muted">Из текущих статусов переходов нет.</span>}
                {targets.map(([t, n]) => (
                  <button key={t} type="button" onClick={() => { setTarget(t); setResolution(""); setFailed([]); }} aria-pressed={target === t}
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
            {errors.length > 0 && (
              <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                Переходы не получены для {errors.map(v => v.issue.key).join(", ")}: {avail[errors[0].issue.key]?.error}
              </p>
            )}
          </>
        )}
        {skipped > 0 && (
          <p className="text-xs text-text-muted">Пропущены эпики и черновики ({skipped}): этап эпика считается по сторям, черновика в Jira ещё нет.</p>
        )}
        {failed.length > 0 && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5 space-y-1">
            <p className="font-semibold">Jira не выполнила переход для {failed.length}:</p>
            {failed.map(f => <p key={f.key}>{f.key}: {f.error}</p>)}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">
              {failed.length ? "Закрыть" : "Отмена"}
            </button>
            <button type="button" onClick={apply} disabled={busy || !go.length || (needRes && !resolution)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Перевести {go.length || ""}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
