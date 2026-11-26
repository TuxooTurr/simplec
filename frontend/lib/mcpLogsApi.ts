import { ApiRequestError, fetchJson } from "./api";

export interface LogPeriod { start: string; end: string }
export interface LogQuery extends LogPeriod { services: string[]; errorsOnly: boolean }
export interface LogRecord {
  service: string; namespace: string; timestamp: string; level: string; message: string; stack: string[]; traceId: string; requestId: string; error: boolean;
}
export interface LogCatalog { services: string[]; configured: boolean; demo: boolean; limit: number; namespace: string; canDiscoverServices?: boolean; servicesHours?: number; catalogFresh?: boolean; catalogUpdatedAt?: number }
export interface LogResult { records: LogRecord[]; truncated: boolean; timedOut: boolean; errorCount: number }
export interface LogDiagnosis { title: string; summary: string; impact: string; cause: string; nextSteps: string[] }
export interface LogLookup {
  fromService: string; service: string; traceId: string; correlation: "trace" | "time" | "no_data" | "unavailable";
  records: LogRecord[]; note: string;
}
export interface LogGroup {
  records: LogRecord[]; result: LogDiagnosis; lookups: LogLookup[]; limited: boolean;
  correlation: "trace" | "request" | "record" | "file"; correlationId: string;
}
export interface LogUpload {
  fileCount: number; sizeBytes: number; lineCount: number; eventCount: number;
  errorCount: number; sampleCount: number; longLines: number; errorsOnly: boolean;
}
export interface LogAnalysis { groups: LogGroup[]; upload?: LogUpload }
export interface LogAuditEntry {
  id: string; actor: string; source: "pvs" | "file"; status: "running" | "done" | "error" | "timeout" | "cancelled";
  started_at: string; finished_at: string | null; provider: string; item_count: number | null; size_bytes: number | null;
  period_start: string | null; period_end: string | null; errors_only: number | null;
}
export interface LogAuditPage { entries: LogAuditEntry[]; hasMore: boolean }

export const MAX_LOG_UPLOAD_BYTES = 500 * 1024 * 1024;
export const MAX_LOG_UPLOAD_FILES = 12;
export const MAX_LOG_SERVICES = 30;

export function formatLogSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} Б` : bytes < 1024 ** 2
    ? `${(bytes / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} КБ`
    : `${(bytes / 1024 ** 2).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МБ`;
}
export interface PvsSettings {
  login: string; credentialSource: "saved" | "environment" | "none" | "unavailable"; demo: boolean;
  launchConfigured: boolean; apiUrl: string; namespace: string; index: string;
}

const post = <T,>(path: string, body: unknown, signal?: AbortSignal) => fetchJson<T>(`/api/mcp-logs/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
});

export interface LogJobProgress { phase: "search" | "related" | "model" | "upload" | "scan"; seconds: number; reconnecting?: boolean }
export interface LogJobOptions { signal: AbortSignal; onProgress: (progress: LogJobProgress) => void }

type LogJob<T> = LogJobProgress & (
  { status: "running" } | { status: "cancelled" } | { status: "done"; result: T } |
  { status: "error" | "timeout"; detail: string }
);

async function runLogJob<T>(kind: "query" | "analyze" | "pvs/test", body: unknown, options: LogJobOptions): Promise<T> {
  // The start request is short. Keep its response so cancellation during startup can still stop the server job.
  const { id } = await post<{ id: string }>(`${kind}/jobs`, body, AbortSignal.timeout(15_000));
  return pollLogJob(id, kind === "analyze" ? "related" : "search", options);
}

async function pollLogJob<T>(id: string, phase: LogJobProgress["phase"], { signal, onProgress }: LogJobOptions): Promise<T> {
  const path = `/api/mcp-logs/jobs/${encodeURIComponent(id)}`;
  let failures = 0;
  let finished = false;
  let progress: LogJobProgress = { phase, seconds: 0 };
  try {
    for (;;) {
      signal.throwIfAborted();
      let job: LogJob<T> | undefined;
      try {
        job = await fetchJson<LogJob<T>>(path, { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
        signal.throwIfAborted();
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ApiRequestError && error.status < 500) throw error;
        if (++failures >= 5) throw new Error("Не удалось восстановить связь с Shark. Повторите операцию, когда соединение восстановится.");
      }
      if (job) {
        failures = 0;
        progress = job;
        if (job.status !== "running") {
          finished = true;
          if (job.status === "done") return job.result;
          if (job.status === "cancelled") throw new Error("Операция отменена.");
          throw new Error(job.detail);
        }
      }
      onProgress({ ...progress, reconnecting: failures > 0 });
      await new Promise<void>(resolve => setTimeout(resolve, failures ? 3_000 : 1_500));
    }
  } finally {
    if (!finished) void fetchJson(path, { method: "DELETE", signal: AbortSignal.timeout(5_000) }).catch(() => {});
  }
}

export async function analyzeLogFiles(files: File[], provider: string, errorsOnly: boolean, options: LogJobOptions) {
  const body = new FormData();
  files.forEach(file => body.append("files", file));
  body.set("provider", provider);
  body.set("errorsOnly", String(errorsOnly));
  options.onProgress({ phase: "upload", seconds: 0 });
  const { id } = await fetchJson<{ id: string }>("/api/mcp-logs/upload/jobs", { method: "POST", body, signal: options.signal });
  return pollLogJob<LogAnalysis>(id, "scan", options);
}

export const getLogAudit = (offset: number, signal: AbortSignal) =>
  fetchJson<LogAuditPage>(`/api/mcp-logs/audit?offset=${offset}`, { cache: "no-store", signal });

export const getLogCatalog = () => fetchJson<LogCatalog>("/api/mcp-logs/catalog");
export const queryMcpLogs = (query: LogQuery, options: LogJobOptions) => runLogJob<LogResult>("query", query, options);
export const analyzeMcpLogs = (period: LogPeriod, records: LogRecord[], provider: string, options: LogJobOptions) =>
  runLogJob<LogAnalysis>("analyze", { ...period, records, provider }, options);
export const getPvsSettings = () => fetchJson<PvsSettings>("/api/mcp-logs/pvs");
export const savePvsCredentials = (login: string, password: string) => fetchJson<PvsSettings>("/api/mcp-logs/pvs", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, password }),
});
export const clearPvsCredentials = () => fetchJson<PvsSettings>("/api/mcp-logs/pvs", { method: "DELETE" });
export const testPvsConnection = (options: LogJobOptions) => runLogJob<{ message: string }>("pvs/test", {}, options);

export const refreshLogCatalog = (force = true) => fetchJson<LogCatalog>(`/api/mcp-logs/catalog/refresh?force=${force}`, { method: "POST" });
