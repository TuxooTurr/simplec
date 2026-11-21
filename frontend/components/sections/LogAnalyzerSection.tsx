"use client";
import { refreshLogCatalog } from "@/lib/mcpLogsApi";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Bug, ChevronLeft, ChevronRight, Filter, Loader2, Search, Sparkles } from "lucide-react";
import IssueFormModal from "@/components/jiratool/IssueFormModal";
import PvsSettingsModal from "@/components/settings/PvsSettingsModal";
import { Badge, Button, Card, EmptyState, Input, Label, SectionSettingsButton, Select } from "@/components/ui";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { openForm } from "@/lib/backgroundForms";
import { getJiraSettings } from "@/lib/jiraApi";
import { DEFAULT_PROJECT } from "@/lib/jiraModel";
import { analyzeMcpLogs, getLogCatalog, queryMcpLogs,
  type LogAnalysis, type LogCatalog, type LogGroup, type LogJobOptions, type LogJobProgress,
  type LogPeriod, type LogQuery, type LogRecord, type LogResult } from "@/lib/mcpLogsApi";

const MAX_PICKED = 12;
const PAGE_SIZE = 50;
const CORRELATION = {
  trace: "Совпадает trace ID",
  time: "Логи за близкий период",
  no_data: "Подходящих событий нет",
  unavailable: "Не удалось прочитать логи",
};
const PERIODS = [["15", "15 минут"], ["60", "1 час"], ["360", "6 часов"], ["1440", "24 часа"], ["custom", "Выбрать даты"]] as const;
const PLURAL = new Intl.PluralRules("ru");
const JOB_PHASES = {
  search: "Получаю события из MCP…",
  related: "Проверяю связанные сервисы…",
  model: "Готовлю разбор ИИ…",
};

function countLabel(count: number, one: string, few: string, many: string): string {
  const form = PLURAL.select(count);
  return `${count} ${form === "one" ? one : form === "few" ? few : many}`;
}

