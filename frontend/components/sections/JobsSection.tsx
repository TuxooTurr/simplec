"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play, Square, Plus, Trash2, Pencil, Loader2, X,
  Timer, Clock, CheckCircle2, XCircle, ChevronRight,
  FolderOpen, FolderClosed, FolderPlus, Database,
  History, Zap, Eraser, CircleCheck,
} from "lucide-react";
import {
  getJobs, saveJob, deleteJob, executeJob, executeJobBatch,
  getJobHistory, getJobFolders, saveJobFolder, deleteJobFolder,
  listTestDataConnections,
  type JobDef, type JobFolder, type JobExecuteResult, type JobHistoryEntry,
  type TestDataConnection,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

// ── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLS =
  "w-full border border-border-main rounded-lg px-3 py-2 text-sm " +
  "bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 " +
  "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 " +
  "transition-shadow duration-150";

const LABEL_CLS = "block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1.5";

const FREQS = [
  { label: "1 мин", secs: 60   },
  { label: "5 мин", secs: 300  },
  { label: "10 мин",secs: 600  },
  { label: "30 мин",secs: 1800 },
  { label: "1 ч",   secs: 3600 },
];

// ── Types ────────────────────────────────────────────────────────────────────

interface JobSession {
  running:    boolean;
  periodic:   boolean;
  freq:       number;
  lastResult: JobExecuteResult | null;
  runCount:   number;
}

interface LogLine {
  ts:    string;
  text:  string;
  kind:  "ok" | "error" | "system";
}

const EMPTY_SESSION: JobSession = {
  running: false, periodic: false, freq: 60, lastResult: null, runCount: 0,
};

function nowTs(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, "0")).join(":");
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function JobsSection() {
  const { isSuperuser } = useAuth();

  // ── Data ──
  const [jobs,        setJobs]        = useState<JobDef[]>([]);
  const [folders,     setFolders]     = useState<JobFolder[]>([]);
  const [connections, setConnections] = useState<TestDataConnection[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [loadErr,     setLoadErr]     = useState("");

  // ── UI state ──
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [showModal,    setShowModal]    = useState(false);
  const [editJob,      setEditJob]      = useState<JobDef | null>(null);
  const [showHistory,  setShowHistory]  = useState(false);
  const [history,      setHistory]      = useState<JobHistoryEntry[]>([]);
  const [openFolders,  setOpenFolders]  = useState<Set<string>>(new Set());

  // ── Folder create ──
  const [showNewFolder,  setShowNewFolder]  = useState(false);
  const [newFolderName,  setNewFolderName]  = useState("");
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [renameValue,    setRenameValue]    = useState("");

  // ── Scheduling state for selected job ──
  const [schedMode, setSchedMode] = useState<"once" | "periodic">("once");
  const [schedFreq, setSchedFreq] = useState(60);
  const [schedFrom, setSchedFrom] = useState("");
  const [schedTo,   setSchedTo]   = useState("");

  // ── Sessions (per-job running state) ──
  const [sessions, setSessions] = useState<Record<string, JobSession>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  // ── Log lines (execution log) ──
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logLines]);

  const addLog = useCallback((text: string, kind: LogLine["kind"]) => {
    setLogLines(prev => [...prev, { ts: nowTs(), text, kind }]);
  }, []);

  // ── Load data ──
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [j, f, c] = await Promise.all([
        getJobs(), getJobFolders(), listTestDataConnections(),
      ]);
      setJobs(j);
      setFolders(f);
      setConnections(c);
      setLoadErr("");
    } catch (e: any) {
      setLoadErr(e.message || "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(clearInterval);
    };
  }, []);

  // ── Helpers ──
  const getSession = (id: string): JobSession => sessions[id] ?? EMPTY_SESSION;

  const connName = (connId: string) =>
    connections.find(c => c.id === connId)?.display_name ?? connId;

  const selectedJob = jobs.find(j => j.id === selectedId) ?? null;

  const toggleFolder = (fid: string) =>
    setOpenFolders(prev => { const n = new Set(prev); n.has(fid) ? n.delete(fid) : n.add(fid); return n; });

  // ── Execute a single job ──
  const doExecute = useCallback(async (jobId: string) => {
    const job = jobs.find(j => j.id === jobId);
    const name = job?.name ?? jobId;
    const sess = sessions[jobId] ?? EMPTY_SESSION;
    const runNum = sess.runCount + 1;

    setSessions(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] ?? EMPTY_SESSION), running: true },
    }));

    addLog(`Запущена job "${name}", запуск #${runNum}...`, "system");

    try {
      const r = await executeJob(jobId);
      setSessions(prev => ({
        ...prev,
        [jobId]: {
          ...(prev[jobId] ?? EMPTY_SESSION),
          running: false,
          lastResult: r,
          runCount: runNum,
        },
      }));
      if (r.ok) {
        addLog(`Job "${name}" #${runNum}: ✓ OK · строк: ${r.rows_affected} · nextfiretime: ${r.nextfiretime}`, "ok");
      } else {
        addLog(`Job "${name}" #${runNum}: ✗ Ошибка: ${r.error}`, "error");
      }
      return r;
    } catch (e: any) {
      const errResult: JobExecuteResult = { ok: false, job_id: jobId, error: e.message };
      setSessions(prev => ({
        ...prev,
        [jobId]: {
          ...(prev[jobId] ?? EMPTY_SESSION),
          running: false,
          lastResult: errResult,
          runCount: runNum,
        },
      }));
      addLog(`Job "${name}" #${runNum}: ✗ Ошибка: ${e.message}`, "error");
      return errResult;
    }
  }, [jobs, sessions, addLog]);

  // ── Periodic execution ──
  const startPeriodic = useCallback((jobId: string, freqSecs: number) => {
    if (timersRef.current[jobId]) clearInterval(timersRef.current[jobId]);

    const job = jobs.find(j => j.id === jobId);
    const freqLabel = FREQS.find(f => f.secs === freqSecs)?.label ?? `${freqSecs}с`;

    setSessions(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] ?? EMPTY_SESSION), periodic: true, freq: freqSecs, runCount: 0 },
    }));

    addLog(`Периодический запуск "${job?.name ?? jobId}" · каждые ${freqLabel}`, "system");

    // Execute immediately
    doExecute(jobId);

    timersRef.current[jobId] = setInterval(() => {
      // Check schedTo time window
      if (schedTo) {
        const now = new Date();
        const end = new Date(schedTo);
        if (now > end) {
          clearInterval(timersRef.current[jobId]);
          delete timersRef.current[jobId];
          setSessions(prev => ({
            ...prev,
            [jobId]: { ...(prev[jobId] ?? EMPTY_SESSION), periodic: false },
          }));
          addLog(`Периодический запуск "${job?.name ?? jobId}" остановлен — время вышло`, "system");
          return;
        }
      }
      doExecute(jobId);
    }, freqSecs * 1000);
  }, [jobs, doExecute, addLog, schedTo]);

  const stopPeriodic = useCallback((jobId: string) => {
    if (timersRef.current[jobId]) {
      clearInterval(timersRef.current[jobId]);
      delete timersRef.current[jobId];
    }
    const job = jobs.find(j => j.id === jobId);
    setSessions(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] ?? EMPTY_SESSION), periodic: false },
    }));
    addLog(`Периодический запуск "${job?.name ?? jobId}" остановлен`, "system");
  }, [jobs, addLog]);

  // ── Execute folder ──
  const executeFolder = useCallback(async (folderId: string) => {
    const folderJobs = jobs.filter(j => j.folder_id === folderId);
    if (!folderJobs.length) return;
    const folder = folders.find(f => f.id === folderId);
    const ids = folderJobs.map(j => j.id);

    setSessions(prev => {
      const next = { ...prev };
      for (const id of ids) {
        next[id] = { ...(next[id] ?? EMPTY_SESSION), running: true };
      }
      return next;
    });

    addLog(`Запуск всех джобов в папке "${folder?.name ?? folderId}" (${ids.length} шт.)`, "system");

    try {
      const r = await executeJobBatch(ids);
      setSessions(prev => {
        const next = { ...prev };
        for (const res of r.results) {
          next[res.job_id] = {
            ...(next[res.job_id] ?? EMPTY_SESSION),
            running: false,
            lastResult: res,
            runCount: (next[res.job_id]?.runCount ?? 0) + 1,
          };
        }
        return next;
      });
      const okCount = r.results.filter(x => x.ok).length;
      const errCount = r.results.length - okCount;
      addLog(`Папка "${folder?.name ?? folderId}": ✓ ${okCount} ок, ✗ ${errCount} ошибок`, okCount === r.results.length ? "ok" : "error");
    } catch (e: any) {
      setSessions(prev => {
        const next = { ...prev };
        for (const id of ids) {
          next[id] = { ...(next[id] ?? EMPTY_SESSION), running: false };
        }
        return next;
      });
      addLog(`Папка "${folder?.name ?? folderId}": ✗ Ошибка: ${e.message}`, "error");
    }
  }, [jobs, folders, addLog]);

  // ── Folder CRUD ──
  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      const saved = await saveJobFolder({ name });
      setFolders(prev => [...prev, saved]);
      setOpenFolders(prev => new Set(prev).add(saved.id));
      setNewFolderName("");
      setShowNewFolder(false);
    } catch (e) { alert(String(e)); }
  };

  const handleRenameFolder = async (fid: string) => {
    const name = renameValue.trim();
    if (!name) return;
    try {
      const saved = await saveJobFolder({ id: fid, name });
      setFolders(prev => prev.map(f => f.id === fid ? saved : f));
      setRenamingFolder(null);
    } catch (e) { alert(String(e)); }
  };

  const handleDeleteFolder = async (fid: string) => {
    if (!confirm("Удалить папку? Джобы переместятся в корень.")) return;
    try {
      await deleteJobFolder(fid);
      setFolders(prev => prev.filter(f => f.id !== fid));
      setJobs(prev => prev.map(j => j.folder_id === fid ? { ...j, folder_id: null } : j));
    } catch (e) { alert(String(e)); }
  };

  const handleDeleteJob = async (job: JobDef) => {
    if (!confirm(`Удалить джоб "${job.name}"?`)) return;
    try {
      stopPeriodic(job.id);
      await deleteJob(job.id);
      const next = jobs.filter(j => j.id !== job.id);
      setJobs(next);
      if (selectedId === job.id) {
        setSelectedId(next.length > 0 ? next[0].id : null);
      }
    } catch (e) { alert(String(e)); }
  };

  // ── Modal save handler ──
  const handleModalSave = async (data: Partial<JobDef>) => {
    const saved = await saveJob(data as any);
    setJobs(prev => {
      const idx = prev.findIndex(j => j.id === saved.id);
      if (idx >= 0) { const n = [...prev]; n[idx] = saved; return n; }
      return [...prev, saved];
    });
    setShowModal(false);
    setEditJob(null);
    setSelectedId(saved.id);
  };

  const handleSelectJob = (j: JobDef) => {
    setSelectedId(j.id);
  };

  // ── Scheduling for selected ──
  const selSess = selectedJob ? getSession(selectedJob.id) : EMPTY_SESSION;
  const freqLabel = FREQS.find(f => f.secs === schedFreq)?.label ?? `${schedFreq}с`;

  const runningJobs = jobs.filter(j => {
    const sess = getSession(j.id);
    return sess.running || sess.periodic;
  });

  // ── Load history on demand ──
  const loadHistory = useCallback(async () => {
    try {
      const h = await getJobHistory();
      setHistory(h);
    } catch {}
  }, []);

  // ── Render ──

  if (loadErr) {
    return <div className="p-6"><p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-4">{loadErr}</p></div>;
  }

  if (loading) {
    return <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  // ── History panel ──
  if (showHistory) {
    return (
      <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up h-full flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setShowHistory(false)} className="text-xs text-primary hover:underline">← Назад</button>
          <h2 className="text-base font-bold text-text-main">История запусков</h2>
        </div>
        <div className="space-y-2">
          {history.length === 0 && <p className="text-sm text-text-muted text-center py-8">Пока нет запусков</p>}
          {history.map((h, i) => (
            <div key={i} className={`rounded-lg border p-3 text-xs ${h.status === "ok" ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}`}>
              <div className="flex items-center gap-2 mb-1">
                {h.status === "ok"
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0" />
                  : <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />}
                <span className="font-semibold text-text-main">{h.job_name}</span>
                <span className="text-text-muted ml-auto">{new Date(h.ts).toLocaleString("ru")}</span>
              </div>
              {h.status === "ok" && (
                <p className="text-text-muted">
                  nextfiretime: <code className="bg-bg-card/80 px-1 rounded">{h.nextfiretime}</code>
                  {" · "}строк: {h.rows_affected}
                </p>
              )}
              {h.error && <p className="text-red-600 mt-1">{h.error}</p>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto scrollbar-thin animate-slide-up h-full flex flex-col gap-4">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-main mb-1">Jobs</h1>
          <p className="text-sm text-text-muted">
            Запуск scheduled-задач через UPDATE nextfiretime
            {runningJobs.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {runningJobs.length} акт.
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { loadHistory(); setShowHistory(true); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border-main text-text-muted hover:bg-bg-subtle transition-all">
            <History className="w-3.5 h-3.5" /> История
          </button>
          {isSuperuser && (
            <button onClick={() => { setEditJob(null); setShowModal(true); }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary-dark transition-all">
              <Plus className="w-4 h-4" /> Новый джоб
            </button>
          )}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-center gap-3 text-text-muted">
          <Database className="w-12 h-12 opacity-20" />
          <p className="text-sm">Нет джобов. {isSuperuser ? "Создайте первый." : ""}</p>
        </div>
      ) : (
        <div className="flex gap-4 flex-1 min-h-0">

          {/* ── Left sidebar: job list ── */}
          <div className="w-56 flex-shrink-0 bg-bg-card border border-border-main rounded-xl p-3 overflow-y-auto scrollbar-thin flex flex-col gap-1">

            {/* New folder button */}
            {isSuperuser && (
              showNewFolder ? (
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    autoFocus
                    value={newFolderName}
                    onChange={e => setNewFolderName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                    placeholder="Имя папки..."
                    className="flex-1 min-w-0 text-xs border border-border-main rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <button onClick={handleCreateFolder} className="p-1 text-green-600 hover:bg-green-50 rounded" title="Создать">
                    <CircleCheck className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setShowNewFolder(false)} className="p-1 text-text-muted hover:bg-bg-subtle rounded" title="Отмена">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowNewFolder(true)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]/50 rounded-lg transition-colors">
                  <FolderPlus className="w-3.5 h-3.5" /> Новая папка
                </button>
              )
            )}

            {/* Root-level jobs (no folder) */}
            {jobs.filter(j => !j.folder_id).map(j => {
              const sess = getSession(j.id);
              const isActive = sess.running || sess.periodic;

              let statusLabel = "";
              let statusColor = "";
              let dotColor    = "bg-bg-muted";

              if (sess.periodic)       { statusLabel = `Запущен · #${sess.runCount}`; statusColor = "text-green-600"; dotColor = "bg-green-500 animate-pulse"; }
              else if (sess.running)   { statusLabel = "Выполняется..."; statusColor = "text-amber-600"; dotColor = "bg-amber-400 animate-pulse"; }
              else if (sess.lastResult?.ok)      { statusLabel = `✓ ОК · #${sess.runCount}`; statusColor = "text-green-600"; dotColor = "bg-green-500"; }
              else if (sess.lastResult && !sess.lastResult.ok) { statusLabel = `✗ Ошибка`; statusColor = "text-red-500"; dotColor = "bg-red-500"; }

              return (
                <div key={j.id} onClick={() => handleSelectJob(j)}
                  className={`group flex items-start gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                    selectedId === j.id ? "bg-[var(--color-active-bg)] border border-primary/30 shadow-sm"
                    : isActive ? "bg-green-50/50 border border-green-200/50 hover:bg-green-50"
                    : "hover:bg-bg-subtle border border-transparent"}`}>
                  <div className="relative flex-shrink-0 mt-0.5">
                    <Database className={`w-4 h-4 ${selectedId === j.id ? "text-primary" : isActive ? "text-green-600" : "text-text-muted"}`} />
                    {(isActive || sess.lastResult) && <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${dotColor}`} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm block truncate leading-5 ${selectedId === j.id ? "font-semibold text-primary" : isActive ? "font-medium text-text-main" : "text-text-main"}`}>{j.name}</span>
                    {statusLabel && <span className={`text-[10px] font-medium block truncate leading-4 ${statusColor}`}>{statusLabel}</span>}
                  </div>
                  {isSuperuser && (
                    <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                      <button onClick={e => { e.stopPropagation(); setEditJob(j); setShowModal(true); }} className="p-1 rounded text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]" title="Редактировать"><Pencil className="w-3 h-3" /></button>
                      <button onClick={e => { e.stopPropagation(); handleDeleteJob(j); }} className="p-1 rounded text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Folders */}
            {folders.map(folder => {
              const isOpen = openFolders.has(folder.id);
              const folderJobs = jobs.filter(j => j.folder_id === folder.id);
              const hasActive = folderJobs.some(j => {
                const sess = getSession(j.id);
                return sess.running || sess.periodic;
              });

              return (
                <div key={folder.id}>
                  {/* Folder header */}
                  <div className="group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-bg-subtle transition-colors"
                    onClick={() => toggleFolder(folder.id)}>
                    <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    {isOpen
                      ? <FolderOpen className={`w-4 h-4 flex-shrink-0 ${hasActive ? "text-green-600" : "text-amber-500"}`} />
                      : <FolderClosed className={`w-4 h-4 flex-shrink-0 ${hasActive ? "text-green-600" : "text-amber-500"}`} />}

                    {renamingFolder === folder.id ? (
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") handleRenameFolder(folder.id); if (e.key === "Escape") setRenamingFolder(null); }}
                        onBlur={() => handleRenameFolder(folder.id)}
                        onClick={e => e.stopPropagation()}
                        className="flex-1 min-w-0 text-xs font-medium border border-primary/30 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/30"
                      />
                    ) : (
                      <span className="flex-1 min-w-0 text-xs font-semibold text-text-main truncate">{folder.name}</span>
                    )}

                    {hasActive && <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
                    <span className="text-[10px] text-text-muted/50">{folderJobs.length}</span>

                    {/* Run all jobs in folder */}
                    {folderJobs.length > 0 && (
                      <button
                        onClick={e => { e.stopPropagation(); executeFolder(folder.id); }}
                        className="p-0.5 rounded text-green-600 hover:bg-green-50 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Запустить все джобы в папке"
                      >
                        <Play className="w-3 h-3" />
                      </button>
                    )}

                    {isSuperuser && renamingFolder !== folder.id && (
                      <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={e => { e.stopPropagation(); setRenamingFolder(folder.id); setRenameValue(folder.name); }}
                          className="p-0.5 rounded text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]" title="Переименовать">
                          <Pencil className="w-2.5 h-2.5" />
                        </button>
                        <button onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.id); }}
                          className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить папку">
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Folder children */}
                  {isOpen && (
                    <div className="ml-3 pl-2 border-l border-border-main/50 flex flex-col gap-0.5 mt-0.5 mb-1">
                      {folderJobs.length === 0 && (
                        <p className="text-[10px] text-text-muted/50 px-2 py-1 italic">Пусто</p>
                      )}
                      {folderJobs.map(j => {
                        const sess = getSession(j.id);
                        const isActive = sess.running || sess.periodic;

                        let statusLabel = "";
                        let statusColor = "";
                        let dotColor    = "bg-bg-muted";

                        if (sess.periodic)       { statusLabel = `Запущен · #${sess.runCount}`; statusColor = "text-green-600"; dotColor = "bg-green-500 animate-pulse"; }
                        else if (sess.running)   { statusLabel = "Выполняется..."; statusColor = "text-amber-600"; dotColor = "bg-amber-400 animate-pulse"; }
                        else if (sess.lastResult?.ok)      { statusLabel = `✓ ОК · #${sess.runCount}`; statusColor = "text-green-600"; dotColor = "bg-green-500"; }
                        else if (sess.lastResult && !sess.lastResult.ok) { statusLabel = `✗ Ошибка`; statusColor = "text-red-500"; dotColor = "bg-red-500"; }

                        return (
                          <div key={j.id} onClick={() => handleSelectJob(j)}
                            className={`group flex items-start gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-all ${
                              selectedId === j.id ? "bg-[var(--color-active-bg)] border border-primary/30 shadow-sm"
                              : isActive ? "bg-green-50/50 border border-green-200/50 hover:bg-green-50"
                              : "hover:bg-bg-subtle border border-transparent"}`}>
                            <div className="relative flex-shrink-0 mt-0.5">
                              <Database className={`w-3.5 h-3.5 ${selectedId === j.id ? "text-primary" : isActive ? "text-green-600" : "text-text-muted"}`} />
                              {(isActive || sess.lastResult) && <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-white ${dotColor}`} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className={`text-xs block truncate leading-4 ${selectedId === j.id ? "font-semibold text-primary" : isActive ? "font-medium text-text-main" : "text-text-main"}`}>{j.name}</span>
                              {statusLabel && <span className={`text-[9px] font-medium block truncate leading-3 ${statusColor}`}>{statusLabel}</span>}
                            </div>
                            {isSuperuser && (
                              <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                                <button onClick={e => { e.stopPropagation(); setEditJob(j); setShowModal(true); }} className="p-0.5 rounded text-text-muted hover:text-primary hover:bg-[var(--color-active-bg)]" title="Редактировать"><Pencil className="w-2.5 h-2.5" /></button>
                                <button onClick={e => { e.stopPropagation(); handleDeleteJob(j); }} className="p-0.5 rounded text-text-muted hover:text-red-500 hover:bg-red-50" title="Удалить"><Trash2 className="w-2.5 h-2.5" /></button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Right panel: execution ── */}
          {selectedJob ? (
            <div className="flex-1 min-w-0 flex flex-col gap-4">

              {/* Execution log (top area) */}
              <div className="bg-bg-card border border-border-main rounded-xl p-4 flex flex-col gap-2 max-h-[280px]">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h3 className="text-sm font-semibold text-text-main flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-text-muted" /> Лог запусков
                    {selSess.running && <Loader2 className="w-3.5 h-3.5 animate-spin text-primary ml-1" />}
                  </h3>
                  <button onClick={() => setLogLines([])} title="Очистить"
                    className="p-1.5 rounded-lg text-text-muted hover:text-text-main hover:bg-bg-subtle transition-colors">
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex-1 min-h-0 border border-border-main rounded-lg bg-gray-950 overflow-y-auto scrollbar-thin">
                  <div className="text-xs font-mono space-y-0 p-2 min-h-[80px]">
                    {logLines.length === 0 ? (
                      <p className="text-text-muted italic p-2">— ожидание запуска —</p>
                    ) : (
                      logLines.map((line, i) => (
                        <div key={i} className={`flex gap-2 leading-5 ${
                          line.kind === "error"  ? "text-red-400" :
                          line.kind === "system" ? "text-blue-400" : "text-green-300"}`}>
                          <span className="text-text-muted flex-shrink-0 select-none">{line.ts}</span>
                          <pre className="whitespace-pre-wrap break-all flex-1">{line.text}</pre>
                        </div>
                      ))
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>

              {/* Execution controls (bottom area) */}
              <div className="bg-bg-card border border-border-main rounded-xl p-5 flex flex-col gap-3">

                {/* Job info */}
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4 text-primary flex-shrink-0" />
                  <span className="text-sm font-semibold text-text-main">{selectedJob.name}</span>
                  <span className="text-xs text-text-muted">· {connName(selectedJob.connection_id)}</span>
                </div>

                {/* SQL preview */}
                <div>
                  <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1">SQL шаблон</p>
                  <pre className="text-[11px] bg-bg-subtle border border-border-main rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap font-mono text-text-main">
                    {selectedJob.update_sql}
                  </pre>
                </div>

                {/* Scheduling */}
                <div className="border-t border-border-main pt-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Timer className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wide">Режим</span>
                    <div className="flex gap-1.5 ml-auto">
                      {(["once", "periodic"] as const).map(m => (
                        <button key={m} onClick={() => { setSchedMode(m); if (m === "once" && selSess.periodic) stopPeriodic(selectedJob.id); }}
                          className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${
                            schedMode === m ? "border-primary bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:border-primary/40"}`}>
                          {m === "once" ? "Разовый" : "Периодический"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {schedMode === "periodic" && (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {FREQS.map(f => (
                          <button key={f.secs} onClick={() => setSchedFreq(f.secs)}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                              schedFreq === f.secs ? "border-primary bg-[var(--color-active-bg)] text-primary" : "border-border-main text-text-muted hover:border-primary/40"}`}>
                            {f.label}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-[10px] text-text-muted mb-1 block font-medium uppercase tracking-wide">С</span>
                          <input type="datetime-local" value={schedFrom} onChange={e => setSchedFrom(e.target.value)} className={`${INPUT_CLS} text-xs py-1.5`} />
                        </div>
                        <div>
                          <span className="text-[10px] text-text-muted mb-1 block font-medium uppercase tracking-wide">По</span>
                          <input type="datetime-local" value={schedTo} onChange={e => setSchedTo(e.target.value)} className={`${INPUT_CLS} text-xs py-1.5`} />
                        </div>
                      </div>
                      {(selSess.periodic || selSess.runCount > 0) && (
                        <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${
                          selSess.periodic ? "bg-green-50 text-green-700 border border-green-200" : "bg-bg-subtle text-text-muted border border-border-main"}`}>
                          {selSess.periodic && <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />}
                          {selSess.periodic
                            ? `Работает · каждые ${freqLabel}${schedTo ? ` · до ${new Date(schedTo).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}` : ""} · выполнено: ${selSess.runCount}`
                            : `Остановлено · выполнено: ${selSess.runCount}`}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2">
                  {selSess.periodic && (
                    <button onClick={() => stopPeriodic(selectedJob.id)}
                      className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-border-main rounded-lg text-text-muted hover:bg-bg-subtle transition-all">
                      <Square className="w-3.5 h-3.5" /> Сброс
                    </button>
                  )}

                  <div className="ml-auto">
                    {schedMode === "once" ? (
                      <button onClick={() => doExecute(selectedJob.id)} disabled={selSess.running}
                        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-semibold hover:bg-primary-dark disabled:opacity-40 shadow-sm">
                        {selSess.running ? <><Loader2 className="w-4 h-4 animate-spin" /> Выполняю...</> : <><Play className="w-4 h-4 fill-current" /> Запустить</>}
                      </button>
                    ) : selSess.periodic ? (
                      <button onClick={() => stopPeriodic(selectedJob.id)}
                        className="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600 shadow-sm">
                        <Square className="w-4 h-4 fill-current" /> Остановить
                      </button>
                    ) : (
                      <button onClick={() => startPeriodic(selectedJob.id, schedFreq)} disabled={selSess.running}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-40 shadow-sm">
                        <Play className="w-4 h-4 fill-current" /> Запустить · {freqLabel}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-text-muted">
              <p className="text-sm">Выберите джоб из списка</p>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit modal */}
      {showModal && (
        <JobModal
          initial={editJob}
          folders={folders}
          connections={connections}
          onSave={handleModalSave}
          onClose={() => { setShowModal(false); setEditJob(null); }}
        />
      )}
    </div>
  );
}

// ── Create / Edit Modal ─────────────────────────────────────────────────────

function JobModal({ initial, folders, connections, onSave, onClose }: {
  initial?:    JobDef | null;
  folders:     JobFolder[];
  connections: TestDataConnection[];
  onSave:      (data: Partial<JobDef>) => Promise<void>;
  onClose:     () => void;
}) {
  const editing = !!initial?.id;
  const [name,     setName]     = useState(initial?.name ?? "");
  const [connId,   setConnId]   = useState(initial?.connection_id ?? (connections[0]?.id ?? ""));
  const [sql,      setSql]      = useState(initial?.update_sql ?? "UPDATE qrtz_triggers SET next_fire_time = {nextfiretime} WHERE trigger_name = ''");
  const [folderId, setFolderId] = useState<string>(initial?.folder_id ?? "");
  const [visible,  setVisible]  = useState(initial?.visible_to_monitoring ?? false);
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState("");

  const handleSave = async () => {
    if (!name.trim()) { setErr("Название обязательно"); return; }
    if (!connId)      { setErr("Выберите подключение"); return; }
    if (!sql.trim())  { setErr("SQL обязателен"); return; }
    setSaving(true); setErr("");
    try {
      await onSave({
        id: initial?.id,
        name: name.trim(),
        connection_id: connId,
        update_sql: sql.trim(),
        folder_id: folderId || null,
        visible_to_monitoring: visible,
      });
    } catch (e) { setErr(String(e)); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      <div className="bg-bg-card rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-main flex-shrink-0">
          <h2 className="text-base font-semibold">{editing ? "Редактировать джоб" : "Новый джоб"}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-main"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto scrollbar-thin p-6 space-y-5 flex-1">
          {/* Name */}
          <div>
            <label className={LABEL_CLS}>Имя джоба *</label>
            <input value={name} onChange={e => setName(e.target.value)} className={INPUT_CLS} placeholder="Например: Запуск отчёта продаж" />
          </div>

          {/* Connection */}
          <div>
            <label className={LABEL_CLS}>База данных *</label>
            <select className={INPUT_CLS} value={connId} onChange={e => setConnId(e.target.value)}>
              <option value="">— Выберите подключение —</option>
              {connections.map(c => (
                <option key={c.id} value={c.id}>
                  {c.display_name} ({c.driver_name} · {c.host}:{c.port}/{c.db_name})
                </option>
              ))}
            </select>
            {connections.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">Нет подключений. Добавьте БД в настройках.</p>
            )}
          </div>

          {/* SQL template */}
          <div>
            <label className={LABEL_CLS}>UPDATE SQL-скрипт *</label>
            <textarea
              className={INPUT_CLS + " font-mono text-xs min-h-[100px]"}
              rows={4}
              value={sql}
              onChange={e => setSql(e.target.value)}
              placeholder="UPDATE qrtz_triggers SET next_fire_time = {nextfiretime} WHERE trigger_name = 'myJob'"
            />
            <p className="text-[11px] text-text-muted mt-1">
              Используйте <code className="bg-bg-muted px-1 rounded">{"{nextfiretime}"}</code> — будет заменён на epoch-мс (время + 30 сек).
            </p>
          </div>

          {/* Folder */}
          {folders.length > 0 && (
            <div>
              <label className={LABEL_CLS}>Папка</label>
              <select value={folderId} onChange={e => setFolderId(e.target.value)} className={INPUT_CLS}>
                <option value="">— без папки —</option>
                {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}

          {/* Visibility */}
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={visible} onChange={e => setVisible(e.target.checked)} className="h-4 w-4 rounded border-border-main accent-primary" />
            <span className="text-sm text-text-main">
              Доступно для <span className="font-semibold text-blue-600">SberMonitoring+</span>
            </span>
          </label>

          {err && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border-main flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-text-muted border border-border-main rounded-lg">Отмена</button>
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-5 py-2 text-sm font-semibold bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}
