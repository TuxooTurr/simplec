"use client";
import { useRef, useState } from "react";
import { Columns3 } from "lucide-react";
import { Button } from "@/components/ui";
import Floating from "@/components/jiratool/Floating";
import { PickerPanel, type PickOption } from "@/components/jiratool/FieldPicker";

export default function DashboardColumns({ columns, options, onChange }: {
  columns: string[]; options: PickOption[]; onChange: (columns: string[]) => Promise<void>;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <div ref={anchor}>
    <Button variant="icon" title="Колонки" aria-label="Колонки" onClick={() => { setDraft(draft ? null : [...columns]); setError(""); }} icon={<Columns3 className="w-3.5 h-3.5" />} />
    {draft && <Floating anchor={anchor} onClose={() => { if (!busy) setDraft(null); }} width={Math.min(340, typeof window === "undefined" ? 340 : window.innerWidth - 16)} className="p-3" role="dialog" ariaLabel="Колонки списка">
      <p className="text-sm font-semibold mb-2">Колонки списка</p>
      <PickerPanel label="Колонки" options={options} selected={draft} ordered onChange={next => setDraft([...new Set(["key", ...next])])} />
      <p className="text-[11px] text-text-muted mt-2">Номер остаётся первым. Остальные поля идут в порядке выбора; уберите и добавьте поле, чтобы переставить.</p>
      {error && <p role="alert" className="text-xs tone-danger mt-2">{error}</p>}
      <div className="flex justify-end gap-2 mt-3"><Button variant="ghost" disabled={busy} onClick={() => setDraft(null)}>Отмена</Button><Button loading={busy} onClick={async () => {
        setBusy(true); setError("");
        try { await onChange(draft); setDraft(null); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Применить</Button></div>
    </Floating>}
  </div>;
}
