"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Modal from "@/components/ui/Modal";
import { OWN_TYPE_LABEL, newId, type OwnField, type OwnFieldType } from "@/lib/jiraTool";

/** Своё поле списка: свободный ввод, дата, дата и время, список, множественный выбор. */
export default function OwnFieldModal({ open, initial, typeLocked, onSave, onDelete, onClose }: {
  open: boolean;
  initial: OwnField | null;
  /** В поле уже есть значения — тип не меняем, иначе они станут бессмысленными. */
  typeLocked?: boolean;
  onSave: (f: OwnField) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<OwnFieldType>(initial?.type ?? "text");
  const [options, setOptions] = useState<string[]>(initial?.options ?? []);
  const [opt, setOpt] = useState("");
  const [asking, setAsking] = useState(false);
  const withOptions = type === "select" || type === "multiselect";

  const addOpt = () => {
    const parts = opt.split(/[,\n;]/).map(s => s.trim()).filter(Boolean);
    setOptions(o => Array.from(new Set([...o, ...parts])));
    setOpt("");
  };
  const valid = name.trim() && (!withOptions || options.length > 0);
  const field = "w-full text-sm border border-border-main rounded-lg px-3 py-2 bg-[var(--color-input-bg)] text-text-main " +
    "placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30";

  return (
    <Modal open={open} onClose={onClose} title={initial ? "Своё поле" : "Новое своё поле"}>
      <div className="space-y-4">
        <div>
          <label htmlFor="own-name" className="block text-xs font-semibold text-text-muted mb-1.5">Название</label>
          <input id="own-name" autoFocus value={name} onChange={e => setName(e.target.value)} maxLength={60}
            placeholder="Например, Дата ретеста" className={field} />
        </div>
        <fieldset>
          <legend className="block text-xs font-semibold text-text-muted mb-1.5">Тип</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {(Object.keys(OWN_TYPE_LABEL) as OwnFieldType[]).map(t => (
              <label key={t} className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm cursor-pointer transition-colors
                ${type === t ? "border-primary/50 bg-primary/5 text-text-main" : "border-border-main text-text-muted hover:text-text-main"}`}>
                <input type="radio" name="own-type" checked={type === t} onChange={() => setType(t)} disabled={typeLocked && initial?.type !== t} />
                {OWN_TYPE_LABEL[t]}
              </label>
            ))}
          </div>
          {typeLocked && <p className="text-[11px] text-text-muted mt-1.5">Тип не меняется: в поле уже есть значения.</p>}
        </fieldset>
        {withOptions && (
          <div>
            <label htmlFor="own-opt" className="block text-xs font-semibold text-text-muted mb-1.5">Варианты</label>
            <div className="flex gap-2 mb-2">
              <input id="own-opt" value={opt} onChange={e => setOpt(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addOpt(); } }}
                placeholder="Вариант, Enter — добавить (можно через запятую)" className={field} />
              <button type="button" onClick={addOpt} disabled={!opt.trim()}
                className="px-3 rounded-lg border border-border-main text-sm text-text-main hover:bg-bg-subtle disabled:opacity-40">Добавить</button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {options.length === 0 && <span className="text-xs text-text-muted">Пока нет вариантов</span>}
              {options.map(o => (
                <span key={o} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-bg-subtle text-xs text-text-main">
                  {o}
                  <button type="button" onClick={() => setOptions(x => x.filter(y => y !== o))} aria-label={`Убрать ${o}`}>
                    <X className="w-3 h-3 text-text-muted hover:text-red-500" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {onDelete && (asking ? (
            <span className="flex items-center gap-1.5 text-xs">
              <span className="text-text-muted">Удалить поле и его значения?</span>
              <button type="button" onClick={() => { onDelete(); onClose(); }} className="px-2 py-1 rounded-md bg-red-600 text-white font-semibold">Удалить</button>
              <button type="button" onClick={() => setAsking(false)} className="px-2 py-1 rounded-md border border-border-main text-text-muted">Отмена</button>
            </span>
          ) : (
            <button type="button" onClick={() => setAsking(true)} className="text-xs text-text-muted hover:text-red-500">Удалить поле</button>
          ))}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onClose} className="px-3 py-2 rounded-lg border border-border-main text-sm text-text-muted hover:text-text-main">Отмена</button>
            <button type="button" disabled={!valid}
              onClick={() => { onSave({ id: initial?.id ?? newId("own"), name: name.trim(), type, options: withOptions ? options : [] }); onClose(); }}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {initial ? "Сохранить" : "Создать поле"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

