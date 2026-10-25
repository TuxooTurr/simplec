"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bold, CheckSquare, Code, Columns2, Eye, Heading1, Heading2, Heading3, Image as ImageIcon, Italic, Link2, List,
  ListOrdered, Loader2, Minus, PanelLeftOpen, Pencil, Quote, Strikethrough, Table, Terminal,
} from "lucide-react";
import NotionRenderer from "@/components/NotionRenderer";
import { uploadReqAsset } from "@/lib/api";

type Mode = "edit" | "split" | "preview";
const MODE_KEY = "st_data_editor_mode";   // как удобнее писать — запоминается в браузере

type Cmd = { id: string; label: string; hint: string; Icon: typeof Bold; keys?: string[] };

/** Блоки — то, что вставляется с новой строки (как «/» в Notion). */
/** caret — куда встать курсором, sel — сколько символов выделить там (заготовку, чтобы сразу её перепечатать). */
const BLOCKS: (Cmd & { block: string; caret?: number; sel?: number })[] = [
  { id: "h1", label: "Заголовок 1", hint: "#", Icon: Heading1, keys: ["h1", "заголовок"], block: "# " },
  { id: "h2", label: "Заголовок 2", hint: "##", Icon: Heading2, keys: ["h2"], block: "## " },
  { id: "h3", label: "Заголовок 3", hint: "###", Icon: Heading3, keys: ["h3"], block: "### " },
  { id: "ul", label: "Маркированный список", hint: "-", Icon: List, keys: ["список", "bullet"], block: "- " },
  { id: "ol", label: "Нумерованный список", hint: "1.", Icon: ListOrdered, keys: ["нумер"], block: "1. " },
  { id: "todo", label: "Список задач", hint: "[ ]", Icon: CheckSquare, keys: ["задач", "todo", "чек"], block: "- [ ] " },
  { id: "quote", label: "Цитата / выноска", hint: ">", Icon: Quote, keys: ["цитат", "выноск", "callout"], block: "> " },
  { id: "table", label: "Таблица", hint: "3×2", Icon: Table, keys: ["табл"],
    block: "| Колонка 1 | Колонка 2 | Колонка 3 |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n", caret: 2, sel: 9 },
  { id: "cols", label: "Две колонки", hint: ":::", Icon: Columns2, keys: ["колон"],
    block: ":::columns\nЛевая колонка\n:::col\nПравая колонка\n:::\n", caret: 11, sel: 13 },
  { id: "code", label: "Код", hint: "```", Icon: Terminal, keys: ["код", "code"], block: "```\n\n```\n", caret: 4 },
  { id: "hr", label: "Разделитель", hint: "---", Icon: Minus, keys: ["раздел", "линия"], block: "---\n" },
];

/**
 * Редактор Markdown в духе Notion: панель (заголовки, списки, задачи, цитата, таблица, колонки, код, разделитель;
 * жирный, курсив, зачёркнутый, код, ссылка, картинка), меню «/» в начале строки, Ctrl/⌘+B / I / K, продолжение
 * списков по Enter, картинки — вставкой из буфера, перетаскиванием или кнопкой (загружаются к нам).
 * Режимы: «Редактор», «Рядом» (текст и результат), «Просмотр».
 */
