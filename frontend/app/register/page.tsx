"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Zap, UserPlus, Eye, EyeOff } from "lucide-react";
import { register } from "@/lib/auth";

const INPUT_CLS = `
  w-full h-9 px-3 text-sm rounded-lg border border-border-main
  bg-white text-text-main placeholder:text-text-muted
  focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary
  disabled:opacity-50 transition-all
`;

export default function RegisterPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (username.trim().length < 3) {
      setError("Логин должен содержать минимум 3 символа");
      return;
    }
    if (password.length < 6) {
      setError("Пароль должен содержать минимум 6 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }

    setLoading(true);
    try {
      await register(username.trim(), password);
      router.push("/generation");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Ошибка регистрации");
    } finally {
      setLoading(false);
    }
  }

  const pwMatch = confirm.length > 0 && password === confirm;
  const pwMismatch = confirm.length > 0 && password !== confirm;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-blue-50 to-purple-50">
      <div className="w-full max-w-sm animate-fade-in">
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

          <h1 className="text-lg font-semibold text-text-main mb-1">Регистрация</h1>
          <p className="text-sm text-text-muted mb-6">Создайте аккаунт для доступа к системе</p>

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
                placeholder="Минимум 3 символа"
                className={INPUT_CLS}
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Пароль</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  disabled={loading}
                  placeholder="Минимум 6 символов"
                  className={INPUT_CLS.replace("px-3", "pl-3 pr-9")}
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

            {/* Confirm password */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">Повторите пароль</label>
              <input
                type={showPw ? "text" : "password"}
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                disabled={loading}
                placeholder="••••••••"
                className={`${INPUT_CLS} ${pwMatch ? "border-green-400 focus:border-green-500 focus:ring-green-200" : ""} ${pwMismatch ? "border-red-300 focus:border-red-400 focus:ring-red-100" : ""}`}
              />
              {pwMatch && (
                <p className="text-xs text-green-600 mt-1">Пароли совпадают</p>
              )}
              {pwMismatch && (
                <p className="text-xs text-red-500 mt-1">Пароли не совпадают</p>
              )}
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
              disabled={loading || !username || !password || !confirm}
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
                <UserPlus className="w-4 h-4" />
              )}
              {loading ? "Регистрация..." : "Зарегистрироваться"}
            </button>
          </form>

          {/* Link to login */}
          <p className="text-center text-xs text-text-muted mt-6">
            Уже есть аккаунт?{" "}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Войти
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
