"use client";

import { createContext, useContext, useState, ReactNode } from "react";

export type SectionId =
  | "generation"
  | "auto_model"
  | "test_data"
  | "bugs"
  | "logs"
  | "device_farm"
  | "alerts"
  | "jobs"
  | "metrics"
  | "revisor"
  | "etalons"
  | "settings";

export interface BugPrefill {
  platform: string;
  feature: string;
  description: string;
  source: "log_analyzer" | "manual";
}

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
  /** Видна ли левая панель */
  leftVisible: boolean;
  setLeftVisible: (v: boolean) => void;
  /** Открыта ли правая панель (независимо от rightSection) */
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
  /** Счётчик для принудительного обновления списка провайдеров */
  providersRefreshKey: number;
  bumpProviders: () => void;
  /** Pre-fill данные для BugsSection (от анализатора логов) */
  bugPrefill: BugPrefill | null;
  setBugPrefill: (data: BugPrefill | null) => void;
}

const WorkspaceContext = createContext<WorkspaceCtx>({
  provider: "gigachat",
  setProvider: () => {},
  rightSection: null,
  setRightSection: () => {},
  dragging: null,
  setDragging: () => {},
  leftVisible: true,
  setLeftVisible: () => {},
  rightOpen: false,
  setRightOpen: () => {},
  providersRefreshKey: 0,
  bumpProviders: () => {},
  bugPrefill: null,
  setBugPrefill: () => {},
});

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState("gigachat");
  const [rightSection, setRightSection] = useState<SectionId | null>(null);
  const [dragging, setDragging] = useState<SectionId | null>(null);
  const [leftVisible, setLeftVisible] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [providersRefreshKey, setProvidersRefreshKey] = useState(0);
  const bumpProviders = () => setProvidersRefreshKey((k) => k + 1);
  const [bugPrefill, setBugPrefill] = useState<BugPrefill | null>(null);

  return (
    <WorkspaceContext.Provider
      value={{
        provider, setProvider,
        rightSection, setRightSection,
        dragging, setDragging,
        leftVisible, setLeftVisible,
        rightOpen, setRightOpen,
        providersRefreshKey, bumpProviders,
        bugPrefill, setBugPrefill,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
