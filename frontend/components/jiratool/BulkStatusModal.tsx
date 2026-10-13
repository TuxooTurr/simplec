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
 * Выбранный эпик сам статус не меняет: переводятся все его стори (по Epic Link) —
 * так эпик двигается через свой состав, а статус (st) эпика пересчитается по сторям.
 *
 * После перевода окно не закрывается: переходы запрашиваются заново уже из новых статусов,
 * и можно сделать следующий шаг — так задачи из разных статусов доводятся до одного.
 */
export default function BulkStatusModal({ open, issues, storiesOf, onDone, onClose }: {
  open: boolean;
  issues: Issue[];
  /** Стори эпика (Epic Link) — на них раскладывается выбранный эпик. */
  storiesOf: (epicKey: string) => Issue[];
  /** Переходы выполнены: ключи задач, которые надо перечитать из Jira. */
  onDone: (keys: string[]) => void;
  /** moved — хоть одна задача сменила статус (тогда выбор в списке сбрасывается). */
  onClose: (moved: boolean) => void;
}) {
  const [target, setTarget] = useState("");
  const [resolution, setResolution] = useState("");
  const [avail, setAvail] = useState<Record<string, { transitions?: Transition[]; error?: string }> | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ key: string; error?: string }[]>([]);
  /** Шаг перевода: после него переходы запрашиваются заново. */
  const [round, setRound] = useState(0);
  /** Новый статус задач, переведённых в этом окне (список подтянется из Jira позже). */
  const [moved, setMoved] = useState<Record<string, string>>({});
  /** Сделанные шаги — чтобы было видно, что уже выполнено. */
  const [steps, setSteps] = useState<{ to: string; n: number }[]>([]);

  // Эпик → его стори; дубли (стори выбрана и сама, и через эпик) — один раз.
  const epics = issues.filter(i => categoryOf(i) === "epic");
  const movable = Array.from(new Map(
    [...issues.filter(i => categoryOf(i) !== "epic"), ...epics.flatMap(e => storiesOf(e.key))]
      .filter(i => !i.local).map(i => [i.key, i] as const),
  ).values());
  const drafts = issues.filter(i => i.local).length;
  const emptyEpics = epics.filter(e => !storiesOf(e.key).length);
  const movableKeys = movable.map(i => i.key).join(",");

  useEffect(() => {
    if (!movableKeys) return;
    let live = true;
    setAvail(null); setLoadErr("");
    getTransitions(movableKeys.split(","))
      .then(r => { if (live) setAvail(r.issues); })
      .catch(e => { if (live) setLoadErr((e as Error).message); });
    return () => { live = false; };
  }, [movableKeys, round]);

  const trOf = (i: Issue) => avail?.[i.key]?.transitions ?? [];
  const statusOf = (i: Issue) => moved[i.key] ?? String(i.fields.status ?? "");

  // Где задачи сейчас — по этой сводке видно, сколько шагов осталось до одного статуса.
  const now = new Map<string, number>();
  for (const i of movable) now.set(statusOf(i), (now.get(statusOf(i)) ?? 0) + 1);
  const nowList = [...now.entries()].sort((a, b) => b[1] - a[1]);

  // Куда можно перевести и сколько задач туда перейдёт (по статусу назначения перехода).
  const counts = new Map<string, number>();
  for (const i of movable) for (const to of new Set(trOf(i).map(t => t.to))) counts.set(to, (counts.get(to) ?? 0) + 1);
  const targets = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  const verdicts: Verdict[] = movable.map(issue => {
    if (avail?.[issue.key]?.error) return { issue, kind: "error" };
    if (!target) return { issue, kind: "no-transition" };
    if (statusOf(issue) === target) return { issue, kind: "same" };
    const tr = trOf(issue).find(t => t.to === target);
    return tr ? { issue, kind: "go", tr } : { issue, kind: "no-transition" };
  });
  const go = verdicts.filter(v => v.kind === "go");
  const needRes = go.some(v => v.tr?.resolution_required);
  /**
   * Варианты «Решения» — только те, что Jira разрешает на выбранных переходах (у разных задач переходы
   * могут разрешать разное — берём общие). Общий справочник решений сюда не годится: Jira отвергает
   * чужое для перехода решение («Некорректное имя резолюции»). Значение — id варианта.
   */
  const resLists = go.map(v => v.tr?.resolutions ?? []).filter(l => l.length);
  const resOptions: { id: string; name: string }[] = resLists.length
    ? resLists.reduce((acc, l) => acc.filter(a => l.some(x => x.id === a.id)))
    // Jira не прислала допустимые решения — запасной путь: общий справочник по названию.
    : RESOLUTIONS.map(r => ({ id: r, name: r }));
  const resConflict = resLists.length > 0 && resOptions.length === 0;
  const errors = verdicts.filter(v => v.kind === "error");

  // Почему нельзя: группируем по исходному статусу — так видно, какой переход отсутствует.
  const blocked = new Map<string, number>();
  for (const v of verdicts) if (target && v.kind === "no-transition") {
    const s = statusOf(v.issue);
    blocked.set(s, (blocked.get(s) ?? 0) + 1);
  }

  const apply = async () => {
    setBusy(true); setFailed([]);
    try {
      const r = await applyTransitions(go.map(v => ({ key: v.issue.key, transition_id: v.tr!.id, resolution: needRes ? resolution : "" })));
      const ok = new Set(r.results.filter(x => x.ok).map(x => x.key));
      const to = target;
      setMoved(m => ({ ...m, ...Object.fromEntries([...ok].map(k => [k, to])) }));
      if (ok.size) setSteps(s => [...s, { to, n: ok.size }]);
      setFailed(r.results.filter(x => !x.ok));
      onDone(go.map(v => v.issue.key));
      // Остаёмся в окне: из новых статусов будут другие переходы.
      setTarget(""); setResolution(""); setRound(n => n + 1);
    } catch (e) { setFailed([{ key: "—", error: (e as Error).message }]); }
    setBusy(false);
  };
  const close = () => onClose(steps.length > 0);
  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={close} title={`Сменить статус в Jira: задач ${movable.length}`} size="max-w-2xl">
      <div className="space-y-4">
        {epics.length > 0 && (
          <div className="rounded-lg bg-bg-subtle px-3 py-2 text-xs text-text-muted space-y-0.5">
            <p className="font-semibold text-text-main">Эпики меняют статус через свои стори:</p>
            {epics.map(e => (
              <p key={e.key}>
                <span className="font-mono text-primary">{e.key}</span> {String(e.fields.summary ?? "")} —{" "}
                {storiesOf(e.key).length ? `стори: ${storiesOf(e.key).length}` : "сторей нет (Epic Link), менять нечего"}
              </p>
            ))}
          </div>
        )}
        {movable.length === 0 ? (
          <p className="text-sm text-text-muted">
            {emptyEpics.length ? "У выбранных эпиков нет сторей" : "Выбраны только черновики"} — переводить в Jira нечего.
          </p>
        ) : loadErr ? (
          <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">
            Переходы не загрузились: {loadErr}
          </p>
        ) : !avail ? (
          <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Спрашиваю у Jira доступные переходы…</p>
        ) : (
          <>
            <div className="rounded-lg bg-bg-subtle px-3 py-2 text-xs space-y-1">
              <p className="flex flex-wrap items-center gap-1.5">
                <span className="font-semibold text-text-main">Сейчас:</span>
                {nowList.map(([s, n]) => (
                  <span key={s} className="px-2 py-0.5 rounded-md border border-border-main bg-[var(--color-modal-bg)] text-text-main">{s} · {n}</span>
                ))}
                {nowList.length === 1 && <span className="text-emerald-700 dark:text-emerald-300 font-medium">— все в одном статусе</span>}
              </p>
              {steps.length > 0 && (
                <p className="text-text-muted">
                  Сделано: {steps.map((st, i) => <span key={i}>{i > 0 && " → "}«{st.to}» ({st.n})</span>)}
                </p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-text-muted mb-1.5">{steps.length ? "Следующий шаг — перевести в статус" : "Перевести в статус"}</p>
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
                  {resOptions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                {resConflict && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    У выбранных задач переходы разрешают разные решения, общего нет — переведите их по группам.
                  </p>
                )}
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
        {drafts > 0 && (
          <p className="text-xs text-text-muted">Пропущены черновики ({drafts}): в Jira их ещё нет.</p>
        )}
        {failed.length > 0 && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5 space-y-1">
            <p className="font-semibold">Jira не выполнила переход для {failed.length}:</p>
            {failed.map(f => <p key={f.key}>{f.key}: {f.error}</p>)}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={close} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">
              {steps.length ? "Готово" : failed.length ? "Закрыть" : "Отмена"}
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
