"use client";

import Modal from "@/components/ui/Modal";
import type { Issue } from "@/lib/jiraTool";

/** Служебные теги вики-разметки Jira ({color:red}, {code}, {noformat}, {panel:…}, {quote}) — читать мешают, смысла не несут. */
const WIKI_TAG_RE = /\{(?:color|code|noformat|panel|quote)(?::[^}]*)?\}/g;
/** [текст|ссылка] и [ссылка] из вики-разметки, а также голые http(s)-ссылки. */
const LINK_RE = /\[([^\]|]+)\|(https?:\/\/[^\]\s]+)\]|\[(https?:\/\/[^\]\s]+)\]|(https?:\/\/[^\s<>\]]+)/g;

/** Текст описания с кликабельными ссылками. Остальная разметка остаётся как есть. */
function DescriptionText({ text }: { text: string }) {
  const clean = text.replace(WIKI_TAG_RE, "").replace(/\r\n/g, "\n").trim();
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of clean.matchAll(LINK_RE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(clean.slice(last, at));
    const href = m[2] ?? m[3] ?? m[4];
    parts.push(
      <a key={at} href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{m[1] ?? href}</a>,
    );
    last = at + m[0].length;
  }
  if (last < clean.length) parts.push(clean.slice(last));
  return <div className="text-sm text-text-main whitespace-pre-wrap break-words leading-relaxed">{parts}</div>;
}

function Person({ label, name }: { label: string; name: unknown }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className="text-sm text-text-main truncate">{name ? String(name) : <span className="text-text-muted/60">не назначен</span>}</p>
    </div>
  );
}

/** Задача из списка: кто автор, кто исполнитель и описание — без перехода в Jira. */
export default function IssueModal({ open, issue, onClose }: { open: boolean; issue: Issue; onClose: () => void }) {
  const desc = issue.fields.description;
  return (
    <Modal open={open} onClose={onClose} title={`${issue.key} · ${String(issue.fields.summary ?? "")}`} size="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-2 pb-3 border-b border-border-main">
          <Person label="Автор" name={issue.fields.reporter} />
          <Person label="Исполнитель" name={issue.fields.assignee} />
          {issue.url && (
            <a href={issue.url} target="_blank" rel="noreferrer" className="ml-auto text-xs text-primary hover:underline">Открыть в Jira ↗</a>
          )}
        </div>
        {desc ? (
          <div className="max-h-[60vh] overflow-y-auto pr-1"><DescriptionText text={String(desc)} /></div>
        ) : (
          <p className="text-sm text-text-muted p-4 border border-dashed border-border-main rounded-xl text-center">Описания нет.</p>
        )}
      </div>
    </Modal>
  );
}
