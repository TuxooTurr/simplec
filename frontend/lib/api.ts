/**
 * HTTP API клиент для REST эндпоинтов.
 */

import { authHeaders } from "./authApi";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const ah = authHeaders();
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(ah)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ─── System ────────────────────────────────────────────────────────────────

export interface ProviderStatus {
  id: string;
  name: string;
  status: "green" | "yellow" | "red";
  message: string;
}

export async function getProviders(): Promise<ProviderStatus[]> {
  return fetchJson("/api/system/providers");
}

export async function getStats(): Promise<Record<string, number>> {
  return fetchJson("/api/system/stats");
}

// ─── Generation ────────────────────────────────────────────────────────────

export async function parseFile(file: File): Promise<{ text: string; filename: string }> {
  const body = new FormData();
  body.append("file", file);
  return fetchJson("/api/generation/parse-file", { method: "POST", body });
}

// ─── Etalons ───────────────────────────────────────────────────────────────

export interface Etalon {
  id: string;
  req_text: string;
  tc_text: string;
  qa_doc?: string;
  platform: string;
  feature: string;
  name: string;
}

export async function listEtalons(params?: {
  platform?: string;
  feature?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Etalon[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.platform) qs.set("platform", params.platform);
  if (params?.feature) qs.set("feature", params.feature);
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  return fetchJson(`/api/etalons?${qs.toString()}`);
}

export async function addEtalon(data: {
  req_text: string;
  tc_text: string;
  qa_doc?: string;
  platform?: string;
  feature?: string;
  name?: string;
}): Promise<{ id: string; status: string }> {
  const body = new FormData();
  body.append("req_text", data.req_text);
  body.append("tc_text", data.tc_text);
  if (data.qa_doc) body.append("qa_doc", data.qa_doc);
  if (data.platform) body.append("platform", data.platform);
  if (data.feature) body.append("feature", data.feature);
  if (data.name) body.append("name", data.name);
  return fetchJson("/api/etalons", { method: "POST", body });
}

export async function deleteEtalon(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/etalons/${id}`, { method: "DELETE" });
}

export async function getEtalonStats(): Promise<Record<string, number>> {
  return fetchJson("/api/etalons/stats");
}

// ─── Autotests ─────────────────────────────────────────────────────────────

export interface Autotest {
  id: string;
  xml_text: string;
  java_text: string;
  feature: string;
  name: string;
}

export async function listAutotests(params?: {
  feature?: string;
  limit?: number;
}): Promise<{ items: Autotest[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.feature) qs.set("feature", params.feature);
  if (params?.limit) qs.set("limit", String(params.limit));
  return fetchJson(`/api/autotests?${qs.toString()}`);
}

export async function addAutotest(data: {
  xml_text: string;
  java_text: string;
  feature?: string;
  name?: string;
}): Promise<{ id: string; status: string }> {
  const body = new FormData();
  body.append("xml_text", data.xml_text);
  body.append("java_text", data.java_text);
  if (data.feature) body.append("feature", data.feature);
  if (data.name) body.append("name", data.name);
  return fetchJson("/api/autotests", { method: "POST", body });
}

export async function deleteAutotest(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/autotests/${id}`, { method: "DELETE" });
}

// ─── Defects ───────────────────────────────────────────────────────────────

export interface Defect {
  id: string;
  description: string;
  defect_body: string;
  feature: string;
  name: string;
}

export async function listDefects(params?: {
  feature?: string;
  limit?: number;
}): Promise<{ items: Defect[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.feature) qs.set("feature", params.feature);
  if (params?.limit) qs.set("limit", String(params.limit));
  return fetchJson(`/api/defects?${qs.toString()}`);
}

export async function addDefect(data: {
  description: string;
  defect_body: string;
  feature?: string;
  name?: string;
}): Promise<{ id: string; status: string }> {
  const body = new FormData();
  body.append("description", data.description);
  body.append("defect_body", data.defect_body);
  if (data.feature) body.append("feature", data.feature);
  if (data.name) body.append("name", data.name);
  return fetchJson("/api/defects", { method: "POST", body });
}

