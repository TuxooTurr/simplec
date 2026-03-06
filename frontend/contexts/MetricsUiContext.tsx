"use client";

/**
 * MetricsUiContext
 *
 * Persists selected service/metric IDs across page navigations so the user
 * returns to the same service+metric view when switching tabs.
 */

import { createContext, useContext, useState, ReactNode, Dispatch, SetStateAction } from "react";

interface MetricsUiCtx {
  selectedServiceId: number | null;
  setSelectedServiceId: Dispatch<SetStateAction<number | null>>;
  selectedMetricId: number | null;
  setSelectedMetricId: Dispatch<SetStateAction<number | null>>;
}

const MetricsUiContext = createContext<MetricsUiCtx>({
  selectedServiceId: null,
  setSelectedServiceId: () => {},
  selectedMetricId: null,
  setSelectedMetricId: () => {},
});

export function MetricsUiProvider({ children }: { children: ReactNode }) {
  const [selectedServiceId, setSelectedServiceId] = useState<number | null>(null);
  const [selectedMetricId, setSelectedMetricId] = useState<number | null>(null);

  return (
    <MetricsUiContext.Provider value={{
      selectedServiceId, setSelectedServiceId,
      selectedMetricId, setSelectedMetricId,
    }}>
      {children}
    </MetricsUiContext.Provider>
  );
}

export function useMetricsUi() {
  return useContext(MetricsUiContext);
}
