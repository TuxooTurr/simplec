import type { DashboardWidget, WidgetPalette, WidgetSize } from "./dashboardApi";

// Fixed physical cell size: S stays small on a wide monitor.
export const GRID_COLUMNS = 128;
export const GRID_ROW = 38;
export const GRID_GAP = 6;
export const WIDGET_SIZES: Record<WidgetSize, { w: number; h: number }> = {
  S: { w: 4, h: 4 }, M: { w: 8, h: 8 }, L: { w: 16, h: 8 },
  XL: { w: 24, h: 12 }, XXL: { w: GRID_COLUMNS, h: 12 },
};
export const pixels = (cells: number) => cells * (GRID_ROW + GRID_GAP) - GRID_GAP;
export const sizeLabel = (name: WidgetSize) => name === "XXL" ? "XXL · на всю ширину" : `${name} · ${pixels(WIDGET_SIZES[name].w)} × ${pixels(WIDGET_SIZES[name].h)}`;
export const PALETTES: { id: WidgetPalette; name: string }[] = [
  { id: "indigo", name: "Индиго" }, { id: "ocean", name: "Океан" },
  { id: "forest", name: "Лес" }, { id: "warm", name: "Тёплая" },
  { id: "spectrum", name: "Спектр" },
];
export type GridRect = { x: number; y: number; w: number; h: number };
export const rectOf = (widget: DashboardWidget, columns = GRID_COLUMNS): GridRect => ({
  x: widget.fullWidth ? 0 : widget.x ?? 0, y: widget.y ?? 0,
  w: Math.min(columns, widget.kind === "counter" ? 4 : widget.fullWidth ? GRID_COLUMNS : widget.w ?? WIDGET_SIZES[widget.size].w),
  h: widget.kind === "counter" ? 4 : widget.h ?? WIDGET_SIZES[widget.size].h,
});
export const overlaps = (a: GridRect, b: GridRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function fitRect(widget: DashboardWidget, columns: number): GridRect {
  const rect = rectOf(widget, columns);
  return { ...rect, x: Math.max(0, Math.min(columns - rect.w, rect.x)) };
}

/** Viewport projection does not change canonical sizes or save the shared layout. */
export function fitWidgets(widgets: DashboardWidget[], columns: number): DashboardWidget[] {
  const occupied: GridRect[] = [];
  const positions = new Map<string, GridRect>();
  for (const widget of [...widgets].sort((a, b) => rectOf(a).y - rectOf(b).y || rectOf(a).x - rectOf(b).x)) {
    const rect = fitRect(widget, columns);
    let collision: GridRect | undefined;
    while ((collision = occupied.find(other => overlaps(rect, other)))) rect.y = collision.y + collision.h;
    occupied.push(rect); positions.set(widget.id, rect);
  }
  return widgets.map(widget => ({ ...widget, x: positions.get(widget.id)!.x, y: positions.get(widget.id)!.y }));
}

/** Перемещение: цель встаёт на место, задетые карточки уходят ниже (не прячутся). Размер — только до соседей. */
export function placeWidget(widgets: DashboardWidget[], id: string, target: GridRect, columns = GRID_COLUMNS,
  resize: { width?: boolean; height?: boolean } = {}): DashboardWidget[] {
  const source = widgets.find(widget => widget.id === id)!;
  const counter = source.kind === "counter";
  const fullWidth = !counter && !!source.fullWidth && (!resize.width || target.w >= columns);
  const canonicalWidth = counter ? 4 : fullWidth ? GRID_COLUMNS : resize.width ? Math.max(4, Math.min(columns, target.w)) : source.w ?? WIDGET_SIZES[source.size].w;
  target = { ...target, w: Math.min(columns, canonicalWidth),
    h: counter ? 4 : resize.height ? Math.max(4, Math.min(64, target.h)) : source.h ?? WIDGET_SIZES[source.size].h };
  target.x = fullWidth ? 0 : Math.max(0, Math.min(columns - target.w, target.x));
  target.y = Math.max(0, Math.min(2800, target.y));
  // Изменение размера не сдвигает соседей: виджет растёт только до ближайшего занятого места и там упирается.
  let width = canonicalWidth, wide = fullWidth;
  if (resize.width || resize.height) {
    const original = fitRect(source, columns);
    const wantedWidth = Math.min(target.w, columns - original.x);
    const wantedHeight = target.h;
    const others = widgets.filter(w => w.id !== id).map(w => fitRect(w, columns));
    const free = (rect: GridRect) => !others.some(other => overlaps(rect, other));
    // Apply any shrink first, then try enlarging each axis without sacrificing the other.
    Object.assign(target, original, { w: Math.min(original.w, wantedWidth), h: Math.min(original.h, wantedHeight) });
    while (target.w < wantedWidth && free({ ...target, w: target.w + 1 })) target.w += 1;
    while (target.h < wantedHeight && free({ ...target, h: target.h + 1 })) target.h += 1;
    wide = wide && target.w >= columns;
    if (resize.width) width = wide ? GRID_COLUMNS : target.w === original.w ? source.w ?? WIDGET_SIZES[source.size].w : target.w;
  }
  const occupied: GridRect[] = [target];
  const positions = new Map<string, GridRect>([[id, target]]);
  for (const widget of widgets.filter(w => w.id !== id).sort((a, b) => rectOf(a).y - rectOf(b).y || rectOf(a).x - rectOf(b).x)) {
    const rect = fitRect(widget, columns);
    let collision: GridRect | undefined;
    while ((collision = occupied.find(other => overlaps(rect, other)))) rect.y = collision.y + collision.h;
    occupied.push(rect); positions.set(widget.id, rect);
  }
  return widgets.map(widget => {
    const rect = positions.get(widget.id)!;
    return widget.id === id ? { ...widget, x: rect.x, y: rect.y, w: width, h: rect.h, fullWidth: wide, gridVersion: 2 }
      : { ...widget, x: rect.x, y: rect.y };
  });
}

export function addWidget(widgets: DashboardWidget[], widget: DashboardWidget, columns = GRID_COLUMNS): DashboardWidget[] {
  const fitted = fitWidgets(widgets, columns);
  const rect = rectOf(widget, columns);
  rect.x = 0; rect.y = 0;
  while (fitted.some(other => overlaps(rect, rectOf(other, columns)))) {
    rect.x += 1;
    if (rect.x + rect.w > columns || widget.fullWidth) { rect.x = 0; rect.y += 1; }
  }
  return [...fitted, { ...widget, x: rect.x, y: rect.y, gridVersion: 2 }];
}

export function seriesColor(widget: DashboardWidget, label: string, index: number): string {
  return widget.colors?.[label] ?? `var(--dashboard-${widget.palette ?? "indigo"}-${index % 6 + 1})`;
}
