import { fetchJson } from "./jiraApi";
import type { Issue } from "./jiraTool";
export type WidgetKind = "view" | "counter";
export type WidgetPresentation = "list" | "donut" | "bar";
export type WidgetSize = "S" | "M" | "L" | "XL" | "XXL";
export type WidgetPalette = "indigo" | "ocean" | "forest" | "warm" | "spectrum";
export interface DashboardWidget {
  id: string;
  title: string;
  jql: string;
  kind: WidgetKind;
  size: WidgetSize;
  presentation: WidgetPresentation;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fullWidth?: boolean;
  gridVersion?: 2;
  palette: WidgetPalette;
  colors: Record<string, string>;
  groupField: string;
  stListId?: string;
  columns?: string[];
  valueField: string;
  period: "all" | "today" | "week" | "custom";
  fromDate: string;
  toDate: string;
}
export interface Layout {
  version: number;
  widgets: DashboardWidget[];
  canEdit: boolean;
  demo?: boolean;
}
export type QueueIssue = Issue & {
  firstSeenAt: string;
  processedAt: string | null;
  processedBy: string | null;
  inFilter: boolean;
  processedReason?: string;
  statusChange?: { from: string; to: string; at: string };
};
export interface WidgetData {
  items: QueueIssue[];
  pending: number;
  running: boolean;
  error?: string;
  lastCheckedAt?: string;
  partial?: boolean;
  filterChangedAt?: string;
}
const send = <T>(path: string, body: unknown, method = "POST") =>
  fetchJson<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
export const getDashboard = () => fetchJson<Layout>("/api/dashboard");
export const saveDashboard = (layout: Layout) =>
  send<Layout>(
    "/api/dashboard/layout",
    { version: layout.version, widgets: layout.widgets },
    "PUT",
  );
export const getWidgetData = (id: string) =>
  fetchJson<WidgetData>(
    `/api/dashboard/widgets/${encodeURIComponent(id)}/data`,
  );
export const refreshWidget = (id: string) =>
  send(`/api/dashboard/widgets/${encodeURIComponent(id)}/refresh`, {});
export const markWidget = (id: string, keys: string[], processed: boolean) =>
  send<WidgetData>(
    `/api/dashboard/widgets/${encodeURIComponent(id)}/processed`,
    { keys, processed },
  );
