"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, XCircle } from "lucide-react";
import { corpLogin, getCorpAuthStatus, type CorpAuthStatus } from "@/lib/api";

const INPUT = "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

const NAMES = { jira: "Jira", confluence: "Confluence" } as const;

/**
 * Единая учётная запись: логин и пароль Сигмы одинаковые для Jira и Confluence — вводятся один раз, маркеры
 * доступа приходят для обеих систем. Пароль не сохраняется. Результат — по каждой системе отдельно.
 */
export default function CorpAccountBlock({ onDone }: { onDone?: () => void }) {
  const [st, setSt] = useState<CorpAuthStatus | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Record<string, { ok: boolean; text: string }> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { getCorpAuthStatus().then(setSt, () => undefined); }, []);

  const submit = async () => {
    setBusy(true); setErr(""); setRes(null);
    try {
      const r = await corpLogin(login.trim(), password);
      setRes(r.results);
      setSt({ jira: r.jira, confluence: r.confluence });
      setPassword("");
      onDone?.();
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary" />
        <h3 className="text-sm font-semibold text-text-main">Единая учётная запись</h3>
        <span className="flex-1" />
        {st && (["jira", "confluence"] as const).map(k => (
          <span key={k} className={`inline-flex items-center gap-1 text-xs ${st[k].hasToken ? "text-green-700 dark:text-green-400" : "text-text-muted"}`}>
            {st[k].hasToken ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {NAMES[k]}
          </span>
        ))}
      </div>
      <p className="text-xs text-text-muted">Логин и пароль Сигмы одни на Jira и Confluence: введите один раз — маркеры доступа придут для обеих систем.
        Пароль не сохраняется.</p>
      <form className="grid grid-cols-[1fr_1fr_auto] gap-2" onSubmit={e => { e.preventDefault(); void submit(); }}>
        <input value={login} onChange={e => setLogin(e.target.value)} placeholder="Логин" aria-label="Логин" autoComplete="username" className={INPUT} />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Пароль" aria-label="Пароль" autoComplete="current-password" className={INPUT} />
        <button type="submit" disabled={busy || !login.trim() || !password}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-white hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} Получить маркеры
        </button>
      </form>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {res && (
        <ul className="space-y-1">
          {Object.entries(res).map(([k, v]) => (
            <li key={k} className={`flex items-start gap-1.5 text-sm ${v.ok ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {v.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 shrink-0" />}
              <span><b>{NAMES[k as keyof typeof NAMES]}:</b> {v.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
