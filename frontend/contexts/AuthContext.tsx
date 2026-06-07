"use client";

import {
  createContext, useContext, useState, useEffect, useCallback, ReactNode,
} from "react";
import {
  loginApi, logoutApi, getMeApi,
  setStoredToken, clearStoredToken, getStoredToken,
  type AuthUser,
} from "@/lib/authApi";

interface AuthCtx {
  user: AuthUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isSuperuser: boolean;
  isMonitoring: boolean;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  isSuperuser: false,
  isMonitoring: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setLoading(false);
      return;
    }
    getMeApi()
      .then(setUser)
      .catch(() => {
        clearStoredToken();
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (loginStr: string, password: string) => {
    const res = await loginApi(loginStr, password);
    setStoredToken(res.token);
    setUser({ login: res.login, role: res.role, display_name: res.display_name });
  }, []);

  const logout = useCallback(async () => {
    await logoutApi();
    setUser(null);
  }, []);

  const isSuperuser = user?.role === "superuser";
  const isMonitoring = user?.role === "monitoring";

  return (
    <Ctx.Provider value={{ user, loading, login, logout, isSuperuser, isMonitoring }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
