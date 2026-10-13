"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Rocket, Search } from "lucide-react";
import { categoryOf, composeRelease, fmtJiraDate, releaseKeys, type Issue, type ReleaseGroup } from "@/lib/jiraTool";
import { getRelease, type ReleaseData } from "@/lib/jiraToolApi";
import { IssueTypeBadge } from "./ListCells";

/** Что вкладка отдаёт в корзину: выбранные строки, источник для сверки состава и все задачи релиза для кэша. */
export interface ReleasePick {
  picked: Issue[];
  source: { key: string; name: string; keys: string[] };
  all: Issue[];
}

/** Сводка задач эпика по группам типов: «стори 2 · дефекты 1». */
function membersNote(members: Issue[]): string {
  const n = { story: 0, defect: 0, other: 0, epic: 0 };
  members.forEach(m => { n[categoryOf(m)]++; });
  return [n.story && `стори ${n.story}`, n.defect && `дефекты ${n.defect}`, n.other && `задачи ${n.other}`]
    .filter(Boolean).join(" · ");
}

/**
 * Вкладка «Из релиза» в «Добавить задачи». Релиз — версия Jira: в её состав входят задачи, у которых она
 * указана в «Исправить в версиях». Ссылка (…/projects/SBER911/versions/2568004), id или название версии →
 * предпросмотр: задача с эпиком показывается эпиком (задачи одного эпика — под ним), без эпика — сама.
 * Отмеченное уходит в корзину; релиз запоминается в списке как источник — его состав сверяется при обновлении.
 */
export default function ReleaseTab({ project, inList, onPut }: {
  project: string;
  inList: Set<string>;
  onPut: (p: ReleasePick) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<ReleaseData | null>(null);
  const [offRows, setOffRows] = useState<Set<string>>(new Set());
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  const find = async () => {
    if (!text.trim()) { setErr("Вставьте ссылку на релиз (…/versions/12345) или его название"); return; }
    setBusy(true); setErr(""); setData(null); setOffRows(new Set());
    try { setData(await getRelease(text.trim(), project)); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const groups: ReleaseGroup[] = useMemo(
    () => (data ? composeRelease(data.issues, data.epics, data.epic_link) : []), [data]);
  const rowKey = (g: ReleaseGroup) => g.epic?.key ?? g.members[0].key;
  const chosen = groups.filter(g => !offRows.has(rowKey(g)) && !inList.has(rowKey(g)));

  const toggle = (set: Set<string>, k: string, fn: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(k)) n.delete(k); else n.add(k);
    fn(n);
  };

  const put = () => {
    if (!data) return;
    onPut({
      picked: chosen.map(g => g.epic ?? g.members[0]),
      // Снимок состава — все строки релиза, а не только отмеченные: иначе неотмеченные потом пришли бы «новыми».
      source: { key: data.release.id, name: data.release.name, keys: releaseKeys(groups) },
      all: [...data.issues, ...data.epics],
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="flex-1 flex items-center gap-2 rounded-lg border border-border-main bg-[var(--color-input-bg)] px-3 py-2
          focus-within:ring-2 focus-within:ring-primary/30">
          <Search className="w-4 h-4 text-text-muted" />
          <input autoFocus value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void find(); }}
            placeholder="Ссылка на релиз: https://jira…/projects/SBER911/versions/2568004 — или название версии"
            aria-label="Ссылка на релиз или название версии"
            className="flex-1 min-w-0 bg-transparent text-sm text-text-main focus:outline-none" />
        </label>
        <button type="button" onClick={() => void find()} disabled={busy || !text.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} Найти
        </button>
      </div>
      {err && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg p-2.5">{err}</p>}

      {data && (
        <>
          <div className="flex items-center gap-2 flex-wrap text-sm">
            <Rocket className="w-4 h-4 text-primary" />
            {data.release.url
              ? <a href={data.release.url} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">{data.release.name} ↗</a>
              : <span className="font-medium text-text-main">{data.release.name}</span>}
            <span className="text-xs text-text-muted">
              · {data.release.released ? "выпущен" : "не выпущен"}
              {data.release.release_date && <> · дата релиза {fmtJiraDate(data.release.release_date, false)}</>}
              {" "}· задач в релизе: {data.issues.length}{data.truncated && " (показаны первые 1000)"}
            </span>
          </div>

          <div className="border border-border-main rounded-xl max-h-[45vh] overflow-y-auto scrollbar-thin divide-y divide-border-main">
            {groups.length === 0 && <p className="p-3 text-sm text-text-muted">В релизе нет задач (никому не проставлена эта версия в «Исправить в версиях»).</p>}
            {groups.map(g => {
              const k = rowKey(g);
              const already = inList.has(k);
              const on = !offRows.has(k) && !already;
              const opened = openRows.has(k);
              return (
                <div key={k}>
                  <div className="flex items-center gap-2.5 px-3 py-2 text-sm">
                    <input type="checkbox" checked={on} disabled={already} onChange={() => toggle(offRows, k, setOffRows)}
                      aria-label={`Добавить ${k}`} title={already ? "Уже в списке" : undefined} />
                    {g.epic ? (
                      <>
                        <button type="button" onClick={() => toggle(openRows, k, setOpenRows)} aria-expanded={opened}
                          aria-label={opened ? "Скрыть задачи эпика" : "Показать задачи эпика"} disabled={!g.members.length}
                          className="text-text-muted disabled:invisible">
                          <ChevronRight className={`w-4 h-4 transition-transform ${opened ? "rotate-90" : ""}`} />
                        </button>
                        <IssueTypeBadge type={String(g.epic.fields.issuetype ?? "Epic")} />
                        <span className="font-mono text-xs text-primary flex-shrink-0">{g.epic.key}</span>
                        <span className="truncate text-text-main">{String(g.epic.fields.summary ?? "") || <i className="text-text-muted">нет доступа к эпику</i>}</span>
                        {g.members.length > 0 && <span className="ml-auto text-xs text-text-muted whitespace-nowrap">в релизе: {membersNote(g.members)}</span>}
                      </>
                    ) : (
                      <>
                        <span className="w-4" />
                        <IssueTypeBadge type={String(g.members[0].fields.issuetype ?? "")} />
                        <span className="font-mono text-xs text-primary flex-shrink-0">{g.members[0].key}</span>
                        <span className="truncate text-text-main">{String(g.members[0].fields.summary ?? "")}</span>
                        <span className="ml-auto text-xs text-text-muted whitespace-nowrap">{String(g.members[0].fields.status ?? "")}</span>
                      </>
                    )}
                  </div>
                  {g.epic && opened && (
                    <ul className="pl-16 pr-3 pb-2 space-y-1">
                      {g.members.map(m => (
                        <li key={m.key} className="flex items-center gap-2 text-xs">
                          <IssueTypeBadge type={String(m.fields.issuetype ?? "")} />
                          <span className="font-mono text-primary">{m.key}</span>
                          <span className="truncate text-text-main">{String(m.fields.summary ?? "")}</span>
                          <span className="ml-auto text-text-muted whitespace-nowrap">{String(m.fields.status ?? "")}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={put} disabled={!chosen.length}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              В корзину {chosen.length || ""}
            </button>
            <span className="text-[11px] text-text-muted">
              Задача с эпиком добавится эпиком, без эпика — сама. Состав релиза будет сверяться при обновлении.
            </span>
          </div>
        </>
      )}
    </div>
  );
}
