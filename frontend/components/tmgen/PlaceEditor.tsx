"use client";

import { useEffect, useState } from "react";
import { FolderTree, Plus, X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import DataTreePicker from "./DataTreePicker";
import { listReqFolders, type ReqFolder } from "@/lib/api";
import { dataFolderPath } from "@/lib/taskModel";

/**
 * Место набора в модели: Блок / Раздел / Фича. Уровни правятся прямо в строке (фичи может не быть в дереве —
 * тогда её вписывают), «Из дерева» — выбрать папку «Данных». По месту строится иерархия папок в XML:
 * Новая ТМ / место / Пользовательский сценарий / Тип сценария.
 */
export default function PlaceEditor({ place, onChange, disabled }: { place: string[]; onChange: (p: string[]) => void; disabled?: boolean }) {
  const [pick, setPick] = useState(false);
  const [folders, setFolders] = useState<ReqFolder[]>([]);
  useEffect(() => { if (pick && !folders.length) listReqFolders().then(setFolders, () => {}); }, [pick, folders.length]);

  const set = (i: number, v: string) => onChange(place.map((p, k) => (k === i ? v.replace(/\//g, "-") : p)));
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-xs text-text-muted">Новая ТМ /</span>
        {place.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-0.5">
            <input value={p} disabled={disabled} onChange={e => set(i, e.target.value)} aria-label={`Уровень ${i + 1}`}
              style={{ width: `${Math.max(6, p.length + 2)}ch` }}
              className="rounded-md border border-border-main bg-[var(--color-input-bg)] px-1.5 py-0.5 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-primary/30" />
            {!disabled && place.length > 1 && (
              <button type="button" onClick={() => onChange(place.filter((_, k) => k !== i))} aria-label={`Убрать уровень ${p}`}
                className="rounded p-0.5 text-text-muted hover:text-red-500"><X className="h-3 w-3" /></button>
            )}
            {i < place.length - 1 && <span className="text-xs text-text-muted">/</span>}
          </span>
        ))}
        {!disabled && place.length < 3 && (
          <button type="button" onClick={() => onChange([...place, ""])} aria-label="Добавить уровень"
            className="rounded p-1 text-text-muted hover:text-primary"><Plus className="h-3.5 w-3.5" /></button>
        )}
        {!disabled && (
          <button type="button" onClick={() => setPick(true)}
            className="ml-1 inline-flex items-center gap-1 rounded-md border border-border-main px-2 py-0.5 text-xs text-text-main hover:bg-bg-subtle">
            <FolderTree className="h-3.5 w-3.5" /> Из дерева «Данных»</button>
        )}
      </div>
      <Modal open={pick} onClose={() => setPick(false)} title="Место в дереве" size="max-w-lg">
        <p className="mb-2 text-xs text-text-muted">Выберите папку фичи. Сценарии и типы сценариев лягут внутрь неё.</p>
        <DataTreePicker folders={folders} mode="folder" maxH="max-h-[55vh]"
          onPickFolder={f => { onChange(dataFolderPath(folders, f.id)); setPick(false); }} />
      </Modal>
    </div>
  );
}
