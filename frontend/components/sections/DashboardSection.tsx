"use client";
/* Hallmark · pre-emit critique: P4 H5 E4 S5 R5 V4 · Shark workspace */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { Check, Grip, Grid2X2, MoveDiagonal2, Plus, X } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { ViewButtons } from "@/components/ui/ViewButtons";
import { getDashboard, refreshWidget, saveDashboard, type Layout, type DashboardWidget as Widget } from "@/lib/dashboardApi";
import { addWidget, fitWidgets, placeWidget, rectOf, pixels, GRID_COLUMNS, GRID_GAP, GRID_ROW, type GridRect } from "@/lib/dashboardGrid";
import DashboardWidget from "@/components/dashboard/DashboardWidget";
import WidgetModal from "@/components/dashboard/WidgetModal";
import { usePanelRefresh } from "@/components/ui/RefreshButton";
import "../dashboard/dashboard.css";

type Interaction = { id: string; mode: "move" | "resize"; startX: number; startY: number; rect: GridRect; base: Widget[]; original: Widget[] };
export default function DashboardSection() {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [board, setBoard] = useState("main");
  const [newBoard, setNewBoard] = useState(false);
  const [boardName, setBoardName] = useState("");
  const [draft, setDraft] = useState<Widget[]>([]);
  const [arranging, setArranging] = useState(false);
  const [editing, setEditing] = useState<Widget | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<Widget | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction | null>(null);
  const compact = width < 640;
  const columns = Math.max(4, Math.min(GRID_COLUMNS, Math.floor((width + GRID_GAP) / (GRID_ROW + GRID_GAP)) || 4));
  const boards = layout?.boards ?? [];
  const boardWidgets = (layout?.widgets ?? []).filter(w => (w.boardId ?? "main") === board);
  const widgets = arranging ? draft : boardWidgets;
  /** Общие виджеты меняет редактор Главной, личные — их владелец (сервер отдаёт только свои личные). */
  const editable = (w: Widget) => !!layout?.canEdit || w.scope === "personal";
  const fitted = fitWidgets(widgets, columns);

  useEffect(() => {
    if (!active) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && interaction.current) {
        setDraft(interaction.current.original); interaction.current = null; setActive(null); event.preventDefault();
      }
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [active]);

  async function load() {
    setBusy(true);
    try {
      const data = await getDashboard();
      setLayout(data); setError("");
      const remembered = localStorage.getItem(`st_dashboard_board:${data.login}`);
      setBoard(data.boards?.some(b => b.id === remembered) ? remembered! : "main");
    }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  usePanelRefresh(() => {
    if (arranging) setError("Сохраните или отмените раскладку перед обновлением.");
    else void (async () => {
      setBusy(true);
      try { await Promise.all(boardWidgets.map(widget => refreshWidget(widget.id))); await load(); }
      catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
    })();
  }, { busy, title: "Обновить Главную" });

  async function save(next: Widget[], nextBoards = boards) {
    if (!layout || saving) throw new Error("Дождитесь завершения сохранения раскладки.");
    setSaving(true); setError(""); setSaved(false);
    try {
      const other = layout.widgets.filter(w => (w.boardId ?? "main") !== board);
      setLayout(await saveDashboard({ ...layout, boards: nextBoards, widgets: [...other, ...next] }));
      setSaved(true);
    }
    catch (e) { setError((e as Error).message); throw e; }
    finally { setSaving(false); }
  }
  function switchBoard(id: string) {
    setBoard(id); setSaved(false); setError("");
    if (layout) localStorage.setItem(`st_dashboard_board:${layout.login}`, id);
  }

  function startLayout() {
    setDraft(boardWidgets);
    setArranging(true);
    setSaved(false);
  }

  function begin(e: PointerEvent, widget: Widget, mode: Interaction["mode"]) {
    if (compact || saving || e.button !== 0 || !editable(widget)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    interaction.current = { id: widget.id, mode, startX: e.clientX, startY: e.clientY, rect: rectOf(widget, columns), base: fitted, original: widgets };
    if (!arranging) startLayout();
    setActive(widget.id);
  }
  function drag(e: PointerEvent) {
    const current = interaction.current;
    if (!current) return;
    const dx = Math.round((e.clientX - current.startX) / (GRID_ROW + GRID_GAP));
    const dy = Math.round((e.clientY - current.startY) / (GRID_ROW + GRID_GAP));
    const next = { ...current.rect };
    if (current.mode === "move") { next.x += dx; next.y += dy; }
    else { next.w += dx; next.h += dy; }
    setDraft(placeWidget(current.base, current.id, next, columns, { width: current.mode === "resize" && dx !== 0, height: current.mode === "resize" && dy !== 0 }));
    setSaved(false);
    if (canvas.current && e.clientY > innerHeight - 70) canvas.current.parentElement?.scrollBy(0, 12);
  }
  function end() { interaction.current = null; setActive(null); }
  function cancelDrag() { if (interaction.current) setDraft(interaction.current.original); end(); }
  function keyboard(widget: Widget, key: string, resize = false) {
    if (saving || !editable(widget)) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    if (!delta) return;
    const rect = rectOf(widget, columns);
    if (resize) { rect.w += delta[0]; rect.h += delta[1]; }
    else { rect.x += delta[0]; rect.y += delta[1]; }
    if (!arranging) setArranging(true);
    setDraft(placeWidget(fitted, widget.id, rect, columns, { width: resize && delta[0] !== 0, height: resize && delta[1] !== 0 })); setSaved(false);
  }

  return (
    <section className="shark-dashboard" aria-label="Главная">
      <header className="dashboard-toolbar">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold">{board === "main" ? "Рабочий стол команды" : boards.find(b => b.id === board)?.name}</h1>
            {layout?.demo && <span className="text-[10px] uppercase tracking-wide rounded bg-bg-subtle border border-border-main px-1.5 py-0.5 text-text-muted">Демо</span>}
          </div>
          {arranging && !compact && <p className="text-xs text-text-muted mt-1">Перетаскивайте за ручку, меняйте размер за угол. Стрелки на клавиатуре тоже работают.</p>}
        </div>
        {saved && !arranging && <span role="status" className="text-xs text-text-muted flex items-center gap-1"><Check className="w-3.5 h-3.5" />Сохранено</span>}
        {layout && (
          <div className="flex gap-2 flex-wrap">
            <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Рабочие столы">
              <ViewButtons active={board} addLabel="Новый рабочий стол" disabled={arranging || busy || saving}
                addDisabled={boards.length >= 12} onAdd={() => { setBoardName(""); setNewBoard(true); }}
                views={[{ id: "main", name: "Команда" }, ...boards].map(({ id, name }) => ({
                  id, name, label: `Рабочий стол «${name}»`, title: name,
                  onSelect: () => { if (id !== board) switchBoard(id); },
                }))} />
            </div>
            {arranging ? <>
              <Button variant="ghost" disabled={saving} onClick={() => { setArranging(false); setError(""); }} icon={<X className="w-3.5 h-3.5" />}>Отмена</Button>
              <Button loading={saving} onClick={async () => { try { await save(draft); setArranging(false); } catch {} }} icon={<Check className="w-3.5 h-3.5" />}>Сохранить</Button>
            </> : <Button variant="ghost" disabled={busy || saving} onClick={startLayout} icon={<Grid2X2 className="w-3.5 h-3.5" />}>Раскладка</Button>}
            <Button disabled={saving} onClick={() => setEditing(null)} icon={<Plus className="w-3.5 h-3.5" />}>Виджет</Button>
          </div>
        )}
      </header>
      {error && <p role="alert" className="px-6 py-2 text-sm tone-danger">{error}</p>}
      <div className="dashboard-workspace">
        <main className="dashboard-main">
          {busy && !layout && <p role="status" className="text-sm text-text-muted">Загружаю рабочий стол…</p>}
          <div ref={canvas} className="dashboard-canvas" data-editing={arranging} style={{ gridTemplateColumns: `repeat(${columns}, ${GRID_ROW}px)`, gridAutoRows: `${GRID_ROW}px`, gap: `${GRID_GAP}px`, "--dashboard-grid-step": `${GRID_ROW + GRID_GAP}px`,
              // Сетка по центру: остаток ширины, не кратный ячейке, делится поровну слева и справа (точки раскладки — вровень с ячейками).
              justifyContent: "center", backgroundPosition: `${Math.max(0, (width - pixels(columns)) / 2)}px 0` } as CSSProperties}>
            {fitted.map(w => {
              const rect = rectOf(w, columns);
              return <div key={w.id} className="dashboard-card" data-editing={arranging} data-active={active === w.id}
                style={{ gridColumn: `${rect.x + 1} / span ${rect.w}`, gridRow: `${rect.y + 1} / span ${rect.h}`, }}>
                <DashboardWidget widget={w} canEdit={editable(w)} arranging={arranging}
                  onPresentationChange={async presentation => {
                    const next = (arranging ? draft : boardWidgets).map(item => item.id === w.id ? { ...item, presentation } : item);
                    if (arranging) setDraft(next); else await save(next);
                  }}
                  onColumnsChange={async columns => {
                    const source = arranging ? draft : boardWidgets;
                    const next = source.map(item => item.id === w.id ? { ...item, columns } : item);
                    if (arranging) setDraft(next); else await save(next);
                  }}
                  onEdit={() => setEditing(widgets.find(source => source.id === w.id)!)} onDelete={() => setDeleting(w)}
                  dragHandle={arranging && !compact && editable(w) ? <button type="button" className="dashboard-drag text-text-muted p-1 rounded hover:bg-bg-subtle focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`Переместить ${w.title}`} title="Перетащить · стрелки — перемещение"
                    onPointerDown={e => begin(e, w, "move")} onPointerMove={drag} onPointerUp={end} onPointerCancel={cancelDrag}
                    onKeyDown={e => { if (e.key.startsWith("Arrow")) { e.preventDefault(); keyboard(w, e.key); } }}>
                    <Grip className="w-4 h-4" />
                  </button> : undefined} />
                {editable(w) && w.kind !== "counter" && <button type="button" className="dashboard-resize focus-visible:ring-2 focus-visible:ring-primary"
                  data-compact={compact} disabled={busy || saving} aria-label={`Изменить размер ${w.title}`}
                  title={compact ? "Выбрать размер виджета" : `${w.fullWidth ? "Вся ширина" : pixels(rect.w)} × ${pixels(rect.h)} · тяните угол или нажимайте стрелки`}
                  onClick={() => { if (compact) setEditing(widgets.find(source => source.id === w.id)!); else if (!arranging) startLayout(); }}
                  onPointerDown={e => begin(e, w, "resize")} onPointerMove={drag} onPointerUp={end} onPointerCancel={cancelDrag}
                  onKeyDown={e => { if (!compact && e.key.startsWith("Arrow")) { e.preventDefault(); keyboard(w, e.key, true); } }}>
                  <MoveDiagonal2 className="w-4 h-4" />
                </button>}
                {arranging && <span className="absolute bottom-2 right-9 text-[10px] text-text-muted bg-bg-card px-1 rounded pointer-events-none">{w.kind === "counter" ? "S" : `${w.fullWidth ? "Вся ширина" : pixels(rect.w)} × ${pixels(rect.h)}`}</span>}
              </div>;
            })}
            {layout && !widgets.length && <div className="col-span-full row-span-4 rounded-xl border border-dashed border-border-main bg-bg-card p-6 flex flex-col justify-center items-start">
              <Grid2X2 className="w-7 h-7 text-primary mb-3" />
              <h2 className="font-semibold mb-2">Ваш рабочий стол</h2>
              <p className="text-sm text-text-muted max-w-md">Начните со списка задач или счётчика. Затем расположите виджеты так, как удобно вашей команде.</p>
              <Button className="mt-4" onClick={() => setEditing(null)} icon={<Plus className="w-4 h-4" />}>Добавить виджет</Button>
            </div>}
          </div>
        </main>
      </div>
      {newBoard && <Modal open title="Новый рабочий стол" onClose={() => setNewBoard(false)}
        footer={<Button loading={saving} disabled={!boardName.trim()} onClick={async () => {
          const id = crypto.randomUUID();
          try {
            await save(boardWidgets, [...boards, { id, name: boardName.trim() }]);
            setNewBoard(false); switchBoard(id);
          } catch {}
        }}>Создать</Button>}>
        <input autoFocus aria-label="Название рабочего стола" className="w-full rounded-lg border border-border-main bg-bg-card px-3 py-2"
          value={boardName} maxLength={40} onChange={e => setBoardName(e.target.value)} />
        {error && <p role="alert" className="mt-2 text-sm tone-danger">{error}</p>}
      </Modal>}
      {editing !== undefined && layout && <WidgetModal widget={editing ?? undefined} canShare={layout.canEdit && board === "main"} onClose={() => setEditing(undefined)} onSave={async w => {
        w = { ...w, boardId: board };
        const source = arranging ? draft : boardWidgets;
        const next = editing ? placeWidget(source.map(x => x.id === w.id ? w : x), w.id, rectOf(w, columns), columns) : addWidget(source, w, columns);
        if (arranging) setDraft(next); else await save(next);
      }} />}
      {deleting && layout && <Modal open title="Убрать виджет с Главной?" onClose={() => setDeleting(null)}
        footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleting(null)}>Отмена</Button><Button variant="danger" onClick={async () => {
          const next = (arranging ? draft : boardWidgets).filter(w => w.id !== deleting.id);
          try { if (arranging) setDraft(next); else await save(next); setDeleting(null); } catch {}
        }}>Убрать виджет</Button></div>}>
        <p className="text-sm text-text-muted">{deleting.title}. История обработки останется в хранилище Shark.</p>
      </Modal>}
    </section>
  );
}