export async function deleteDefect(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/defects/${id}`, { method: "DELETE" });
}

// ─── Context Docs ─────────────────────────────────────────────────────────

export interface ContextDoc {
  id: string;
  content: string;
  name: string;
  doc_type: string;
  feature: string;
  filename: string;
}

export async function listContextDocs(params?: {
  doc_type?: string;
  feature?: string;
  limit?: number;
}): Promise<{ items: ContextDoc[]; total: number }> {
  const qs = new URLSearchParams();
  if (params?.doc_type) qs.set("doc_type", params.doc_type);
  if (params?.feature) qs.set("feature", params.feature);
  if (params?.limit) qs.set("limit", String(params.limit));
  return fetchJson(`/api/context-docs?${qs.toString()}`);
}

export async function addContextDoc(data: {
  content?: string;
  name?: string;
  doc_type?: string;
  feature?: string;
  file?: File;
}): Promise<{ id: string; status: string }> {
  const body = new FormData();
  if (data.content) body.append("content", data.content);
  if (data.name) body.append("name", data.name);
  if (data.doc_type) body.append("doc_type", data.doc_type);
  if (data.feature) body.append("feature", data.feature);
  if (data.file) body.append("file", data.file);
  return fetchJson("/api/context-docs", { method: "POST", body });
}

export async function deleteContextDoc(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/context-docs/${id}`, { method: "DELETE" });
}

// ─── Alerts ────────────────────────────────────────────────────────────────

export interface NotebookCell {
  id:     string;
  /** markdown — текст; init — однократный код; loop — цикличный код; code — legacy alias init */
  type:   "markdown" | "init" | "loop" | "code";
  source: string;
}

export type ParamFieldType = "text" | "select" | "multiselect" | "dropdown" | "dropdown_multi" | "datetime";

export interface DynamicParam {
  id:          string;
  label:       string;
  code_key:    string;
  placeholder: string;
  field_type:  ParamFieldType;
  options:     string[];
}

export interface AlertFolder {
  id:   string;
  name: string;
}

export interface AlertScript {
  id:                    string;
  name:                  string;
  topic:                 string;
  notebook:              NotebookCell[];
  dynamic_params:        DynamicParam[];
  visible_to_monitoring: boolean;
  folder_id?:            string | null;
  created_at?:           string;
}

export async function getAlertFolders(): Promise<AlertFolder[]> {
  return fetchJson("/api/alerts/folders");
}

export async function saveAlertFolder(folder: Partial<AlertFolder>): Promise<AlertFolder> {
  return fetchJson("/api/alerts/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(folder),
  });
}

export async function deleteAlertFolder(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/alerts/folders/${id}`, { method: "DELETE" });
}

export async function getAlertScripts(): Promise<AlertScript[]> {
  return fetchJson("/api/alerts/scripts");
}

export async function saveAlertScript(script: Partial<AlertScript>): Promise<AlertScript> {
  return fetchJson("/api/alerts/scripts", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(script),
  });
}

export async function deleteAlertScript(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/alerts/scripts/${id}`, { method: "DELETE" });
}

export async function parseNotebook(file: File): Promise<{ cells: NotebookCell[] }> {
  const body = new FormData();
  body.append("file", file);
  return fetchJson("/api/alerts/parse-notebook", { method: "POST", body });
}

// ─── Kernel ────────────────────────────────────────────────────────────────

export async function kernelStart(scriptId: string, scriptName?: string): Promise<{ status: string; kernel_id: string }> {
  const qs = scriptName ? `?script_name=${encodeURIComponent(scriptName)}` : "";
  return fetchJson(`/api/kernel/start/${scriptId}${qs}`, { method: "POST" });
}

export async function kernelStop(scriptId: string): Promise<{ status: string }> {
  return fetchJson(`/api/kernel/stop/${scriptId}`, { method: "DELETE" });
}

export async function kernelStatus(scriptId: string): Promise<{ alive: boolean; kernel_id?: string }> {
  return fetchJson(`/api/kernel/status/${scriptId}`);
}

