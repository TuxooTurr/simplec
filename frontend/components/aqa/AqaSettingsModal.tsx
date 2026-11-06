"use client";

import { useEffect, useState } from "react";
import { Check, GitCommitHorizontal, KeyRound, ListChecks, Loader2, Lock, Play, Plus, Rocket, RotateCcw, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { bitbucketTokenFromLogin, getAqaSettings, saveAqaSettings, type AqaSettings } from "@/lib/aqaApi";

const MASK = "●●●●●●●●●●●●";
const INPUT = "w-full border border-border-main rounded-lg px-3 py-1.5 text-sm bg-[var(--color-input-bg)] text-text-main " +
  "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";
const LABEL = "mb-1 flex items-center gap-1.5 text-xs font-semibold text-text-muted";

/** «Вернуть по умолчанию» — только когда ссылка отличается от стандартной. */
function ResetLink({ value, def, onReset }: { value: string; def?: string; onReset: () => void }) {
  if (!def || value.trim() === def) return null;
  return (
    <button type="button" onClick={onReset} className="ml-auto inline-flex items-center gap-1 font-normal text-primary hover:underline">
      <RotateCcw className="w-3 h-3" /> По умолчанию</button>
  );
}

/**
 * Настройки «Трекинга AQA»: ссылки на репозиторий Bitbucket, проект Allure TestOps и джоб Jenkins (как в браузере),
 * маркеры и эпики роадмапа. Маркер Bitbucket выпускается сам при входе логином Jira, здесь — получить по логину Сигмы
 * или вставить вручную; API-токен TestOps и Jenkins — из профиля там же. Ссылки стоят по умолчанию (SBER911): стереть поле —
 * отключить источник, «По умолчанию» — вернуть.
 */
export default function AqaSettingsModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<AqaSettings | null>(null);
  const [epics, setEpics] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bbLogin, setBbLogin] = useState<{ login: string; password: string } | null>(null);
  const [bbNote, setBbNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setErr(""); setBbLogin(null); setBbNote("");
    getAqaSettings().then(r => {
      setS(r);
      const own = r.epics.filter(k => !r.pinnedEpics?.includes(k));
      setEpics(own.length ? own : [""]);
    }, e => setErr((e as Error).message));
  }, [open]);

  const save = async (): Promise<boolean> => {
    if (!s) return false;
    setBusy(true); setErr("");
    try {
      const r = await saveAqaSettings({ bitbucketUrl: s.bitbucketUrl, bitbucketToken: s.bitbucketToken, testopsUrl: s.testopsUrl,
        testopsToken: s.testopsToken, jenkinsUrl: s.jenkinsUrl, jenkinsUser: s.jenkinsUser, jenkinsToken: s.jenkinsToken, epics: epics.map(e => e.trim()).filter(Boolean) });
      setS(r); setBusy(false); return true;
    } catch (e) { setErr((e as Error).message); setBusy(false); return false; }
  };

  const getBbToken = async () => {
    if (!bbLogin) return;
    if (!(await save())) return;                    // ссылка на репозиторий нужна, чтобы знать сервер
    setBusy(true); setBbNote("");
    try {
      await bitbucketTokenFromLogin(bbLogin.login.trim(), bbLogin.password);
      setS(p => (p ? { ...p, bitbucketToken: MASK } : p));
      setBbLogin(null); setBbNote("Маркер Bitbucket получен (действует 180 дней)");
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <Modal open={open} onClose={() => !busy && onClose()} title="Трекинг AQA — подключения" size="max-w-2xl">
      {!s ? <p className="flex items-center gap-2 text-sm text-text-muted"><Loader2 className="w-4 h-4 animate-spin" /> Загружаю…</p> : (
        <div className="space-y-5 text-sm">
          <section className="space-y-2">
            <div>
              <div className={LABEL}>
                <label htmlFor="aqa-bb-url" className="inline-flex items-center gap-1.5"><GitCommitHorizontal className="w-3.5 h-3.5" /> Репозиторий автотестов в Bitbucket</label>
                <ResetLink value={s.bitbucketUrl} def={s.defaults?.bitbucketUrl} onReset={() => setS({ ...s, bitbucketUrl: s.defaults?.bitbucketUrl ?? "" })} />
              </div>
              <input id="aqa-bb-url" value={s.bitbucketUrl} onChange={e => setS({ ...s, bitbucketUrl: e.target.value })} className={`${INPUT} font-mono text-xs`}
                placeholder="Пусто — Bitbucket не подключён" />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={s.bitbucketToken ? "text-emerald-700 dark:text-emerald-400" : "text-text-muted"}>
                {s.bitbucketToken ? "Маркер есть" : "Маркера нет — выпустится при входе логином Jira"}</span>
              {!bbLogin && (
                <button type="button" onClick={() => setBbLogin({ login: "", password: "" })} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <KeyRound className="w-3 h-3" /> Получить по логину Сигмы</button>
              )}
              {bbNote && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><Check className="w-3 h-3" />{bbNote}</span>}
            </div>
            {bbLogin && (
              <div className="flex flex-wrap items-center gap-2">
                <input value={bbLogin.login} onChange={e => setBbLogin({ ...bbLogin, login: e.target.value })} placeholder="Логин Сигмы"
                  autoComplete="username" className={`${INPUT} w-44`} />
                <input type="password" value={bbLogin.password} onChange={e => setBbLogin({ ...bbLogin, password: e.target.value })} placeholder="Пароль"
                  autoComplete="current-password" className={`${INPUT} w-44`} onKeyDown={e => e.key === "Enter" && void getBbToken()} />
                <button type="button" onClick={() => void getBbToken()} disabled={busy || !bbLogin.login.trim() || !bbLogin.password}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Получить</button>
                <button type="button" onClick={() => setBbLogin(null)} aria-label="Отмена" className="text-text-muted hover:text-text-main"><X className="w-4 h-4" /></button>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div>
              <div className={LABEL}>
                <label htmlFor="aqa-to-url" className="inline-flex items-center gap-1.5"><Rocket className="w-3.5 h-3.5" /> Проект в Allure TestOps</label>
                <ResetLink value={s.testopsUrl} def={s.defaults?.testopsUrl} onReset={() => setS({ ...s, testopsUrl: s.defaults?.testopsUrl ?? "" })} />
              </div>
              <input id="aqa-to-url" value={s.testopsUrl} onChange={e => setS({ ...s, testopsUrl: e.target.value })} className={`${INPUT} font-mono text-xs`}
                placeholder="Пусто — TestOps не подключён" />
            </div>
            <label className="block">
              <span className={LABEL}><KeyRound className="w-3.5 h-3.5" /> API-токен TestOps</span>
              <input type="password" value={s.testopsToken} onChange={e => setS({ ...s, testopsToken: e.target.value })}
                onFocus={() => s.testopsToken === MASK && setS({ ...s, testopsToken: "" })}
                placeholder="Профиль TestOps → API tokens → Create" autoComplete="off" className={`${INPUT} font-mono text-xs`} />
            </label>
          </section>

          <section className="space-y-2">
            <div>
              <div className={LABEL}>
                <label htmlFor="aqa-jk-url" className="inline-flex items-center gap-1.5"><Play className="w-3.5 h-3.5" /> Джоб автотестов в Jenkins</label>
                <ResetLink value={s.jenkinsUrl} def={s.defaults?.jenkinsUrl} onReset={() => setS({ ...s, jenkinsUrl: s.defaults?.jenkinsUrl ?? "" })} />
              </div>
              <input id="aqa-jk-url" value={s.jenkinsUrl} onChange={e => setS({ ...s, jenkinsUrl: e.target.value })} className={`${INPUT} font-mono text-xs`}
                placeholder="Пусто — Jenkins не подключён" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className={LABEL}><KeyRound className="w-3.5 h-3.5" /> Логин Jenkins</span>
                <input value={s.jenkinsUser} onChange={e => setS({ ...s, jenkinsUser: e.target.value })} autoComplete="off" className={`${INPUT} font-mono text-xs`} />
              </label>
              <label className="block">
                <span className={LABEL}><KeyRound className="w-3.5 h-3.5" /> API-токен Jenkins</span>
                <input type="password" value={s.jenkinsToken} onChange={e => setS({ ...s, jenkinsToken: e.target.value })}
                  onFocus={() => s.jenkinsToken === MASK && setS({ ...s, jenkinsToken: "" })}
                  placeholder="Профиль Jenkins → Security → API Token" autoComplete="off" className={`${INPUT} font-mono text-xs`} />
              </label>
            </div>
            <p className="text-[11px] text-text-muted">Запуски идут от имени этого пользователя. Нужен API-токен, а не пароль.</p>
          </section>

          <section className="space-y-2">
            <span className={LABEL}><ListChecks className="w-3.5 h-3.5" /> Эпики роадмапа — номер или ссылка на эпик в Jira</span>
            {!!s.pinnedEpics?.length && (
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
                <Lock className="w-3 h-3" /> Всегда на роадмапе:
                {s.pinnedEpics.map(k => <span key={k} className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-text-main">{k}</span>)}
              </p>
            )}
            {epics.map((e, n) => (
              <div key={n} className="flex items-center gap-2">
                <input value={e} onChange={ev => setEpics(p => p.map((x, i) => (i === n ? ev.target.value : x)))}
                  placeholder="SBER911-… (свой эпик)" aria-label={`Эпик ${n + 1}`} className={`${INPUT} font-mono text-xs`} />
                <button type="button" onClick={() => setEpics(p => (p.length > 1 ? p.filter((_, i) => i !== n) : [""]))}
                  aria-label={`Убрать эпик ${n + 1}`} className="text-text-muted hover:text-red-500"><X className="w-4 h-4" /></button>
              </div>
            ))}
            {epics.length < 5 && (
              <button type="button" onClick={() => setEpics(p => [...p, ""])} className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus className="w-3 h-3" /> Ещё эпик</button>
            )}
          </section>

          {err && <p className="text-red-600 dark:text-red-400">{err}</p>}
          <div className="flex justify-end gap-2 border-t border-border-main pt-3">
            <button type="button" onClick={onClose} disabled={busy} className="rounded-lg border border-border-main px-3 py-1.5 hover:bg-bg-subtle">Отмена</button>
            <button type="button" disabled={busy} onClick={async () => { if (await save()) { onSaved(); onClose(); } }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 font-semibold text-white hover:bg-primary-dark disabled:opacity-50">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} Сохранить</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
