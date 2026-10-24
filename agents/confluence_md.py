"""
Тело страницы Confluence (storage format — XHTML с макросами ac:/ri:) → Markdown для раздела «Данные».

Что переносится:
  • заголовки h1–h6, абзацы, переносы строк, жирный / курсив / код / зачёркнутый, горизонтальная черта;
  • списки (вложенные — отступом), списки задач (ac:task-list) — «- [ ]» / «- [x]»;
  • таблицы — таблицами Markdown (первая строка — шапка; объединённые ячейки повторяются пустыми,
    многострочное содержимое ячейки — через «; »);
  • ссылки: обычные — [текст](url), на страницы Confluence (ac:link → ri:page) — [заголовок](адрес по заголовку);
  • макросы: code / noformat — блоком кода с языком; info / note / tip / warning / panel — цитатой с пометкой;
    expand — заголовком и содержимым; status — [СТАТУС]; jira — ключом задачи; drawio / gliffy / картинки —
    пометкой с именем (сами изображения без входа в Confluence не показать); toc, children и служебные — пропускаются.
Неизвестный макрос — содержимое его тела, если оно есть.
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from typing import Optional
from urllib.parse import quote

_BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table", "tr", "td", "th", "blockquote",
          "pre", "hr", "ac:task-list", "ac:task"}
_PANELS = {"info": "Информация", "note": "Примечание", "tip": "Совет", "warning": "Внимание", "panel": ""}
_INLINE_MACROS = {"status", "jira", "anchor"}
_SKIP_MACROS = {"toc", "children", "pagetree", "recently-updated", "contentbylabel", "anchor", "excerpt-include",
                "include", "livesearch", "attachments", "profile", "roadmap", "viewpdf", "multimedia"}


class _Cell:
    def __init__(self) -> None:
        self.parts: list[str] = []


class _Conv(HTMLParser):
    def __init__(self, base_url: str = "", space: str = "") -> None:
        super().__init__(convert_charrefs=True)
        self.base, self.space = base_url.rstrip("/"), space
        self.out: list[str] = []            # готовые блоки
        self.buf: list[str] = []            # текущий абзац (инлайн)
        self.lists: list[list] = []         # стек списков: ["ul"|"ol", счётчик]
        self.tables: list[dict] = []        # стек таблиц: rows, cur_row, cell
        self.macros: list[dict] = []        # стек макросов ac:structured-macro
        self.param: Optional[str] = None    # имя ac:parameter, который читаем
        self.links: list[dict] = []         # стек ссылок
        self.pre = 0                        # внутри <pre> / тела кода
        self.quote = 0
        self.skip = 0                       # внутри пропускаемого макроса
        self.heading: Optional[int] = None
        self.task_done: list[bool] = []

    # ── куда пишется инлайн-текст ──
    def _emit(self, s: str) -> None:
        if self.skip:
            return
        if self.tables and self.tables[-1]["cell"] is not None:
            self.tables[-1]["cell"].parts.append(s)
        else:
            self.buf.append(s)

    def _flush(self) -> None:
        """Закончить текущий абзац / пункт: текст из buf — в блоки с нужным оформлением."""
        text = "".join(self.buf)
        self.buf = []
        if self.pre:
            return
        text = re.sub(r"[ \t ]+", " ", text)
        text = "\n".join(l.strip() for l in text.split("\n")).strip()
        if not text:
            return
        if self.heading:
            text = "#" * self.heading + " " + text.replace("\n", " ")
        elif self.lists:
            kind, n = self.lists[-1]
            pad = "  " * (len(self.lists) - 1)
            if kind == "task":
                mark = "- [x] " if (self.task_done and self.task_done[-1]) else "- [ ] "
            elif kind == "ol":
                mark = f"{n}. "
            else:
                mark = "- "
            text = pad + mark + text.replace("\n", " ")
        if self.quote:
            text = "\n".join("> " + l for l in text.split("\n"))
        self.out.append(text)

    # ── теги ──
    def handle_starttag(self, tag: str, attrs: list) -> None:
        a = dict(attrs)
        if self.skip:
            if tag == "ac:structured-macro":
                self.skip += 1
            return
        if tag == "ac:structured-macro":
            name = (a.get("ac:name") or "").lower()
            if name in _SKIP_MACROS:
                self.skip = 1
                return
            if name not in _INLINE_MACROS:
                self._flush()
            self.macros.append({"name": name, "params": {}, "body": []})
            return
        if tag == "ac:parameter":
            self.param = (a.get("ac:name") or "").lower()
            return
        if tag == "ac:task-id":
            self.skip = 1
            return
        if tag == "ac:plain-text-body":
            self.pre += 1
            return
        if tag in ("ac:rich-text-body",):
            m = self.macros[-1] if self.macros else None
            if m and m["name"] in _PANELS:
                label = _PANELS[m["name"]] or m["params"].get("title", "")
                self.quote += 1
                if label or m["params"].get("title"):
                    self.out.append("> **" + (m["params"].get("title") or label) + "**")
            elif m and m["name"] == "expand":
                self.out.append("**" + (m["params"].get("title") or "Подробнее") + "**")
            return
        if tag in _BLOCK and tag not in ("td", "th", "tr", "table") and not (self.tables and self.tables[-1]["cell"] is not None):
            self._flush()
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.heading = int(tag[1])
        elif tag in ("ul", "ol"):
            self.lists.append([tag, 0])
        elif tag == "ac:task-list":
            self.lists.append(["task", 0])
        elif tag == "li":
            if self.lists:
                self.lists[-1][1] += 1
        elif tag == "ac:task":
            self.task_done.append(False)
        elif tag == "blockquote":
            self.quote += 1
        elif tag == "pre":
            self.pre += 1
            self.out.append("```")
        elif tag == "hr":
            self.out.append("---")
        elif tag == "br":
            self._emit("\n")
        elif tag in ("strong", "b"):
            self._emit("**")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag in ("s", "del", "strike"):
            self._emit("~~")
        elif tag == "code" and not self.pre:
            self._emit("`")
        elif tag == "table":
            self._flush()
            self.tables.append({"rows": [], "row": None, "cell": None})
        elif tag == "tr" and self.tables:
            self.tables[-1]["row"] = []
        elif tag in ("td", "th") and self.tables:
            t = self.tables[-1]
            t["cell"] = _Cell()
            t["span"] = int(a.get("colspan") or 1) if str(a.get("colspan") or "1").isdigit() else 1
        elif tag == "a":
            self.links.append({"href": a.get("href") or "", "start": self._pos()})
        elif tag == "ac:link":
            self.links.append({"href": "", "start": self._pos(), "title": ""})
        elif tag == "ri:page" and self.links:
            title = a.get("ri:content-title") or ""
            space = a.get("ri:space-key") or self.space
            self.links[-1]["title"] = title
            if self.base and title:
                self.links[-1]["href"] = f"{self.base}/display/{quote(space)}/{quote(title.replace(' ', '+'), safe='+')}" if space else ""
        elif tag == "ri:attachment" and self.links:
            self.links[-1]["title"] = a.get("ri:filename") or ""
        elif tag == "ri:url" and self.links:
            self.links[-1]["href"] = a.get("ri:value") or ""
        elif tag == "ac:image":
            self.links.append({"image": True, "start": self._pos(), "title": a.get("ac:alt") or a.get("ac:title") or ""})
        elif tag == "ac:emoticon":
            self._emit(a.get("ac:emoji-fallback") or "")

    def handle_startendtag(self, tag: str, attrs: list) -> None:
        if tag in ("ri:page", "ri:attachment", "ri:url", "br", "hr", "ac:emoticon"):
            self.handle_starttag(tag, attrs)
            return
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def _pos(self):
        if self.tables and self.tables[-1]["cell"] is not None:
            return ("cell", len(self.tables[-1]["cell"].parts))
        return ("buf", len(self.buf))

    def _since(self, pos) -> str:
        where, i = pos
        parts = self.tables[-1]["cell"].parts if where == "cell" and self.tables and self.tables[-1]["cell"] else self.buf
        text = "".join(parts[i:])
        del parts[i:]
        return text

    def handle_endtag(self, tag: str) -> None:
        if self.skip:
            if tag == "ac:structured-macro" or tag == "ac:task-id":
                self.skip -= 1
            return
        if tag == "ac:parameter":
            self.param = None
            return
        if tag == "ac:plain-text-body":
            self.pre -= 1
            return
        if tag == "ac:rich-text-body":
            self._flush()
            m = self.macros[-1] if self.macros else None
            if m and m["name"] in _PANELS:
                self.quote = max(0, self.quote - 1)
            return
        if tag == "ac:structured-macro":
            if not self.macros:
                return
            m = self.macros.pop()
            name, p = m["name"], m["params"]
            if name in ("code", "noformat"):
                self._flush()
                body = "".join(m["body"]).strip("\n")
                lang = p.get("language", "") if name == "code" else ""
                self.out.append(f"```{lang}\n{body}\n```")
            elif name == "status":
                self._emit(f"[{(p.get('title') or p.get('colour') or 'статус').upper()}]")
            elif name == "jira":
                self._emit(p.get("key") or "")
            elif name in ("drawio", "drawio-sketch", "gliffy", "plantuml", "mermaid-macro"):
                self._flush()
                self.out.append(f"*[Диаграмма {name}: {p.get('diagramname') or p.get('name') or 'без имени'}]*")
            elif m["body"] and name not in _PANELS and name != "expand":
                self._flush()
                self.out.append("```\n" + "".join(m["body"]).strip("\n") + "\n```")
            return
        if tag in ("strong", "b"):
            self._emit("**")
        elif tag in ("em", "i"):
            self._emit("*")
        elif tag in ("s", "del", "strike"):
            self._emit("~~")
        elif tag == "code" and not self.pre:
            self._emit("`")
        elif tag in ("a", "ac:link") and self.links:
            ln = self.links.pop()
            text = self._since(ln["start"]).strip() or ln.get("title") or ln.get("href", "")
            href = ln.get("href") or ""
            self._emit(f"[{text}]({href})" if href.startswith(("http://", "https://")) else text)
        elif tag == "ac:image" and self.links:
            ln = self.links.pop()
            self._since(ln["start"])
            self._emit(f"*[изображение{': ' + ln['title'] if ln.get('title') else ''}]*")
        elif tag in ("td", "th") and self.tables:
            t = self.tables[-1]
            if t["cell"] is not None and t["row"] is not None:
                text = re.sub(r"\s*\n\s*", "; ", "".join(t["cell"].parts)).strip(" ;")
                text = re.sub(r"[ \t ]+", " ", text).replace("|", "\\|")
                t["row"].append(text)
                t["row"].extend([""] * (t.get("span", 1) - 1))
            t["cell"] = None
        elif tag == "tr" and self.tables:
            t = self.tables[-1]
            if t["row"]:
                t["rows"].append(t["row"])
            t["row"] = None
        elif tag == "table" and self.tables:
            t = self.tables.pop()
            rows = [r for r in t["rows"] if any(c for c in r)]
            if rows:
                n = max(len(r) for r in rows)
                rows = [r + [""] * (n - len(r)) for r in rows]
                line = lambda r: "| " + " | ".join(c or " " for c in r) + " |"
                md = "\n".join([line(rows[0]), "|" + "---|" * n] + [line(r) for r in rows[1:]])
                if self.tables and self.tables[-1]["cell"] is not None:      # таблица в таблице — текстом
                    self._emit(" ".join(" / ".join(c for c in r if c) for r in rows))
                else:
                    self.out.append(md)
        elif tag == "pre":
            self.pre -= 1
            self.out.append("".join(self.buf).strip("\n"))
            self.buf = []
            self.out.append("```")
        elif tag in ("ul", "ol", "ac:task-list"):
            self._flush()
            if self.lists:
                self.lists.pop()
        elif tag == "ac:task":
            self._flush()
            if self.task_done:
                self.task_done.pop()
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._flush()
            self.heading = None
        elif tag == "blockquote":
            self._flush()
            self.quote = max(0, self.quote - 1)
        elif tag in ("p", "div", "li"):
            if self.tables and self.tables[-1]["cell"] is not None:
                self._emit("\n")                              # абзацы ячейки — через «; »
            else:
                self._flush()

    def handle_data(self, data: str) -> None:
        if self.skip:
            return
        if self.param is not None and self.macros:
            self.macros[-1]["params"][self.param] = self.macros[-1]["params"].get(self.param, "") + data
            return
        if self.pre and self.macros and self.macros[-1]["name"] not in _PANELS and self.macros[-1]["name"] != "expand":
            self.macros[-1]["body"].append(data)
            return
        if self.pre:
            self.buf.append(data)
            return
        self._emit(data)

    def unknown_decl(self, data: str) -> None:
        if data.startswith("CDATA["):
            self.handle_data(data[6:])

    def finish(self) -> str:
        self._flush()
        blocks: list[str] = []
        for b in (b for b in self.out if b.strip()):
            if blocks and b.startswith(">") and blocks[-1].startswith(">"):
                blocks[-1] += "\n>\n" + b                    # одна панель — одна цитата
            else:
                blocks.append(b)
        md = "\n\n".join(blocks)
        md = re.sub(r"\*\*\s*\*\*", "", md)                  # пустой жирный
        # Пункты списков подряд — без пустых строк между ними.
        md = re.sub(r"(?m)^(\s*(?:- |\d+\. ).*)\n\n(?=\s*(?:- |\d+\. ))", r"\1\n", md)
        md = re.sub(r"(?m)^(\s*(?:- |\d+\. ).*)\n\n(?=\s*(?:- |\d+\. ))", r"\1\n", md)
        return md.strip()


def _task_status(xml: str) -> str:
    """<ac:task-status>complete</ac:task-status> → пометка внутри задачи (до разбора — иначе статус попадёт в текст)."""
    return re.sub(r"<ac:task-status>\s*(complete|incomplete)\s*</ac:task-status>",
                  lambda m: "<ac:task-done/>" if m.group(1) == "complete" else "", xml)


def storage_to_markdown(xml: str, base_url: str = "", space: str = "") -> str:
    conv = _Conv(base_url, space)
    xml = _task_status(xml or "")
    # Отметку «выполнено» разбираем отдельным пустым тегом.
    orig_start = conv.handle_starttag

    def start(tag: str, attrs: list) -> None:
        if tag == "ac:task-done":
            if conv.task_done:
                conv.task_done[-1] = True
            return
        orig_start(tag, attrs)
    conv.handle_starttag = start                                  # type: ignore[method-assign]
    conv.feed(xml)
    conv.close()
    return conv.finish()
