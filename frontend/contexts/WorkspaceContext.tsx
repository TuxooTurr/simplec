"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type SectionId =
  | "generation"
  | "etalons"
  | "bugs"
  | "alerts"
  | "metrics"
  | "revisor";

interface WorkspaceCtx {
  /** Глобально выбранная LLM-модель */
  provider: string;
  setProvider: (id: string) => void;
  /** Что показывается в правой панели */
  rightSection: SectionId | null;
  setRightSection: (id: SectionId | null) => void;
  /** Какая секция сейчас тащится из сайдбара */
  dragging: SectionId | null;
  setDragging: (id: SectionId | null) => void;
}

const WorkspaceContext = createContext<WorkspaceCtx>({
  provider: "gigachat",
  setProvider: () => {},
  rightSection: null,
  setRightSection: () => {},
  dragging: null,
  setDragging: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState("gigachat");
  const [rightSection, setRightSection] = useState<SectionId | null>(null);
  const [dragging, setDragging] = useState<SectionId | null>(null);

  return (
    <WorkspaceContext.Provider
      value={{ provider, setProvider, rightSection, setRightSection, dragging, setDragging }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
