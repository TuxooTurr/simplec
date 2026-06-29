"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Zap, Loader2, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

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
      await login(loginStr.trim(), password);
      router.replace("/generation");
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-bg-main to-primary/10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-lg mb-4">
            <Zap className="w-7 h-7 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-text-main">SimpleTest</h1>
          <p className="text-sm text-text-muted mt-1">AI-платформа для QA-инженеров</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-bg-card rounded-2xl border border-border-main shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
              Логин
            </label>
            <input
              value={loginStr}
              onChange={e => { setLoginStr(e.target.value); setError(""); }}
              placeholder="Sber911"
              autoFocus
              className="w-full border border-border-main rounded-lg px-3 py-2.5 text-sm
                bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5">
              Пароль
            </label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              placeholder="Введите пароль"
              className="w-full border border-border-main rounded-lg px-3 py-2.5 text-sm
                bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60
                focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-shadow"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="animate-shake text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2
                dark:text-red-300 dark:bg-red-900/20 dark:border-red-800/50"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !loginStr.trim() || !password.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg
              text-sm font-semibold hover:bg-primary-dark transition-all disabled:opacity-40 shadow-sm
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-main"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Вхожу...</>
              : <><LogIn className="w-4 h-4" /> Войти</>}
          </button>
        </form>

        <p className="text-center text-xs text-text-muted/60 mt-4">
          Закрытая корпоративная сеть
        </p>
      </div>
    </div>
  );
}
