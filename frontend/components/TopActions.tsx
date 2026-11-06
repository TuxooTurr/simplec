"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, Settings, Sparkles, User } from "lucide-react";
import BackupButton from "./BackupButton";
import NotificationBell from "./NotificationBell";
import WhatsNewModal from "./WhatsNewModal";
import { ThemeToggle } from "./ui";
import { useAuth } from "@/contexts/AuthContext";
import { CURRENT_VERSION, LATEST_RELEASE, isReleaseSeen, markReleaseSeen } from "@/lib/releaseNotes";

const ICON_BTN = "relative rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-subtle hover:text-primary";

/**
 * Верхний правый угол всего окна: колокольчик, «Что нового», тема, настройки, резервная копия, ФИО, выход.
 * Стоит в шапке крайней справа панели: отдельная полоса над панелями отняла бы высоту у рабочих зон.
 */
export default function TopActions({ section }: { section: string }) {
  const { user, logout, isSuperuser } = useAuth();
  const router = useRouter();
  const [whatsNew, setWhatsNew] = useState(false);
  const [unseen, setUnseen] = useState(false);

  // Окно релиза открывается само один раз; дальше — кнопка. localStorage читаем здесь: на сервере его нет.
  useEffect(() => {
    if (!isReleaseSeen(LATEST_RELEASE.id)) { setUnseen(true); setWhatsNew(true); }
  }, []);

  const handleLogout = async () => { await logout(); router.replace("/login"); };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <NotificationBell />
      <button type="button" onClick={() => setWhatsNew(true)} title={`Что нового · версия ${CURRENT_VERSION}`}
        aria-label={`Что нового в версии ${CURRENT_VERSION}`} className={ICON_BTN}>
        <Sparkles className="h-4 w-4" />
        {unseen && <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-bg-card" />}
      </button>
      <ThemeToggle className="!h-7 !w-7" />
      {isSuperuser && <Link href="/settings" title="Настройки" aria-label="Настройки" className={ICON_BTN}><Settings className="h-4 w-4" /></Link>}
      <BackupButton section={section} />
      {user && (
        <>
          <span title={user.display_name} className="ml-1 flex min-w-0 items-center gap-1.5 text-xs font-medium text-text-main">
            <User className="h-3.5 w-3.5 flex-shrink-0 text-text-muted" />
            <span className="max-w-[180px] truncate">{user.display_name}</span>
          </span>
          <button type="button" onClick={() => void handleLogout()} title="Выйти" aria-label="Выйти из аккаунта"
            className="flex-shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/30">
            <LogOut className="h-4 w-4" /></button>
        </>
      )}
      <WhatsNewModal open={whatsNew} onClose={() => { setWhatsNew(false); markReleaseSeen(LATEST_RELEASE.id); setUnseen(false); }} />
    </div>
  );
}
