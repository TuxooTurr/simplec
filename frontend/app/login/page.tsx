"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { SharkSpinner } from "@/components/ui/RefreshButton";
import { BRAND_FONT } from "@/components/BrandWord";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/components/ui/ThemeToggle";
import { loginTokensNote, stashLoginNote } from "@/lib/authApi";

/* Вход — логином и паролем Jira: пароль проверяет Jira, заодно проверяются токены Jira и Confluence
   (свои рабочие остаются, иначе выпускаются новые — об этом скажет сообщение в приложении).
   Без корпоративной сети — универсальная учётная запись. */

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [loginStr, setLoginStr] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginStr.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    try {
      const tokens = await login(loginStr.trim(), password);
      stashLoginNote(loginTokensNote(tokens));
      router.replace("/generation");      // акула остаётся до перехода — форма обратно не мигает
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setLoading(false);
    }
  };
  /* Экран входа — по теме: видео перекрашено в цвета Shark (светлая — символы #4F46E5 на #eef2ff, тёмная — #818cf8 на #0f172a).
     Видео на весь экран (object-cover: лишнее по краям обрезается); фон страницы = фон кадра — виден, пока видео грузится.
     Видео ставится после монтирования: до него тема неизвестна, и грузить не тот файл незачем. Без звука, по кругу;
     при «уменьшить движение» — неподвижный кадр. */
  const [theme, mounted] = useTheme();
  const dark = theme === "dark";
  const media = dark ? { video: "/login/shark-dark.mp4", poster: "/login/shark-poster-dark.jpg", bg: "15,23,42" }
    : { video: "/login/shark.mp4", poster: "/login/shark-poster.jpg", bg: "238,242,255" };
  const FIELD = "w-full rounded-xl border px-4 py-3 text-[15px] shadow-sm backdrop-blur-sm transition focus:outline-none focus:ring-4 " +
    "border-indigo-900/15 bg-white/75 text-slate-900 placeholder:text-slate-500 focus:border-indigo-500/60 focus:bg-white/95 focus:ring-indigo-500/10 " +
    "dark:border-indigo-200/15 dark:bg-slate-900/70 dark:text-slate-100 dark:placeholder:text-slate-400 dark:focus:border-indigo-300/50 dark:focus:bg-slate-900/90";

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#eef2ff] dark:bg-[#0f172a]">
      {mounted && (
        <>
          <video
            key={media.video}
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full object-cover motion-reduce:hidden"
            src={media.video}
            poster={media.poster}
            autoPlay muted loop playsInline preload="auto"
          />
          {/* при «уменьшить движение» — неподвижная картинка вместо видео */}
          <div aria-hidden className="pointer-events-none absolute inset-0 hidden bg-cover bg-center bg-no-repeat motion-reduce:block"
            style={{ backgroundImage: `url(${media.poster})` }} />
        </>
      )}
      {/* мягкое затенение фоном под формой — текст читается поверх символов видео */}
      <div aria-hidden className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse 42% 46% at 50% 50%, rgba(${media.bg},0.94) 0%, rgba(${media.bg},0.75) 55%, rgba(${media.bg},0) 100%)` }} />

      {/* Вход идёт: поля убраны, видео играет дальше, по центру — акула по кругу, как в «Обновить» */}
      {loading && (
        <div role="status" aria-label="Вход…" className="relative z-10 text-indigo-700 dark:text-indigo-200 animate-fade-in">
          <SharkSpinner size={88} />
        </div>
      )}

      <form onSubmit={handleSubmit} className={`relative z-10 w-full max-w-[340px] space-y-3 px-4 ${loading ? "hidden" : ""}`}>
        <h1 className="t-rise select-none pb-4 text-center text-[96px] leading-none tracking-[0.04em] text-indigo-950 dark:text-indigo-100"
          style={{ fontFamily: BRAND_FONT }}>
          SHARK
        </h1>

        <input
          value={loginStr}
          onChange={e => { setLoginStr(e.target.value); setError(""); }}
          placeholder="Логин"
          aria-label="Логин Jira"
          autoComplete="username"
          autoFocus
          className={`t-rise ${FIELD}`}
          style={{ ["--i" as string]: 1 }}
        />
        <div className="t-rise relative" style={{ ["--i" as string]: 2 }}>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setError(""); }}
            placeholder="Пароль"
            aria-label="Пароль Jira"
            autoComplete="current-password"
            className={`${FIELD} pr-12`}
          />
          <button
            type="submit"
            disabled={loading || !loginStr.trim() || !password.trim()}
            aria-label="Войти"
            title="Войти"
            className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg bg-indigo-600 text-white
              transition hover:bg-indigo-700 disabled:bg-indigo-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40
              dark:bg-indigo-400 dark:text-slate-950 dark:hover:bg-indigo-300 dark:disabled:bg-indigo-400/25"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <p role="alert" className="animate-shake rounded-xl border border-red-200 bg-red-50/90 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-950/80 dark:text-red-200">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
