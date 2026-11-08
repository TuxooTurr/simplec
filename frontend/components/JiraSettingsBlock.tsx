"use client";

/**
 * Настройки Jira: адрес, проект Jira tool, тип дефекта, SSL и токен.
 * Токен выпускается сам при входе в Shark логином Jira; иначе — путём к файлу (как сертификаты LLM) или строкой.
 */

import { useEffect, useState } from "react";
import { Select } from "@/components/ui";
import { getProjects } from "@/lib/jiraToolApi";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  getJiraSettings, saveJiraSettings, testJira, type JiraSettings,
} from "@/lib/jiraApi";

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40";

const LBL = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";
const MASK = "●●●●●●●●●●●●";

type AuthMode = "login" | "file" | "token";

export default function JiraSettingsBlock() {
  const [s, setS] = useState<JiraSettings | null>(null);
  const [mode, setMode] = useState<AuthMode>("login");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [projects, setProjects] = useState<{ key: string; name: string }[]>([]);

  // Проекты — из Jira; нет подключения — в списке только текущий проект.
  useEffect(() => { getProjects().then(r => setProjects(r.projects), () => undefined); }, []);

  useEffect(() => {
    getJiraSettings().then(st => {
      setS(st);
      if (st.token_path) setMode("file");
      else if (st.token) setMode("token");
    }).catch(e => setMsg({ ok: false, text: String(e) }));
  }, []);

  if (!s) return <p className="text-sm text-text-muted">Загрузка…</p>;

  const patch = (p: Partial<JiraSettings>) => setS(prev => prev ? { ...prev, ...p } : prev);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const saved = await saveJiraSettings(s);
      setS(saved);
      setMsg({ ok: true, text: "Сохранено" });
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    setBusy(false);
  };

  const doTest = async () => {
    setBusy(true); setMsg(null);
    try {
      await saveJiraSettings(s);
      const r = await testJira();
      setMsg({ ok: true, text: `Подключение работает — вы вошли как ${r.user}` });
    } catch (e) { setMsg({ ok: false, text: String(e) }); }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-x-6 gap-y-3">
        <div>
          <label className={LBL}>Jira URL</label>
          <input value={s.base_url} onChange={e => patch({ base_url: e.target.value })}
            placeholder="https://jira.sberbank.ru" className={`${INPUT_CLS} font-mono`} />
        </div>
        <div>
          <label className={LBL}>Проект Jira tool</label>
          <Select value={s.project ?? "SBER911"} onChange={v => patch({ project: v })} aria-label="Проект Jira tool">
            {(projects.some(p => p.key === (s.project ?? "SBER911")) ? projects : [{ key: s.project ?? "SBER911", name: "" }, ...projects])
              .map(p => <option key={p.key} value={p.key}>{p.name ? `${p.key} — ${p.name}` : p.key}</option>)}
          </Select>
        </div>
        <div>
          <label className={LBL}>Тип задачи для дефектов</label>
          <input value={s.issuetype} onChange={e => patch({ issuetype: e.target.value })}
            placeholder="Дефект" className={INPUT_CLS} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer">
        <input type="checkbox" checked={!s.ssl_verify}
          onChange={e => patch({ ssl_verify: !e.target.checked })}
          className="rounded border-border-main text-primary focus:ring-primary/30" />
        Не проверять SSL-сертификат (корп. BIG IP)
      </label>

      {/* Способ авторизации */}
      <div>
        <label className={LBL}>Авторизация</label>
        <div className="flex gap-1.5 mb-3">
          {([
            { id: "login", label: "При входе в Shark" },
            { id: "file",  label: "Файл с токеном" },
            { id: "token", label: "Токен строкой" },
          ] as { id: AuthMode; label: string }[]).map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                mode === m.id ? "bg-primary text-white" : "bg-bg-subtle text-text-muted hover:bg-bg-muted"
              }`}>
              {m.label}
            </button>
          ))}
        </div>

        {mode === "login" && (
          <p className={`flex items-center gap-1.5 text-xs ${s.token === MASK ? "text-green-600" : "text-text-muted"}`}>
            {s.token === MASK && <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />}
            {s.token === MASK
              ? "Токен есть — выпущен при входе в Shark логином Jira."
              : "Токен выпускается сам, когда входите в Shark логином и паролем Jira. Без корпоративной сети — вставьте его строкой."}
          </p>
        )}

        {mode === "file" && (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              Путь к файлу с токеном на машине, где запущен бэкенд (аналогично сертификатам LLM).
            </p>
            <input value={s.token_path} onChange={e => patch({ token_path: e.target.value })}
              placeholder="/Users/you/.secrets/jira_token.txt" className={`${INPUT_CLS} font-mono`} />
          </div>
        )}

        {mode === "token" && (
          <input value={s.token} onChange={e => patch({ token: e.target.value })}
            onFocus={e => { if (e.target.value === MASK) patch({ token: "" }); }}
            placeholder="Персональный токен Jira (PAT)" type="password" className={`${INPUT_CLS} font-mono`} />
        )}
      </div>

      {msg && (
        <p className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-green-600" : "text-red-500"}`}>
          {msg.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <XCircle className="w-4 h-4 flex-shrink-0" />}
          {msg.text}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={doTest} disabled={busy}
          className="px-3.5 py-2 border border-border-main rounded-lg text-xs font-semibold text-text-muted hover:bg-bg-subtle disabled:opacity-40">
          Проверить подключение
        </button>
        <button onClick={save} disabled={busy}
          className="px-4 py-2 bg-primary text-white rounded-lg text-xs font-semibold hover:bg-primary-dark disabled:opacity-40">
          {busy ? "…" : "Сохранить"}
        </button>
      </div>
    </div>
  );
}
