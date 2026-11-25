import { fetchJson } from "./jiraApi";
import type { EtherPeer } from "./etherApi";
import type { Issue } from "./jiraTool";
export type WidgetKind = "view" | "counter" | "employee";
export type WidgetPresentation = "list" | "donut" | "bar";
export type WidgetSize = "S" | "M" | "L" | "XL" | "XXL";
export type WidgetPalette = "indigo" | "ocean" | "forest" | "warm" | "spectrum";
export type ActivityPeriod = "today" | "week" | "fortnight" | "month" | "custom";
export type ActivityMetric = "jiraCreated" | "jiraUpdated" | "jiraTransitions" | "jiraOpenDefects" |
  "bbCommitCount" | "bbCommitList" | "zephyrRunCount" | "zephyrRunList";
export const ACTIVITY_PERIODS: Record<ActivityPeriod, string> = {
  today: "Сегодня", week: "Последние 7 дней", fortnight: "Последние 14 дней", month: "Последние 30 дней", custom: "Календарь",
};
export const DEFAULT_ACTIVITY_METRICS: ActivityMetric[] = [
  "jiraCreated", "jiraUpdated", "jiraOpenDefects", "bbCommitCount", "zephyrRunCount", "zephyrRunList",
];
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
  /** «Для всех» — видят все, меняет редактор Главной; «Личный» — видит и меняет только владелец. */
  scope?: "shared" | "personal";
  owner?: string;
  boardId?: string;
  employeeName?: string;
  employeeLogin?: string;
  activityProject?: string;
  activityBranch?: string;
  activityPeriod?: ActivityPeriod;
  activityFrom?: string;
  activityTo?: string;
  activityTimezone?: string;
  activityMetrics?: ActivityMetric[];
  defectRoles?: string[];
  /** Счётчик: цвет числа и пороги «от N задач — цвет» (ноль всегда зелёный). */
  counterColor?: string;
  thresholds?: { from: number; color: string }[];
}
export interface Layout {
  version: number;
  widgets: DashboardWidget[];
  boards?: { id: string; name: string }[];
  /** Может менять виджеты «Для всех»; личные может создавать любой пользователь. */
  canEdit: boolean;
  login?: string;
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
  employeeName?: string;
  activity?: Record<string, {
    metrics?: { label: string; value: number | null; url?: string; detail?: string }[];
    runs?: { key: string; name: string; url: string }[];
    commits?: { hash: string; id: string; message: string; url: string; date: string }[];
    listDetail?: string;
    error?: string;
  }>;
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
export const getDashboardEmployee = (login: string) =>
  fetchJson<{ name: string }>(`/api/dashboard/employee?${new URLSearchParams({ login })}`);
export const saveDashboard = (layout: Layout) =>
  send<Layout>(
    "/api/dashboard/layout",
    { version: layout.version, widgets: layout.widgets, boards: layout.boards },
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


export interface WidgetDelivery {
  statusColors?: Record<string, string>;
  enabled: boolean;
  recipients: { name: string; peer: EtherPeer }[];
  weekdays: number[];
  time: string;
  timezone: string;
  columns: string[];
}

export interface WidgetDeliveryState {
  config: WidgetDelivery | null;
  locked: boolean;
  sourceChanged?: boolean;
  nextAt?: string | null;
  last?: { at: string; status: "sending" | "sent" | "partial" | "error" | "skipped" | "unknown"; sent: number; total: number; error: string } | null;
}

const deliveryPath = (id: string) => "/api/dashboard/widgets/" + encodeURIComponent(id) + "/delivery";
export const getWidgetDelivery = (id: string) => fetchJson<WidgetDeliveryState>(deliveryPath(id));
export const saveWidgetDelivery = (id: string, body: WidgetDelivery) => send<WidgetDeliveryState>(deliveryPath(id), body, "PUT");
