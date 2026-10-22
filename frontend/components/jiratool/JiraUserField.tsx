"use client";

import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { findJiraUsers, type JiraUser } from "@/lib/jiraToolApi";

/**
 * «Имя в Jira» у человека справочника: поиск пользователя Jira по имени или логину, выбор — логин и имя из Jira.
 * Jira не подключена или поиск не нашёл — логин можно вписать руками (Enter или уход с поля).
 */
export default function JiraUserField({ name, display, jiraOk, onChange }: {
  name: string;
  display: string;
  jiraOk: boolean;
  onChange: (v: { jiraName: string; jiraDisplay: string }) => void;
}) {
  const shown = name ? (display ? `${display} · ${name}` : name) : "";
  const [text, setText] = useState(shown);
  const [found, setFound] = useState<JiraUser[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { setText(shown); }, [shown]);

  const q = text.trim();
  const searching = jiraOk && q.length >= 2 && q !== shown;
  useEffect(() => {
    if (!searching) { setFound(null); setBusy(false); return; }
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      findJiraUsers(q)
        .then(r => { if (alive) { setFound(r.users); setErr(""); } })
        .catch(e => { if (alive) { setFound(null); setErr((e as Error).message); } })
        .finally(() => { if (alive) setBusy(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q, searching]);

  const pick = (u: JiraUser) => { onChange({ jiraName: u.name, jiraDisplay: u.display }); setFound(null); };
  /** Вписали руками и ушли с поля — это логин. */
  const commit = () => {
    if (q === shown) return;
    if (!q) { onChange({ jiraName: "", jiraDisplay: "" }); return; }
    if (found?.length === 1) { pick(found[0]); return; }
    onChange({ jiraName: q, jiraDisplay: "" });
  };

  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] text-text-muted whitespace-nowrap">Имя в Jira</span>
        <input value={text} onChange={e => setText(e.target.value)} onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(); } if (e.key === "Escape") setText(shown); }}
          placeholder={jiraOk ? "поиск по имени или логину" : "логин в Jira"} aria-label="Имя в Jira"
          className="min-w-0 flex-1 text-xs border border-border-main rounded-md px-2 py-1 bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30" />
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-text-muted" />}
        {name && (
          <button type="button" onClick={() => onChange({ jiraName: "", jiraDisplay: "" })} aria-label="Убрать имя в Jira"
            className="p-0.5 text-text-muted hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
        )}
      </div>
      {err && searching && <p className="mt-1 text-[10px] text-red-600 dark:text-red-400">Поиск в Jira: {err}. Логин можно вписать руками.</p>}
      {found && searching && (
        <ul className="mt-1 max-h-40 overflow-y-auto scrollbar-thin border border-border-main rounded-md divide-y divide-border-main" role="listbox" aria-label="Пользователи Jira">
          {found.length === 0 && <li className="px-2 py-1.5 text-[11px] text-text-muted">В Jira никого не нашлось — Enter сохранит как логин</li>}
          {found.map(u => (
            <li key={u.name}>
              {/* onMouseDown: выбрать раньше, чем blur поля сохранит набранный текст как логин */}
              <button type="button" role="option" aria-selected={u.name === name} onMouseDown={e => { e.preventDefault(); pick(u); }}
                className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-bg-subtle flex items-baseline gap-2">
                <span className="text-text-main">{u.display || u.name}</span>
                <span className="font-mono text-text-muted">{u.name}</span>
                {!u.active && <span className="text-text-muted">· неактивен</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