export async function kernelExecute(scriptId: string, code: string, timeout = 60): Promise<{ output: string; error: string | null }> {
  return fetchJson(`/api/kernel/execute/${scriptId}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ code, timeout }),
  });
}

export interface KernelInfo {
  script_id:   string;
  script_name: string;
  alive:       boolean;
  kernel_id:   string;
  started_by:  string;
  started_at:  string;
}

export async function kernelAllStatus(): Promise<KernelInfo[]> {
  return fetchJson("/api/kernel/all-status");
}

export interface KernelAuditEntry {
  action:      string;
  script_id:   string;
  script_name: string;
  user:        string;
  ts:          string;
}

export async function kernelAudit(limit = 30): Promise<KernelAuditEntry[]> {
  return fetchJson(`/api/kernel/audit?limit=${limit}`);
}

// ─── Bugs ──────────────────────────────────────────────────────────────────

export async function formatBug(params: {
  platform: string;
  feature: string;
  description: string;
  provider: string;
  files?: File[];
}): Promise<{ report: string }> {
  const body = new FormData();
  body.append("platform", params.platform);
  body.append("feature", params.feature);
  body.append("description", params.description);
  body.append("provider", params.provider);
  if (params.files) {
    for (const f of params.files) {
      body.append("attachments", f);
    }
  }
  return fetchJson("/api/bugs/format", { method: "POST", body });
}

// ─── Autotest generation ────────────────────────────────────────────────────

export async function generateAutotest(params: {
  cases: string;
  feature?: string;
  provider: string;
  test_type?: string;
  project_context?: string;
}): Promise<{ code: string }> {
  const body = new FormData();
  body.append("cases", params.cases);
  if (params.feature)          body.append("feature",          params.feature);
  body.append("provider", params.provider);
  if (params.test_type)        body.append("test_type",        params.test_type);
  if (params.project_context)  body.append("project_context",  params.project_context);
  return fetchJson("/api/autotests/generate", { method: "POST", body });
}

export interface ProjectAnalysis {
  build_tool:     "maven" | "gradle" | "unknown";
  dependencies:   string[];
  base_packages:  string[];
  test_dirs:      string[];
  sample_imports: string[];
}

export async function analyzeProject(path: string): Promise<ProjectAnalysis> {
  return fetchJson("/api/autotests/analyze-project", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ path }),
  });
}

// ─── Generation Sessions ──────────────────────────────────────────────────

export interface GenSessionSummary {
  id:             string;
  status:         "generating" | "done" | "error" | "cancelled";
  created_at:     string;
  updated_at:     string;
  requirement:    string;
  feature:        string;
  depth:          string;
  provider:       string;
  platform:       string;
  elapsed:        number;
  current_layer:  number;
  layer3_progress: { current: number; total: number; name: string } | null;
  error:          string | null;
  error_is_llm:   boolean;
  case_count:     number;
  has_qa_doc:     boolean;
  has_export:     boolean;
}

export interface GenSession extends GenSessionSummary {
  qa_doc:         string;
  case_list:      Array<{ name: string; priority: string; type: string }>;
  cases:          Array<{ name: string; priority: string; case_type: string; steps: unknown[]; estimated_minutes?: number }>;
  export_result:  { xml: string; csv: string; md: string } | null;
  is_running:     boolean;
}

export async function listGenSessions(params?: {
  limit?: number;
  status?: string;
}): Promise<GenSessionSummary[]> {
  const qs = new URLSearchParams();
  if (params?.limit)  qs.set("limit",  String(params.limit));
  if (params?.status) qs.set("status", params.status);
  return fetchJson(`/api/generation/sessions?${qs.toString()}`);
}

export async function getGenSession(id: string): Promise<GenSession> {
  return fetchJson(`/api/generation/sessions/${id}`);
}

export async function deleteGenSession(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/generation/sessions/${id}`, { method: "DELETE" });
}

export async function resumeGenSession(id: string): Promise<{ status: string; session_id: string }> {
  return fetchJson(`/api/generation/sessions/${id}/resume`, { method: "POST" });
}

