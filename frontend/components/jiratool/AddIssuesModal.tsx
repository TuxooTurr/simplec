"use client";

import { useState } from "react";
import { Hash, Loader2, Search, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { jqlExamples, parseKeys, type Issue } from "@/lib/jiraTool";
import { issuesByKeys, searchIssues } from "@/lib/jiraToolApi";

/**
 * Добавление задач в список. Выбранные задачи копятся в «корзине» между поисками:
 * нашли по номеру — выбрали — ищете следующую, выбранное не теряется, пока не нажмёте «Сохранить».
 * По номеру принимается ключ (SBER911-12345), голый номер (12345) или ссылка на задачу.
 * Поиск идёт в настоящую Jira; найденные задачи уходят в список вместе с их полями.
 */
export default function AddIssuesModal({ open, project, onClose, inList, onAdd }: {
  open: boolean;
  /** Проект списка: голый номер задачи и примеры JQL — из него. */
  project: string;
  onClose: () => void;
  inList: Set<string>;
  onAdd: (issues: Issue[]) => void;
}) {
  const [tab, setTab] = useState<"keys" | "jql">("keys");
  const [jql, setJql] = useState("");
  const [keysText, setKeysText] = useState("");
  const [found, setFound] = useState<Issue[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  /** Корзина: порядок добавления сохраняется — в таком порядке задачи встанут в список. */
  const [basket, setBasket] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [total, setTotal] = useState(0);

  const inBasket = new Set(basket.map(i => i.key));
  const put = (items: Issue[]) => setBasket(b => [...b, ...items.filter(i => !inList.has(i.key) && !b.some(x => x.key === i.key))]);
  const toggle = (i: Issue) => (inBasket.has(i.key) ? setBasket(b => b.filter(x => x.key !== i.key)) : put([i]));

  const runJql = async () => {
    if (!jql.trim() || busy) return;
    setErr(""); setMissing([]); setNote(""); setBusy(true);
    try {
      const r = await searchIssues(jql.trim(), 200);
      setFound(r.issues); setTotal(r.total);
    } catch (e) { setFound(null); setErr((e as Error).message); }
    setBusy(false);
  };

  /** По номеру: найденное сразу кладём в корзину и очищаем поле — можно вводить следующий номер. */
  const runKeys = async () => {
    if (busy) return;
    setErr(""); setNote("");
    const keys = parseKeys(keysText, project);
    if (!keys.length) { setErr(`Введите ключ (${project}-123), номер (123) или ссылку на задачу`); return; }
    setBusy(true);
    try {
      const r = await issuesByKeys(keys);
      const hit = r.issues;
      const already = hit.filter(i => inList.has(i.key)).map(i => i.key);
      setMissing(r.missing);
      put(hit);
      setFound(hit);
      const added = hit.length - already.length;
      setNote([added ? `В корзину: ${added}` : "", already.length ? `уже в списке: ${already.join(", ")}` : ""].filter(Boolean).join(" · "));
      if (hit.length) setKeysText("");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const fresh = found?.filter(i => !inList.has(i.key)) ?? [];
  const allOn = fresh.length > 0 && fresh.every(i => inBasket.has(i.key));

  const tabCls = (on: boolean) => `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors
    ${on ? "bg-primary/10 text-primary font-medium" : "text-text-muted hover:text-text-main"}`;
  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono";

  return (
    <Modal open={open} onClose={onClose} title="Добавить задачи в список" size="max-w-4xl">
      <div className="space-y-3">
        <div className="flex gap-1" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "keys"} onClick={() => { setTab("keys"); setFound(null); setErr(""); setNote(""); }}
            className={tabCls(tab === "keys")}><Hash className="w-4 h-4" /> По номеру или ссылке</button>
          <button type="button" role="tab" aria-selected={tab === "jql"} onClick={() => { setTab("jql"); setFound(null); setErr(""); setNote(""); }}
            className={tabCls(tab === "jql")}><Search className="w-4 h-4" /> JQL-фильтр</button>
        </div>

        {tab === "keys" ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input value={keysText} onChange={e => setKeysText(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); runKeys(); } }}
                placeholder={`${project}-12345, 12346 или https://jira…/browse/${project}-12345`} aria-label="Номер, ключ или ссылка на задачу"
                className={field} />
              <button type="button" onClick={runKeys} disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 whitespace-nowrap disabled:opacity-60">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Найти
              </button>
            </div>
            <p className="text-[11px] text-text-muted">
              Enter — найти в Jira и положить в корзину; поле очистится, вводите следующий. Голый номер — из проекта {project}.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea value={jql} onChange={e => setJql(e.target.value)} rows={3} autoFocus
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) runJql(); }}
              placeholder={`project = ${project} AND issuetype = Дефект AND resolution = Unresolved`} aria-label="JQL-запрос" className={field} />
            <div className="flex flex-wrap gap-1.5">
              {jqlExamples(project).map(x => (
                <button key={x} type="button" onClick={() => setJql(x)}
                  className="text-[11px] px-2 py-1 rounded-md bg-bg-subtle text-text-muted hover:text-primary font-mono truncate max-w-full">
                  {x}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={runJql} disabled={busy || !jql.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60">
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} Найти
              </button>
              <span className="text-xs text-text-muted">⌘/Ctrl + Enter. Запрос уходит в Jira как есть. Отметьте нужные — они попадут в корзину.</span>
            </div>
          </div>
        )}

        {err && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">{err}</p>}
        {(note || missing.length > 0) && (
          <p className="text-xs text-text-muted">
            {note}{note && missing.length > 0 && " · "}
            {missing.length > 0 && <span className="text-amber-700 dark:text-amber-300">не найдены: {missing.join(", ")}</span>}
          </p>
        )}

        {found && tab === "jql" && (
          <div className="border border-border-main rounded-xl overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2 bg-bg-subtle text-xs text-text-muted">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={allOn} disabled={!fresh.length}
                  onChange={() => (allOn ? setBasket(b => b.filter(x => !fresh.some(f => f.key === x.key))) : put(fresh))} />
                Найдено: {total > found.length ? `${total}, показаны первые ${found.length}` : found.length}
                {found.length - fresh.length > 0 && ` · уже в списке: ${found.length - fresh.length}`}
              </label>
            </div>
            <div className="max-h-64 overflow-y-auto scrollbar-thin divide-y divide-border-main">
              {found.length === 0 && <p className="text-sm text-text-muted p-4">Ничего не нашлось.</p>}
              {found.map(i => {
                const already = inList.has(i.key);
                return (
                  <label key={i.key} className={`flex items-center gap-3 px-3 py-2 text-sm ${already ? "opacity-50" : "cursor-pointer hover:bg-bg-subtle"}`}>
                    <input type="checkbox" disabled={already} checked={already || inBasket.has(i.key)} onChange={() => toggle(i)} />
                    <span className="font-mono text-xs text-primary w-28 flex-shrink-0">{i.key}</span>
                    <span className="truncate flex-1 text-text-main">{String(i.fields.summary ?? "")}</span>
                    <span className="text-xs text-text-muted flex-shrink-0">{String(i.fields.issuetype ?? "")}</span>
                    <span className="text-xs text-text-muted w-36 truncate flex-shrink-0">{String(i.fields.status ?? "")}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Корзина: выбранное переживает новые поиски */}
        <div className="border border-dashed border-border-main rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-text-main">Выбрано для добавления: {basket.length}</p>
            {basket.length > 0 && (
              <button type="button" onClick={() => setBasket([])} className="text-xs text-text-muted hover:text-red-500">Очистить</button>
            )}
          </div>
          {basket.length === 0 ? (
            <p className="text-[11px] text-text-muted">Пока пусто. Найдите задачи — выбранные будут копиться здесь между поисками.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto scrollbar-thin">
              {basket.map(i => (
                <span key={i.key} title={String(i.fields.summary ?? "")}
                  className="inline-flex items-center gap-1 pl-2 pr-1 py-1 rounded-md bg-primary/10 text-xs text-text-main max-w-[280px]">
                  <span className="font-mono text-primary flex-shrink-0">{i.key}</span>
                  <span className="truncate text-text-muted">{String(i.fields.summary ?? "")}</span>
                  <button type="button" onClick={() => toggle(i)} aria-label={`Убрать ${i.key} из выбранных`}
                    className="p-0.5 rounded hover:text-red-500 flex-shrink-0"><X className="w-3 h-3" /></button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose}
            className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
          <button type="button" disabled={!basket.length}
            onClick={() => { onAdd(basket); onClose(); }}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
            Сохранить{basket.length ? ` (${basket.length})` : ""}
          </button>
        </div>
      </div>
    </Modal>
  );
}