export default function MarkdownEditor({ value, onChange, placeholder, minHeight = 420, autoFocus }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("edit");
  useEffect(() => { try { const m = localStorage.getItem(MODE_KEY) as Mode | null; if (m) setMode(m); } catch { /* приватный режим */ } }, []);
  const pickMode = (m: Mode) => { setMode(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* приватный режим */ } };
  const [uploading, setUploading] = useState(0);
  const [err, setErr] = useState("");
  const [slash, setSlash] = useState<{ start: number; q: string; sel: number } | null>(null);

  /** Заменить выделение и поставить курсор/выделение (после того, как React применит новое значение). */
  const apply = (next: string, selStart: number, selEnd = selStart) => {
    onChange(next);
    requestAnimationFrame(() => { const el = ta.current; if (el) { el.focus(); el.setSelectionRange(selStart, selEnd); } });
  };
  const wrap = (before: string, after = before, placeholderText = "текст") => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const sel = value.slice(a, b) || placeholderText;
    apply(value.slice(0, a) + before + sel + after + value.slice(b), a + before.length, a + before.length + sel.length);
  };
  const lineStart = (pos: number) => value.lastIndexOf("\n", pos - 1) + 1;
  /**
   * Блок. Заголовок, список, задача, цитата — превращают текущую строку (как в Notion; повторно — тот же вид не
   * дублируется). Таблица, колонки, код, разделитель — новой строкой (пустая текущая строка заменяется).
   * replaceFrom — начало строки «/запрос», которую заменяет выбор в меню.
   */
  const insertBlock = (block: string, caret?: number, replaceFrom?: number, sel = 0) => {
    const el = ta.current;
    if (!el) return;
    const pos = el.selectionStart;
    const ls = replaceFrom ?? lineStart(pos);
    let le = value.indexOf("\n", pos);
    if (le === -1) le = value.length;
    const line = replaceFrom !== undefined ? "" : value.slice(ls, le);
    const prefixType = !block.includes("\n");
    if (prefixType) {
      const body = line.replace(/^\s*(#{1,6} |[-*+] (\[[ xX]\] )?|\d+\. |> )/, "");
      const next = value.slice(0, ls) + block + body + value.slice(le);
      apply(next, ls + block.length + body.length);
      return;
    }
    const text = block.replace(/\n$/, "");
    let before = line.trim() ? value.slice(0, le) + "\n" : value.slice(0, ls);
    if (before.trim() && !before.endsWith("\n\n")) before += "\n";            // блок — отдельным абзацем
    let after = value.slice(le);
    if (after.replace(/^\n/, "").trim() && !after.startsWith("\n\n")) after = "\n" + (after.startsWith("\n") ? after : "\n" + after);
    const at = before.length + (caret ?? text.length);
    apply(before + text + after, at, at + sel);
  };
  const link = () => {
    const el = ta.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const text = value.slice(a, b) || "ссылка";
    const ins = `[${text}](https://)`;
    apply(value.slice(0, a) + ins + value.slice(b), a + text.length + 3, a + ins.length - 1);
  };

  const upload = async (files: File[]) => {
    const imgs = files.filter(f => f.type.startsWith("image/"));
    if (!imgs.length) return;
    setErr("");
    setUploading(n => n + imgs.length);
    for (const f of imgs) {
      try {
        const { url } = await uploadReqAsset(f);
        const el = ta.current;
        const pos = el ? el.selectionStart : value.length;
        const img = `![${f.name.replace(/\.[^.]+$/, "").replace(/[[\]]/g, "") || "изображение"}](${url})`;
        const cur = ta.current?.value ?? value;
        // Картинка — отдельным абзацем: прилипшая к строке она ломает соседнюю разметку (колонки, таблицу, заголовок).
        const pre = pos > 0 && cur[pos - 1] !== "\n" ? "\n\n" : "";
        const post = pos < cur.length && cur[pos] !== "\n" ? "\n\n" : "";
        onChange(cur.slice(0, pos) + pre + img + post + cur.slice(pos));
      } catch (e) { setErr((e as Error).message); }
      setUploading(n => n - 1);
    }
  };

  const filtered = useMemo(() => {
    if (!slash) return [];
    const q = slash.q.toLowerCase();
    return BLOCKS.filter(b => !q || b.label.toLowerCase().includes(q) || (b.keys ?? []).some(k => k.startsWith(q) || q.startsWith(k)));
  }, [slash]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (slash && filtered.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSlash({ ...slash, sel: (slash.sel + 1) % filtered.length }); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSlash({ ...slash, sel: (slash.sel - 1 + filtered.length) % filtered.length }); return; }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const b = filtered[slash.sel];
        setSlash(null);
        insertBlock(b.block, b.caret, slash.start, b.sel);
        return;
      }
    }
    if (e.key === "Escape" && slash) { setSlash(null); return; }
    if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); wrap("**"); return; }
    if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); wrap("*"); return; }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); link(); return; }
    // Enter в пункте списка — следующий пункт (пустой пункт — выйти из списка), как в Notion.
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      const el = e.currentTarget;
      const pos = el.selectionStart;
      if (pos !== el.selectionEnd) return;
      const ls = lineStart(pos);
      const line = value.slice(ls, pos);
      const m = line.match(/^(\s*)(- \[[ xX]\] |[-*+] |(\d+)\. |> )(.*)$/);
      if (!m) return;
      e.preventDefault();
      if (!m[4].trim()) { apply(value.slice(0, ls) + value.slice(pos), ls); return; }
      const marker = m[3] ? `${Number(m[3]) + 1}. ` : m[2].startsWith("- [") ? "- [ ] " : m[2];
      const ins = "\n" + m[1] + marker;
      apply(value.slice(0, pos) + ins + value.slice(pos), pos + ins.length);
    }
  };
  const onChangeText = (v: string, caret: number) => {
    onChange(v);
    const ls = v.lastIndexOf("\n", caret - 1) + 1;
    const m = v.slice(ls, caret).match(/^\/([^\s/]*)$/);
    setSlash(m ? { start: ls, q: m[1], sel: 0 } : null);
  };

  const btn = "w-7 h-7 flex items-center justify-center rounded text-text-muted hover:bg-bg-subtle hover:text-text-main disabled:opacity-40";
  const modeBtn = (on: boolean) => `inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs ${on ? "bg-bg-card text-text-main font-medium shadow-sm" : "text-text-muted hover:text-text-main"}`;
  const tool = (Icon: typeof Bold, title: string, fn: () => void) => (
    <button type="button" className={btn} title={title} aria-label={title} onMouseDown={e => e.preventDefault()} onClick={fn} disabled={mode === "preview"}>
      <Icon className="w-4 h-4" /></button>
  );
  const editor = (
    <div className="relative">
      <textarea ref={ta} value={value} autoFocus={autoFocus} spellCheck
        onChange={e => onChangeText(e.target.value, e.target.selectionStart)} onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setSlash(null), 150)}
        onPaste={e => { const fs = Array.from(e.clipboardData.files); if (fs.some(f => f.type.startsWith("image/"))) { e.preventDefault(); void upload(fs); } }}
        onDrop={e => { const fs = Array.from(e.dataTransfer.files); if (fs.length) { e.preventDefault(); void upload(fs); } }}
        placeholder={placeholder} aria-label="Текст (Markdown)" style={{ minHeight }}
        className="w-full h-full rounded-lg border border-border-main px-3 py-2 font-mono text-[13px] leading-relaxed bg-[var(--color-input-bg)] text-text-main placeholder:text-text-muted/60 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
      {slash && filtered.length > 0 && (
        <div role="listbox" aria-label="Вставить блок" className="absolute left-3 top-3 z-20 w-64 rounded-lg border border-border-main bg-bg-card p-1 shadow-xl">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wide text-text-muted">Блок · ↑↓ Enter</p>
          {filtered.map((b, i) => (
            <button key={b.id} type="button" role="option" aria-selected={i === slash.sel}
              onMouseDown={e => { e.preventDefault(); setSlash(null); insertBlock(b.block, b.caret, slash.start, b.sel); }}
              className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${i === slash.sel ? "bg-primary/10 text-primary" : "text-text-main hover:bg-bg-subtle"}`}>
              <b.Icon className="w-4 h-4" /> <span className="flex-1">{b.label}</span><span className="text-xs text-text-muted font-mono">{b.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border-main bg-bg-subtle/60 px-1.5 py-1">
        {BLOCKS.slice(0, 3).map(b => <span key={b.id}>{tool(b.Icon, b.label, () => insertBlock(b.block, b.caret, undefined, b.sel))}</span>)}
        <span className="mx-1 h-5 w-px bg-border-main" />
        {tool(Bold, "Жирный (Ctrl/⌘+B)", () => wrap("**"))}
        {tool(Italic, "Курсив (Ctrl/⌘+I)", () => wrap("*"))}
        {tool(Strikethrough, "Зачёркнутый", () => wrap("~~"))}
        {tool(Code, "Код в строке", () => wrap("`", "`", "код"))}
        {tool(Link2, "Ссылка (Ctrl/⌘+K)", link)}
        <span className="mx-1 h-5 w-px bg-border-main" />
        {BLOCKS.slice(3).map(b => <span key={b.id}>{tool(b.Icon, b.label, () => insertBlock(b.block, b.caret, undefined, b.sel))}</span>)}
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        {tool(ImageIcon, "Картинка (или вставьте из буфера / перетащите)", () => fileRef.current?.click())}
        {uploading > 0 && <Loader2 className="ml-1 w-4 h-4 animate-spin text-primary" aria-label="Загружаю картинку" />}
        <span className="flex-1" />
        <div className="inline-flex gap-0.5 rounded-lg bg-bg-subtle p-0.5" role="group" aria-label="Вид">
          <button type="button" className={modeBtn(mode === "edit")} aria-pressed={mode === "edit"} onClick={() => pickMode("edit")}><Pencil className="w-3.5 h-3.5" /> Редактор</button>
          <button type="button" className={modeBtn(mode === "split")} aria-pressed={mode === "split"} onClick={() => pickMode("split")}><PanelLeftOpen className="w-3.5 h-3.5" /> Рядом</button>
          <button type="button" className={modeBtn(mode === "preview")} aria-pressed={mode === "preview"} onClick={() => pickMode("preview")}><Eye className="w-3.5 h-3.5" /> Просмотр</button>
        </div>
      </div>
      {err && <p className="text-xs text-red-600 dark:text-red-400">{err}</p>}
      {mode === "edit" && editor}
      {mode === "split" && (
        <div className="grid grid-cols-2 gap-3">
          {editor}
          <div className="rounded-lg border border-border-main px-4 py-3 overflow-y-auto scrollbar-thin" style={{ maxHeight: Math.max(minHeight, 600) }}>
            {value.trim() ? <NotionRenderer text={value} /> : <p className="text-sm text-text-muted">Здесь будет результат.</p>}
          </div>
        </div>
      )}
      {mode === "preview" && (
        <div className="rounded-lg border border-border-main px-4 py-3" style={{ minHeight }}>
          {value.trim() ? <NotionRenderer text={value} /> : <p className="text-sm text-text-muted">Пусто.</p>}
        </div>
      )}
      <p className="text-[11px] text-text-muted">«/» в начале строки — меню блоков · Ctrl/⌘+B, I, K · картинку можно вставить из буфера или перетащить</p>
    </div>
  );
}
