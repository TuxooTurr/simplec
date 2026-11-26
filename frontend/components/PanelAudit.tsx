"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { ListChecks } from "lucide-react";

export interface PanelAudit {
  id: string;
  render: (onClose: () => void) => ReactNode;
}

export type SetPanelAudit = Dispatch<SetStateAction<PanelAudit | null>>;
export const PanelAuditContext = createContext<SetPanelAudit | null>(null);

/** Registers the audit of the current section in the workspace pane that contains it. */
export function usePanelAudit(audit: PanelAudit | null) {
  const setAudit = useContext(PanelAuditContext);
  useLayoutEffect(() => {
    if (!setAudit || !audit) return;
    setAudit(audit);
    return () => setAudit(current => current === audit ? null : current);
  }, [audit, setAudit]);
}

export default function AuditAction({ audit, auditContext, sectionTitle }: {
  audit: PanelAudit;
  auditContext: string;
  sectionTitle: string;
}) {
  const context = `${auditContext}:${audit.id}`;
  const [openedContext, setOpenedContext] = useState<string | null>(null);
  const open = openedContext === context;
  useEffect(() => setOpenedContext(null), [context]);
  const close = () => setOpenedContext(null);
  return <>
    <button type="button" onClick={() => setOpenedContext(context)} aria-label="Аудит" title={`Аудит · ${sectionTitle}`}
      aria-expanded={open} aria-haspopup="dialog"
      className="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-bg-subtle hover:text-primary
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
      <ListChecks className="h-4 w-4" aria-hidden />
    </button>
    {open && audit.render(close)}
  </>;
}
