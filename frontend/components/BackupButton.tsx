"use client";

import { useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import BackupModal from "./BackupModal";

/** «Резервная копия» в заголовке панели — на любой странице; раздел для «только этот раздел» — раздел панели. */
export default function BackupButton({ section }: { section: string }) {
  const { isSuperuser } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isSuperuser) return null;     // выгрузка и восстановление — только суперюзеру (как на бэкенде)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Выгрузить данные в файл или восстановить из файла"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-text-muted hover:text-primary hover:bg-bg-subtle transition-colors">
        <DatabaseBackup className="w-4 h-4" /> Резервная копия
      </button>
      <BackupModal open={open} onClose={() => setOpen(false)} section={section} />
    </>
  );
}
