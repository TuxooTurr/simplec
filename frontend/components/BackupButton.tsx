"use client";

import { useState } from "react";
import { DatabaseBackup } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import BackupModal from "./BackupModal";

/** «Резервная копия» значком вверху справа — на любой странице; раздел для «только этот раздел» — раздел открытой панели. */
export default function BackupButton({ section }: { section: string }) {
  const { isSuperuser } = useAuth();
  const [open, setOpen] = useState(false);
  if (!isSuperuser) return null;     // выгрузка и восстановление — только суперюзеру (как на бэкенде)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Резервная копия: выгрузить данные в файл или восстановить из файла" aria-label="Резервная копия"
        className="rounded-lg p-1.5 text-text-muted hover:text-primary hover:bg-bg-subtle transition-colors">
        <DatabaseBackup className="w-4 h-4" />
      </button>
      <BackupModal open={open} onClose={() => setOpen(false)} section={section} />
    </>
  );
}