export async function exportGenSession(id: string, params: {
  project?: string;
  system?: string;
  team?: string;
  domain?: string;
  folder?: string;
  use_llm?: boolean;
  provider?: string;
  crit_regress?: boolean;
}): Promise<{ xml: string; csv: string; md: string }> {
  return fetchJson(`/api/generation/sessions/${id}/export`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
}

// ─── Test Data ───────────────────────────────────────────────────────────────

export interface TestDataConnection {
  id:                string;
  display_name:      string;
  driver_id:         string;
  driver_name:       string;
  sql_dialect:       "postgresql" | "mysql" | "oracle" | "generic";
  host:              string;
  port:              number;
  db_name:           string;
  login:             string;
  password:          string;
  schema_name:       string;
  created_at:        string;
  updated_at:        string;
  cached_schema:     Record<string, { name: string; type: string; nullable: boolean; default: string | null }[]> | null;
  schema_updated_at: string | null;
}

export interface TestDataConnectionCreate {
  display_name: string;
  driver_id:    string;
  host:         string;
  port:         number;
  db_name:      string;
  login:        string;
  password:     string;
  schema_name?: string;
}

// ─── JDBC-драйверы («Настройка драйверов», как в DBeaver) ────────────────────

export interface JdbcDriver {
  id:                string;
  name:              string;
  driver_class:      string;
  url_template:      string;
  default_port:      number | null;
  default_db_name:   string;
  default_login:     string;
  sql_dialect:       "postgresql" | "mysql" | "oracle" | "generic";
  jar_filename:      string | null;
  jar_path:          string | null;
  original_filename: string | null;
  built_in:          boolean;
  created_at:        string;
}

export interface JdbcDriverSettings {
  name: string;
  driver_class: string;
  url_template: string;
  default_port?: number | null;
  default_db_name?: string;
  default_login?: string;
}

export async function listJdbcDrivers(): Promise<JdbcDriver[]> {
  return fetchJson("/api/testdata/drivers");
}

export async function createJdbcDriver(data: JdbcDriverSettings): Promise<{ driver: JdbcDriver }> {
  return fetchJson("/api/testdata/drivers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function updateJdbcDriver(id: string, data: JdbcDriverSettings): Promise<{ driver: JdbcDriver }> {
  return fetchJson(`/api/testdata/drivers/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteJdbcDriver(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/testdata/drivers/${id}`, { method: "DELETE" });
}

export async function uploadJdbcDriverLibrary(id: string, file: File): Promise<{ driver: JdbcDriver }> {
  const form = new FormData();
  form.append("file", file);
  const ah = authHeaders();
  const headers = new Headers();
  for (const [k, v] of Object.entries(ah)) headers.set(k, v);
  const res = await fetch(`${API_BASE}/api/testdata/drivers/${id}/library`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

export async function setJdbcDriverLibraryPath(id: string, path: string): Promise<{ driver: JdbcDriver }> {
  return fetchJson(`/api/testdata/drivers/${id}/library-path`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
}

export async function removeJdbcDriverLibrary(id: string): Promise<{ driver: JdbcDriver }> {
  return fetchJson(`/api/testdata/drivers/${id}/library`, { method: "DELETE" });
}

// ─── GigaChat — список моделей стенда (GET {base_url}/models) ─────────────────
export async function getGigachatModels(params: {
  base_url?: string;
  auth_type?: string;
  client_cert_path?: string;
  client_key_path?: string;
  ca_cert_path?: string;
  no_verify?: boolean;
}): Promise<{ models: string[] }> {
  return fetchJson("/api/settings/gigachat/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

// ─── GigaChat — пробный чат (POST {base_url}/chat/completions) ────────────────
export async function testGigachatChat(params: {
  model: string;
  base_url?: string;
  auth_type?: string;
  client_cert_path?: string;
  client_key_path?: string;
  ca_cert_path?: string;
  no_verify?: boolean;
}): Promise<{ status: "green" | "yellow" | "red"; message: string }> {
  return fetchJson("/api/settings/gigachat/test-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

// ─── GigaChat — загрузка файла сертификата (cert|key|ca) ─────────────────────
export async function uploadGigachatCert(kind: "cert" | "key" | "ca", file: File): Promise<{ path: string }> {
  const fd = new FormData();
  fd.append("file", file);
  return fetchJson(`/api/settings/gigachat/cert-upload?kind=${kind}`, {
    method: "POST",
    body: fd,
  });
}

export async function testJdbcDriver(id: string): Promise<{ status: string; message: string }> {
  return fetchJson(`/api/testdata/drivers/${id}/test`, { method: "POST" });
}

export interface TestDataQueryResult {
  columns:   string[];
  rows:      (string | number | boolean | null)[][];
  row_count: number;
  db_name?:  string;
  error?:    string;
}

export async function listTestDataConnections(): Promise<TestDataConnection[]> {
  return fetchJson("/api/testdata/connections");
}

export async function createTestDataConnection(
  data: TestDataConnectionCreate,
): Promise<{ connection: TestDataConnection }> {
  return fetchJson("/api/testdata/connections", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
}

export async function updateTestDataConnection(
  id: string,
  data: TestDataConnectionCreate,
): Promise<{ connection: TestDataConnection }> {
  return fetchJson(`/api/testdata/connections/${id}`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(data),
  });
}

export async function deleteTestDataConnection(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/testdata/connections/${id}`, { method: "DELETE" });
}

export async function testTestDataConnection(id: string): Promise<{ status: string; message: string }> {
  return fetchJson(`/api/testdata/connections/${id}/test`, { method: "POST" });
}

export async function introspectTestDataConnection(
  id: string,
): Promise<{ schema: Record<string, unknown[]>; table_count: number; column_count: number }> {
  return fetchJson(`/api/testdata/connections/${id}/introspect`, { method: "POST" });
}

export async function executeTestDataQuery(params: {
  connection_ids: string[];
  sql:            string;
}, signal?: AbortSignal): Promise<{ results: Record<string, TestDataQueryResult> }> {
  return fetchJson("/api/testdata/query", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
    signal,
  });
}

export async function generateTestDataQuery(params: {
  connection_ids: string[];
  requirement:    string;
  provider:       string;
}, signal?: AbortSignal): Promise<{ sql: string; db_type: string }> {
  return fetchJson("/api/testdata/generate-query", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
    signal,
  });
}

export async function suggestTestDataScript(params: {
  connection_ids: string[];
  requirement:    string;
  provider:       string;
}): Promise<{ script: string; db_type: string; warning: string }> {
  return fetchJson("/api/testdata/suggest-script", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
}

export async function getTestDataSchemasText(
  connection_ids: string[],
): Promise<{ text: string; connection_count: number }> {
  return fetchJson("/api/testdata/schemas-text", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(connection_ids),
  });
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

export interface JobDef {
  id:                    string;
  name:                  string;
  connection_id:         string;
  update_sql:            string;
  folder_id:             string | null;
  visible_to_monitoring: boolean;
  created_at:            string;
  updated_at?:           string;
}

export interface JobFolder {
  id:   string;
  name: string;
}

export interface JobExecuteResult {
  ok:            boolean;
  job_id:        string;
  nextfiretime?: number;
  rows_affected?: number;
  sql?:          string;
  error?:        string;
}

export interface JobBatchResult {
  total:   number;
  ok:      number;
  failed:  number;
  results: JobExecuteResult[];
}

export interface JobHistoryEntry {
  job_id:        string;
  job_name:      string;
  connection_id: string;
  sql:           string;
  nextfiretime:  number;
  rows_affected?: number;
  status:        "ok" | "error";
  error?:        string;
  ts:            string;
}

export async function getJobs(): Promise<JobDef[]> {
  return fetchJson("/api/jobs");
}

export async function saveJob(
  job: Partial<JobDef> & { name: string; connection_id: string; update_sql: string },
): Promise<JobDef> {
  return fetchJson("/api/jobs", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(job),
  });
}

export async function deleteJob(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/jobs/${id}`, { method: "DELETE" });
}

export async function executeJob(
  id: string,
  offsetMs: number = 30000,
): Promise<JobExecuteResult> {
  return fetchJson(`/api/jobs/${id}/execute`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ offset_ms: offsetMs }),
  });
}

export async function executeJobBatch(
  jobIds: string[],
  offsetMs: number = 30000,
): Promise<JobBatchResult> {
  return fetchJson("/api/jobs/execute-batch", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ job_ids: jobIds, offset_ms: offsetMs }),
  });
}

export async function getJobHistory(limit: number = 30): Promise<JobHistoryEntry[]> {
  return fetchJson(`/api/jobs/history?limit=${limit}`);
}

export async function getJobFolders(): Promise<JobFolder[]> {
  return fetchJson("/api/jobs/folders");
}

export async function saveJobFolder(
  folder: Partial<JobFolder> & { name: string },
): Promise<JobFolder> {
  return fetchJson("/api/jobs/folders", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(folder),
  });
}

export async function deleteJobFolder(id: string): Promise<{ status: string }> {
  return fetchJson(`/api/jobs/folders/${id}`, { method: "DELETE" });
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  id:          string;
  timestamp:   string;
  service:     string;
  level:       string;
  message:     string;
  stacktrace:  string;
  metadata:    Record<string, string | number>;
  fingerprint: string;
}

export interface LogGroup extends LogEntry {
  count:         number;
  group_entries: LogEntry[];
}

export interface LogAnalysis {
  error_index:  number;
  log_id:       string;
  service:      string;
  summary:      string;
  root_cause:   string;
  impact:       string;
  category:     string;
  severity:     string;
  suggestion:   string;
  defect_draft: string;
}

export interface LogSearchResult {
  entries:        LogEntry[];
  grouped:        LogGroup[];
  total:          number;
  unique_count:   number;
  services_found: string[];
}

export interface LogAnalyzeResult {
  analyses: LogAnalysis[];
}

export async function searchLogs(params: {
  vps_id:    string;
  services:  string[];
  level:     string;
  time_from: string;
  time_to:   string;
  query?:    string;
  limit?:    number;
}): Promise<LogSearchResult> {
  return fetchJson("/api/logs/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
}

export async function analyzeLogs(params: {
  vps_id:   string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entries:  any[];
  provider: string;
}): Promise<LogAnalyzeResult> {
  return fetchJson("/api/logs/analyze", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
  });
}

export async function getLogServices(vpsId: string): Promise<{ services: string[] }> {
  return fetchJson(`/api/logs/services?vps_id=${encodeURIComponent(vpsId)}`);
}