function localInput(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function when(value: string): string {
  if (!value) return "Время не указано";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("ru-RU");
}

function defectEvidence(r: LogRecord): string {
  const tags = [r.service, r.namespace, when(r.timestamp), r.level, r.traceId && `trace ID ${r.traceId}`, r.requestId && `request ID ${r.requestId}`];
  return `${tags.filter(Boolean).join(" · ")}\n${r.message.slice(0, 2400)}` +
    (r.stack.length ? `\n${r.stack.slice(0, 5).map(x => x.slice(0, 300)).join("\n")}` : "");
}

function EventCard({ event, number, checked, canSelect, busy, onSelect, onAnalyze, onDefect }: {
  event: LogRecord; number: number; checked: boolean; canSelect: boolean; busy: boolean;
  onSelect: () => void; onAnalyze: () => void; onDefect: () => void;
}) {
  return (
    <article className={`rounded-xl border p-4 ${event.error ? "tone-danger" : "border-border-main bg-bg-card"}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:outline-primary disabled:opacity-50"
          checked={checked} onChange={onSelect}
          disabled={!canSelect || busy} aria-label={`Выбрать запись ${number} · ${event.service}`} />
        <div className="min-w-0 flex-[1_1_12rem]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <Badge variant={event.error ? "danger" : /^(WARN|WARNING)$/.test(event.level) ? "warning" : "default"}>{event.level}</Badge>
            <span className="break-words font-semibold text-text-main">{event.service}</span>
            <time dateTime={event.timestamp || undefined}>{when(event.timestamp)}</time>
            {event.traceId && <span className="font-mono break-all">trace {event.traceId}</span>}
            {event.requestId && <span className="font-mono break-all">request {event.requestId}</span>}
          </div>
          <p className={`mt-1.5 whitespace-pre-wrap break-words font-mono text-xs ${event.error ? "" : "text-text-main"}`}>
            {event.message}
          </p>
          {event.stack.length > 0 && <details className="mt-2 text-xs text-text-muted">
            <summary className="cursor-pointer hover:text-text-main">Стек ({event.stack.length})</summary>
            <pre className="mt-1 max-h-52 overflow-auto rounded-md border border-border-main bg-bg-card p-2 whitespace-pre-wrap break-all">{event.stack.join("\n")}</pre>
          </details>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button type="button" variant="sm" icon={<Sparkles className="h-3.5 w-3.5" aria-hidden />} onClick={onAnalyze} disabled={busy}>
            Разобрать с ИИ
          </Button>
          {event.error && <Button type="button" variant="sm" icon={<Bug className="h-3.5 w-3.5" aria-hidden />} onClick={onDefect}>
            Завести дефект
          </Button>}
        </div>
      </div>
    </article>
  );
}

function GroupResult({ group, onDefect }: { group: LogGroup; onDefect: () => void }) {
  const { result } = group;
  const reference = group.correlation === "trace" ? `trace ID ${group.correlationId}`
    : group.correlation === "request" ? `request ID ${group.correlationId}` : "Отдельное событие";
  return (
    <article aria-label={result.title} className="rounded-xl border border-border-main bg-bg-card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
            <span>{countLabel(group.records.length, "запись", "записи", "записей")}</span>
            <Badge className="max-w-full"><span className="whitespace-normal break-all">{reference}</span></Badge>
          </p>
          <h3 className="mt-0.5 font-semibold text-text-main">{result.title}</h3>
        </div>
        <Button type="button" variant="ghost" icon={<Bug className="h-4 w-4" aria-hidden />} onClick={onDefect}>
          Завести дефект по разбору
        </Button>
      </div>
      <p className="text-sm text-text-main">{result.summary}</p>
      <p className="text-sm text-text-main"><b>Влияние на пользователя.</b> {result.impact}</p>
      <p className="text-sm text-text-main"><b>Что видно в логах.</b> {result.cause}</p>
      {result.nextSteps.length > 0 && <ul className="list-disc pl-5 text-sm text-text-muted">
        {result.nextSteps.map((step, i) => <li key={i}>{step}</li>)}
      </ul>}
      <div className="space-y-2 border-t border-border-main pt-2.5">
        <details className="rounded-lg border border-border-main px-3 py-2 text-xs text-text-muted">
          <summary className="cursor-pointer">
            <b className="text-text-main">Выбранные события</b> · {[...new Set(group.records.map(r => r.service))].join(", ")}
          </summary>
          {group.records.map((r, i) => <p key={i} className="mt-2 font-mono whitespace-pre-wrap break-words">
            {r.service} · {when(r.timestamp)} · {r.level} · {r.message}
          </p>)}
        </details>
        {group.lookups.length > 0 && <div className="space-y-2">
          <h4 className="text-sm font-semibold text-text-main">Проверенные сервисы</h4>
          {group.lookups.map((step, i) => <details key={i} className="rounded-lg border border-border-main px-3 py-2 text-xs text-text-muted">
            <summary className="cursor-pointer"><b className="text-text-main">{step.fromService} → {step.service}</b> · {CORRELATION[step.correlation]}</summary>
            {step.note && <p className="mt-2">{step.note}</p>}
            {step.records.map((r, j) => <p key={j} className="mt-2 font-mono whitespace-pre-wrap break-words">{when(r.timestamp)} · {r.level} · {r.message}</p>)}
          </details>)}
        </div>}
        {group.limited && <p className="text-xs text-text-muted">Достигнут лимит проверок связанных сервисов.</p>}
      </div>
    </article>
  );
}

export default function LogAnalyzerSection() {
  const { provider } = useWorkspace();
  const filtersId = useId();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catalog, setCatalog] = useState<LogCatalog | null>(null);
  const [jiraProject, setJiraProject] = useState(DEFAULT_PROJECT);
  const [service, setService] = useState("");
  const [period, setPeriod] = useState<string>("60");
  const [from, setFrom] = useState(() => localInput(new Date(Date.now() - 3600_000)));
  const [to, setTo] = useState(() => localInput(new Date()));
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState<LogJobProgress | null>(null);
  const activeOperation = useRef<AbortController | null>(null);
  const [problem, setProblem] = useState("");
  const [result, setResult] = useState<{ query: LogQuery; response: LogResult } | null>(null);
  const [analysis, setAnalysis] = useState<LogAnalysis | null>(null);
  const analysisRef = useRef<HTMLElement>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [page, setPage] = useState(0);

  const loadCatalog = () => {
    setLoading(true); setProblem("");
    getLogCatalog().then(async data => { setCatalog(data); if (data.configured && data.canDiscoverServices && !data.catalogFresh) setCatalog(await refreshLogCatalog(false)); }).catch(e => setProblem((e as Error).message)).finally(() => setLoading(false));
  };
  useEffect(() => {
    loadCatalog();
    getJiraSettings().then(s => { if (s.project?.trim()) setJiraProject(s.project.trim()); }, () => {});
    return () => activeOperation.current?.abort();
  }, []);
  useEffect(() => {
    if (analysis) analysisRef.current?.scrollIntoView({ block: "nearest" });
  }, [analysis]);

  const readPeriod = (): LogPeriod | null => {
    const now = new Date();
    const start = period === "custom" ? new Date(from) : new Date(now.getTime() - Number(period) * 60_000);
    const end = period === "custom" ? new Date(to) : now;
    const duration = end.getTime() - start.getTime();
    if (!Number.isFinite(duration) || duration <= 0 || duration > 7 * 86400_000) return null;
    return { start: start.toISOString(), end: end.toISOString() };
  };

  const runOperation = async <T,>(work: (options: LogJobOptions) => Promise<T>): Promise<T | undefined> => {
    const controller = new AbortController();
    activeOperation.current = controller;
    setProgress(null);
    try {
      return await work({ signal: controller.signal, onProgress: setProgress });
    } catch (error) {
      if (!controller.signal.aborted) {
        setProblem(error instanceof DOMException && error.name === "TimeoutError"
          ? "Shark не принял запрос вовремя. Повторите операцию, когда сервер ответит."
          : (error as Error).message);
      }
    } finally {
      activeOperation.current = null;
      setProgress(null);
    }
  };

  const search = async (errorsOnly: boolean) => {
    const range = readPeriod();
    if (!range) { setProblem("Проверьте начало и конец периода. Можно запросить до 7 дней."); return; }
    const query: LogQuery = { ...range, ...(service && { service }), errorsOnly };
    setReading(true); setProblem(""); setAnalysis(null); setPicked(new Set());
    setResult(null); setPage(0);
    const response = await runOperation(options => queryMcpLogs(query, options));
    if (response) setResult({ query, response });
    setReading(false);
  };

  const investigate = async (records: LogRecord[]) => {
    if (!result || !records.length) return;
    setAnalyzing(true); setProblem(""); setAnalysis(null);
    const { start, end } = result.query;
    const response = await runOperation(options => analyzeMcpLogs({ start, end }, records, provider, options));
    if (response) setAnalysis(response);
    setAnalyzing(false);
  };

  const toDefect = (records: LogRecord[], analyzed?: LogGroup) => {
    const event = records[0];
    if (!event || !result) return;
    const title = analyzed?.result.title ?? `${event.service}: ${event.message.split("\n")[0]}`;
    const analysisText = analyzed ? [
      `Что произошло: ${analyzed.result.summary}`,
      `Влияние: ${analyzed.result.impact}`,
      `Наблюдения и возможная причина: ${analyzed.result.cause}`,
      ...analyzed.result.nextSteps.map(step => `• ${step}`), "", "Проверенные сервисы:",
      ...analyzed.lookups.map(s => `${s.fromService} → ${s.service}. ${CORRELATION[s.correlation]}` +
        (s.records.length ? `\n${defectEvidence(s.records[0])}` : "")),
      ...(analyzed.limited ? ["Достигнут лимит переходов по связанным сервисам."] : []), "",
    ] : [];
    const description = [
      `Период: ${when(result.query.start)} — ${when(result.query.end)}`, "", ...analysisText, "Выбранные логи:",
      ...records.slice(0, 6).map(defectEvidence),
      ...(records.length > 6 ? [`В описание включены первые 6 из ${records.length} выбранных событий.`] : []),
    ].join("\n\n").slice(0, 24000);
    openForm(control => <IssueFormModal control={control} project={jiraProject} participants={[]} jiraOnly
      prefill={{ type: "Дефект", summary: title.slice(0, 250), description }} extraFields={<></>} onSave={() => {}} />);
  };

  const discover = async () => { setLoading(true); try { setCatalog(await refreshLogCatalog()); } catch (e) { setProblem((e as Error).message); } finally { setLoading(false); } };
  const disabled = !catalog?.configured || reading || analyzing;
  const records = result?.response.records ?? [];
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const seconds = progress?.seconds ?? 0;
  const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} мин ${seconds % 60} с` : `${seconds} с`;

  return (
    <div className="h-full space-y-6 overflow-y-auto p-4 scrollbar-thin sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold text-text-main">Анализ логов</h1>
          {catalog?.demo && <Badge>Демо-данные</Badge>}
          {catalog?.namespace && <Badge className="max-w-full">
            <span className="whitespace-normal break-words">Namespace {catalog.namespace}</span>
          </Badge>}
        </div>
        <SectionSettingsButton label="Подключения" className="ml-auto" onClick={() => setSettingsOpen(true)} />
      </header>
      <PvsSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {catalog?.configured && catalog.canDiscoverServices && <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" loading={loading} disabled={reading || analyzing} onClick={() => void discover()}>Обновить микросервисы из логов</Button><span className="text-xs text-text-muted">Период сервисов: {catalog.servicesHours ?? 72} ч; кеш на 12 часов.</span></div>}
      {catalog && !catalog.configured && <div className="tone-warning flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
        <p>Источник MCP не подключён. Откройте «Подключения» и проверьте параметры PVS.</p>
        <Button type="button" variant="sm" onClick={loadCatalog} loading={loading}>Обновить</Button>
      </div>}
      {!catalog && !loading && problem && <Button type="button" variant="ghost" onClick={loadCatalog}>Повторить загрузку справочника</Button>}

      <Card padded={false} className="p-4">
        <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!disabled) void search(false); }}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-[1_1_14rem]">
              <Label htmlFor={`${filtersId}-service`}>Микросервис</Label>
              <Select id={`${filtersId}-service`} aria-label="Микросервис" value={service} onChange={setService}
                disabled={loading || reading || !catalog} searchable searchPlaceholder="Найти микросервис…">
                <option value="">Все микросервисы</option>
                {catalog?.services.map(name => <option key={name} value={name}>{name}</option>)}
              </Select>
            </div>
            <div className="min-w-0 flex-[1_1_9rem]">
              <Label htmlFor={`${filtersId}-period`}>Период</Label>
              <Select id={`${filtersId}-period`} aria-label="Период" value={period} onChange={setPeriod} disabled={reading}>
                {PERIODS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" className="min-h-9 whitespace-nowrap" disabled={disabled} loading={reading}
                icon={<Search className="h-4 w-4" aria-hidden />}>Получить логи</Button>
              <Button type="button" variant="ghost" className="min-h-9 whitespace-nowrap" disabled={disabled}
                icon={<Filter className="h-4 w-4" aria-hidden />} onClick={() => void search(true)}>Только ошибки</Button>
            </div>
          </div>
          {period === "custom" && <div className="flex flex-wrap gap-3">
            <div className="min-w-0">
              <Label htmlFor={`${filtersId}-from`}>С</Label>
              <Input id={`${filtersId}-from`} type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div className="min-w-0">
              <Label htmlFor={`${filtersId}-to`}>По</Label>
              <Input id={`${filtersId}-to`} type="datetime-local" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>}
        </form>
      </Card>

      {problem && <p role="alert" className="tone-danger flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden /> {problem}
      </p>}
      {(reading || analyzing) && <Card padded={false} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
        <p role="status" className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
          {progress?.reconnecting ? "Восстанавливаю связь с Shark…" : JOB_PHASES[progress?.phase ?? (reading ? "search" : "related")]}
          {seconds > 0 && <span className="whitespace-nowrap tabular-nums">{duration}</span>}
        </p>
        <Button type="button" variant="ghost" onClick={() => activeOperation.current?.abort()}>Отменить</Button>
      </Card>}

      {analysis && <section ref={analysisRef} aria-label="Разбор ИИ" className="rounded-xl border border-primary/30 bg-bg-subtle/40 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="flex items-center gap-2 text-base font-bold text-text-main"><Sparkles className="w-4 h-4 text-primary" aria-hidden /> Разбор ИИ</h2>
          <p className="text-xs text-text-muted">
            {countLabel(analysis.groups.reduce((sum, group) => sum + group.records.length, 0), "запись", "записи", "записей")}
            {" · "}{countLabel(analysis.groups.length, "группа", "группы", "групп")}
          </p>
        </div>
        {analysis.groups.map((group, i) => <GroupResult key={i} group={group} onDefect={() => toDefect(group.records, group)} />)}
      </section>}

      {result && <section aria-label="Результаты поиска" className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs text-text-muted">
            <p className="text-sm font-semibold text-text-main">{result.query.service ?? "Все микросервисы"} · {result.query.errorsOnly ? "Только ошибки" : "Все события"}</p>
            <p>{when(result.query.start)} — {when(result.query.end)} · записей {records.length} · ошибок {result.response.errorCount}</p>
          </div>
          {records.length > 0 && <Button type="button" variant="ghost" disabled={!picked.size || analyzing}
            icon={<Sparkles className="h-4 w-4" aria-hidden />}
            onClick={() => void investigate(records.filter((_, i) => picked.has(i)))}>
            Разобрать выбранное{picked.size ? ` (${picked.size})` : ""}
          </Button>}
        </div>
        {result.response.truncated && <p className="tone-warning rounded-lg border px-3 py-2 text-xs">
          {result.response.timedOut
            ? "Источник достиг таймаута. Показаны только найденные к этому моменту события. Сузьте период или выберите один микросервис."
            : "MCP вернул ограниченную выборку. Чтобы увидеть больше событий, сузьте период."}
        </p>}
        {!records.length && <Card padded={false}>
          <EmptyState icon={<Search className="h-5 w-5" aria-hidden />}
            title={result.response.timedOut ? "До таймаута записи не получены"
              : result.query.errorsOnly ? "В полученной выборке ошибок нет" : "За этот период MCP не вернул событий"}
            description={catalog?.namespace ? `Проверяется только ${catalog.namespace}.` : undefined} />
        </Card>}
        {records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((event, i) => {
          const index = page * PAGE_SIZE + i;
          return <EventCard key={index} event={event} number={index + 1} checked={picked.has(index)} busy={analyzing}
            canSelect={picked.has(index) || picked.size < MAX_PICKED} onSelect={() => setPicked(prev => {
              const next = new Set(prev); if (next.has(index)) next.delete(index); else if (next.size < MAX_PICKED) next.add(index); return next;
            })} onAnalyze={() => void investigate([event])} onDefect={() => toDefect([event])} />;
        })}
        {pageCount > 1 && <div className="flex justify-end items-center gap-2 text-sm text-text-muted">
          <Button type="button" variant="icon" aria-label="Предыдущая страница" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" aria-hidden /></Button>
          <span>{page + 1} из {pageCount}</span>
          <Button type="button" variant="icon" aria-label="Следующая страница" disabled={page + 1 >= pageCount} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" aria-hidden /></Button>
        </div>}
      </section>}
    </div>
  );
}
