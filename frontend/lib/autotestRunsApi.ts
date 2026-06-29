import { authHeaders } from "./authApi";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const ah = authHeaders();
  const headers = new Headers(init?.headers);
  for (const [k, v] of Object.entries(ah)) {
    if (!headers.has(k)) headers.set(k, v);
  }
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      const parsed = JSON.parse(text) as { detail?: string; error?: string; message?: string };
      message = parsed.detail ?? parsed.error ?? parsed.message ?? text;
    } catch {
      message = text;
    }
    throw new Error(`${res.status}: ${message}`);
  }
  return res.json() as Promise<T>;
}

export type AutotestType = "api" | "e2e" | "frontend" | "mobile" | "dt";
export type LayoutSize = "sm" | "md" | "lg" | "wide";

export interface RunScriptConfig {
  id: string;
  name: string;
  script_path: string;
  work_dir: string;
  default_tags: string[];
  test_types: AutotestType[];
  microservices: string[];
  enabled: boolean;
  timeout_sec: number;
  ui_size: LayoutSize;
  ui_order: number;
}

export interface AutorunRuleConfig {
  id: string;
  name: string;
  microservice: string;
  script_ids: string[];
  tags: string[];
  use_microservice_as_tag: boolean;
  test_types: AutotestType[];
  enabled: boolean;
  ui_size: LayoutSize;
  ui_order: number;
}

export interface AutorunConfig {
  enabled: boolean;
  source_type: "url" | "file";
  source_url: string;
  source_file_path: string;
  poll_interval_sec: number;
  version_regex: string;
  run_on_first_seen: boolean;
  rules: AutorunRuleConfig[];
  last_seen: Record<string, string>;
  last_check_at: string;
}

export interface AutotestRunConfig {
  framework_path: string;
  selected_types: AutotestType[];
  selected_tags: string[];
  scripts: RunScriptConfig[];
  autorun: AutorunConfig;
  test_labels?: Record<string, string>;
  analyzed_at?: string;
}

export interface RunResult {
  id: string;
  script_id: string;
  script_name: string;
  button_name?: string;
  rule_id?: string;
  rule_name?: string;
  audit_type?: "button" | "autorun";
  audit_name?: string;
  trigger: "manual" | "autorun";
  status: "ok" | "error";
  exit_code: number | null;
  tags: string[];
  test_types: AutotestType[];
  tests?: string[];
  microservice: string;
  build_version: string;
  started_at: string;
  ts?: string;
  duration_ms: number;
  stdout: string;
  stderr: string;
  command?: string;
  work_dir?: string;
  history_warning?: string;
}

export interface CheckBuildsResult {
  detected: Record<string, string>;
  changes: Array<{
    microservice: string;
    old_version: string;
    new_version: string;
    first_seen: boolean;
  }>;
  runs: RunResult[];
  checked_at: string;
}

export interface ScriptOption {
  name: string;
  path: string;
  relative_path: string;
}

export interface ScriptOptionsResult {
  root: string;
  options: ScriptOption[];
}

export interface TestTreeMethod {
  id: string;       // pkg.Class#method
  name: string;
  display: string;  // @DisplayName or method name
  label?: string;   // LLM-сгенерированное понятное название
  tags: string[];
}

export interface TestTreeClass {
  id: string;       // pkg.Class
  type: "class";
  name: string;
  display: string;
  label?: string;   // LLM-сгенерированное понятное название
  package: string;
  file: string;
  tags: string[];
  methods: TestTreeMethod[];
}

export interface TestTreeResult {
  root: string;
  total: number;        // total test methods
  tags: string[];       // all @Tag values across the framework
  classes: TestTreeClass[];
  parseable: boolean;   // false when no JUnit tests were found
  analyzed?: boolean;   // true when LLM friendly names are available
  analyzed_at?: string;
}

export interface AnalyzeTreeResult {
  labels: Record<string, string>;
  total: number;
  analyzed: boolean;
  analyzed_at?: string;
}

export async function analyzeAutotestTree(provider: string): Promise<AnalyzeTreeResult> {
  return fetchJson("/api/autotest-runs/analyze-tree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider }),
  });
}

export async function getAutotestRunConfig(): Promise<AutotestRunConfig> {
  return fetchJson("/api/autotest-runs/config");
}

export async function saveAutotestRunConfig(config: AutotestRunConfig): Promise<AutotestRunConfig> {
  return fetchJson("/api/autotest-runs/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config }),
  });
}

export async function runAutotestScript(params: {
  script_id: string;
  tags: string[];
  test_types: AutotestType[];
  tests?: string[];
  microservice?: string;
  build_version?: string;
}): Promise<RunResult> {
  return fetchJson("/api/autotest-runs/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      script_id: params.script_id,
      tags: params.tags,
      test_types: params.test_types,
      tests: params.tests ?? [],
      microservice: params.microservice ?? "",
      build_version: params.build_version ?? "",
      trigger: "manual",
    }),
  });
}

export async function checkAutotestBuilds(execute = true): Promise<CheckBuildsResult> {
  return fetchJson("/api/autotest-runs/check-builds", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ execute }),
  });
}

export async function getAutotestScriptOptions(frameworkPath = ""): Promise<ScriptOptionsResult> {
  const qs = frameworkPath ? `?framework_path=${encodeURIComponent(frameworkPath)}` : "";
  return fetchJson(`/api/autotest-runs/script-options${qs}`);
}

export async function getAutotestRunHistory(limit = 20): Promise<RunResult[]> {
  return fetchJson(`/api/autotest-runs/history?limit=${limit}`);
}

export async function getAutotestTestTree(frameworkPath = ""): Promise<TestTreeResult> {
  const qs = frameworkPath ? `?framework_path=${encodeURIComponent(frameworkPath)}` : "";
  return fetchJson(`/api/autotest-runs/test-tree${qs}`);
}

export interface CreateScenarioResult {
  script: RunScriptConfig;
  path: string;
  build_tool: string;
  config: AutotestRunConfig;
}

export async function createAutotestScenario(params: {
  name: string;
  tests: string[];
  test_types?: AutotestType[];
  tags?: string[];
}): Promise<CreateScenarioResult> {
  return fetchJson("/api/autotest-runs/create-scenario", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      tests: params.tests,
      test_types: params.test_types ?? [],
      tags: params.tags ?? [],
    }),
  });
}
