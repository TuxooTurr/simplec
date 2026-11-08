"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";

/** Корень без заставки: вошёл — в «Тестовую модель», нет — сразу на вход. */
export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) router.replace(user ? "/generation" : "/login");
  }, [loading, user, router]);

  // Пока решается, куда вести, — фон экрана входа, без мигания.
  return <div className="min-h-screen bg-[#eef2ff] dark:bg-[#0f172a]" />;
}
