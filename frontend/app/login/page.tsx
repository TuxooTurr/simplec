"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Zap, LogIn, Eye, EyeOff } from "lucide-react";
import { login } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/generation";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(username, password);
      router.push(from);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50">
      <div className="w-full max-w-sm animate-fade-in">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border border-border-main p-8">
          {/* Logo */}
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-primary-dark flex items-center justify-center shadow-sm">
              <Zap className="w-5 h-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <span className="text-[17px] font-bold text-text-main tracking-tight">SimpleTest</span>
              <p className="text-[11px] text-text-muted leading-none mt-0.5">AI-генератор тест-кейсов</p>
            </div>
          </div>

          <h1 className="text-lg font-semibold text-text-main mb-1">Вход в систему</h1>
          <p className="text-sm text-text-muted mb-6">Введите логин и пароль для продолжения</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Username */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Логин</label>
              <input
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={loading}
                placeholder="admin"
                className="
                  w-full h-9 px-3 text-sm rounded-lg border border-border-main
                  bg-white text-text-main placeholder:text-text-muted
                  focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                  disabled:opacity-50 transition-all
                "
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Пароль</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="••••••••"
                  className="
                    w-full h-9 pl-3 pr-9 text-sm rounded-lg border border-border-main
                    bg-white text-text-main placeholder:text-text-muted
                    focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
                    disabled:opacity-50 transition-all
                  "
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-main transition-colors"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="
                w-full h-9 rounded-lg text-sm font-medium
                bg-primary text-white
                hover:bg-primary-dark active:scale-[0.98]
                disabled:opacity-50 disabled:cursor-not-allowed
                transition-all duration-150 flex items-center justify-center gap-2
              "
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? "Выполняется вход..." : "Войти"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
