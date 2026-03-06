// All logic and state are now managed in GenerationContext so the state
// persists across page navigation within the app.
//
// We re-export everything from the context so existing import sites
// (`GenerationSection.tsx`, `ExportPanel.tsx`, etc.) require no changes.

export type {
  GenerationState,
  Step,
  Case,
  GenEvent,
  Progress,
  ExportResult,
  ExportParams,
} from "@/contexts/GenerationContext";

export { useGeneration } from "@/contexts/GenerationContext";
