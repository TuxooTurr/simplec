"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, FolderPlus, Loader2, Upload, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { zText } from "@/lib/zephyrApi";
import {
  applyStaging, folderPath, targetPath, usedFolders,
  type ApplyResult, type Staging,
} from "@/lib/zephyrStaging";

/** Карточка нового кейса из черновика: куда ляжет, поля, шаги. */
export function StagedCaseCard({ staging, caseId, onClose }: { staging: Staging; caseId: string; onClose: () => void }) {
  const c = staging.cases.find(x => x.id === caseId);
  if (!c) return null;
  const custom = Object.entries(c.customFields);
  return (
    <aside className="flex flex-col min-h-0 h-full border-l border-border-main bg-bg-card" aria-label={`Новый кейс ${c.name}`}>
      <div className="flex items-start gap-2 px-4 py-3 border-b border-border-main">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold text-violet-600 dark:text-violet-300">Новый кейс · ещё не в Jira</p>
          <p className="text-sm font-semibold text-text-main break-words">{c.name}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть карточку" className="p-1 rounded text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin px-4 py-3 space-y-3 text-sm">
        {c.error && <p className="flex gap-1.5 text-red-600 dark:text-red-400"><AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />Не создался: {c.error}</p>}
        <p className="text-xs text-text-muted">Ляжет в: <b className="text-text-main font-medium">{targetPath(staging, c) || "корень"}</b></p>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {c.status && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main">{c.status}</span>}
          {c.priority && <span className="px-2 py-0.5 rounded-md bg-bg-subtle border border-border-main">Приоритет: {c.priority}</span>}
          {custom.map(([k, v]) => <span key={k} className="px-2 py-0.5 rounded-md bg-violet-500/10 text-violet-700 dark:text-violet-300">{k}: {String(v)}</span>)}
        </div>
        {zText(c.objective) && <p className="whitespace-pre-wrap"><b className="text-text-muted font-medium">Цель:</b> {zText(c.objective)}</p>}
        {zText(c.precondition) && <p className="whitespace-pre-wrap"><b className="text-text-muted font-medium">Предусловие:</b> {zText(c.precondition)}</p>}
        <ol className="space-y-2">
          {c.steps.map((s, i) => (
            <li key={i} className="rounded-lg border border-border-main p-2.5">
              <p className="flex gap-2"><span className="w-5 h-5 flex-shrink-0 rounded bg-bg-subtle text-[11px] font-semibold text-text-muted flex items-center justify-center">{i + 1}</span>
                <span className="whitespace-pre-wrap">{zText(s.description) || "—"}</span></p>
              {zText(s.testData) && <p className="mt-1 ml-7 text-xs text-text-muted whitespace-pre-wrap"><b className="font-medium">Данные:</b> {zText(s.testData)}</p>}
              {zText(s.expectedResult) && <p className="mt-1 ml-7 text-xs text-emerald-700 dark:text-emerald-300 whitespace-pre-wrap"><b className="font-medium">Ожидаемо:</b> {zText(s.expectedResult)}</p>}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

/** Подтверждение «Применить»: какие папки создадутся, сколько кейсов уйдёт; затем итог по каждому кейсу. */
export function ApplyDialog({ project, staging, onDone, onClose }: {
  project: string;
  staging: Staging;
  /** Итог применения — раздел убирает созданное из черновика и перечитывает дерево. */
  onDone: (r: ApplyResult) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [res, setRes] = useState<ApplyResult | null>(null);
  const used = usedFolders(staging);
  const toCreate = staging.folders.filter(f => used.has(f.id)).map(f => folderPath(staging, f.id)).sort();
  const empty = staging.folders.filter(f => !used.has(f.id)).length;

  const go = async () => {
    setBusy(true); setErr("");
    try { const r = await applyStaging(project, staging); setRes(r); onDone(r); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal open onClose={onClose} title={res ? "Применено в Jira" : "Применить новую модель в Jira"} size="max-w-2xl">
      <div className="space-y-3 text-sm">
        {!res ? (
          <>
            <p className="text-text-main">В Zephyr ({project}) будет создано: кейсов — <b>{staging.cases.length}</b>, новых папок — <b>{toCreate.length}</b>.</p>
            {toCreate.length > 0 && (
              <ul className="max-h-48 overflow-y-auto scrollbar-thin rounded-lg bg-bg-subtle p-2 text-xs space-y-0.5">
                {toCreate.map(p => <li key={p} className="flex items-center gap-1.5 text-text-main"><FolderPlus className="w-3.5 h-3.5 text-violet-500" />{p}</li>)}
              </ul>
            )}
            {empty > 0 && <p className="text-xs text-text-muted">Пустых новых папок: {empty} — их не создаём (кейсы из них переложены в другие папки).</p>}
            <p className="text-xs text-text-muted">Если папка с таким путём в Zephyr уже есть, кейсы лягут в неё.</p>
            {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-text-muted hover:text-text-main">Отмена</button>
              <button type="button" onClick={go} disabled={busy || !staging.cases.length}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white font-semibold disabled:opacity-40">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Применить</button>
            </div>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-text-main"><CheckCircle2 className="w-5 h-5 text-emerald-500" />
              Создано кейсов: <b>{res.created}</b>{res.failed ? <>, с ошибкой: <b className="text-red-600 dark:text-red-400">{res.failed}</b> — они остались в черновике</> : ""}.</p>
            {Object.keys(res.folderErrors).length > 0 && (
              <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-2 text-xs text-red-700 dark:text-red-300 space-y-0.5">
                {Object.entries(res.folderErrors).map(([p, e]) => <p key={p}>Папка {p}: {e}</p>)}
              </div>
            )}
            <ul className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-border-main rounded-lg border border-border-main text-xs">
              {res.results.map(r => (
                <li key={r.id} className="px-3 py-1.5">
                  <span className={r.key ? "font-mono text-primary" : "text-red-600 dark:text-red-400"}>{r.key || "ошибка"}</span>
                  <span className="text-text-main"> · {r.name}</span>
                  {r.error && <span className="block text-red-600 dark:text-red-400">{r.error}</span>}
                  {r.warning && <span className="block text-amber-700 dark:text-amber-300">{r.warning}</span>}
                </li>
              ))}
            </ul>
            <div className="flex justify-end"><button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-primary text-white font-semibold">Готово</button></div>
          </>
        )}
      </div>
    </Modal>
  );
}
