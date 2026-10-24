"""
DOCX → Markdown без сторонних библиотек (DOCX — zip с XML; python-docx в корпоративной сети может не стоять).

Что берётся из документа:
  • заголовки — по стилю абзаца («Heading N» / «Заголовок N», «Title» / «Название») или уровню структуры
    (outlineLvl); если стилей заголовков в документе нет (оформлено вручную), — по кеглю, как в PDF: основной кегль —
    у большинства символов, крупнее — «#», «##», «###»;
  • короткий абзац целиком жирным — подзаголовок уровнем ниже, с двоеточием в конце — жирный абзац;
  • списки Word (numPr): маркированные — «- », нумерованные — «1. », вложенность — отступом; маркер текстом
    («•», «–») в начале абзаца — тоже пункт;
  • жирное внутри абзаца — **жирным**; таблицы — таблицами Markdown (первая строка — шапка);
  • блоки содержимого (sdt) раскрываются; удалённый при рецензировании текст и коды полей пропускаются.
"""

from __future__ import annotations

import io
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Optional

from agents.pdf_text import _BULLET_RE, _NUM_RE_MD

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _val(el: Optional[ET.Element], name: str = "val") -> Optional[str]:
    return None if el is None else el.get(W + name)


def _on(el: Optional[ET.Element]) -> bool:
    """Флажок вида <w:b/>, <w:b w:val="0"/>."""
    return el is not None and (_val(el) or "true").lower() not in ("0", "false", "off", "none")


class _Styles:
    def __init__(self, xml: Optional[bytes]):
        self.by_id: dict[str, ET.Element] = {}
        self.default_sz = 22.0                      # в полупунктах (11 pt)
        if not xml:
            return
        root = ET.fromstring(xml)
        sz = root.find(f"{W}docDefaults/{W}rPrDefault/{W}rPr/{W}sz")
        if _val(sz):
            self.default_sz = float(_val(sz))
        for st in root.iter(W + "style"):
            if _val(st, "styleId"):
                self.by_id[_val(st, "styleId")] = st

    def chain(self, sid: Optional[str]) -> list[ET.Element]:
        """Стиль и его родители (basedOn) — от самого стиля к базовому."""
        out: list[ET.Element] = []
        while sid and sid in self.by_id and len(out) < 10:
            st = self.by_id[sid]
            out.append(st)
            sid = _val(st.find(W + "basedOn"))
        return out

    def find(self, sid: Optional[str], path: str) -> Optional[ET.Element]:
        for st in self.chain(sid):
            el = st.find(path)
            if el is not None:
                return el
        return None

    def list_level(self, sid: Optional[str]) -> Optional[int]:
        """«List Bullet 2» / «Маркированный список 2» — вложенность 1 (у таких стилей уровень задан стилем)."""
        for st in self.chain(sid):
            m = re.search(r"(?:list|список).*?(\d)$", (_val(st.find(W + "name")) or "").strip().lower())
            if m:
                return int(m.group(1)) - 1
        return None

    def heading(self, sid: Optional[str]) -> int:
        for st in self.chain(sid):
            name = (_val(st.find(W + "name")) or "").strip().lower()
            m = re.match(r"(?:heading|заголовок)\s*(\d)$", name)
            if m:
                return min(int(m.group(1)), 6)
            if name in ("title", "название"):
                return 1
        return 0


class _Numbering:
    """numId + уровень → формат номера (bullet, decimal…)."""

    def __init__(self, xml: Optional[bytes]):
        self.fmt: dict[tuple[str, int], str] = {}
        if not xml:
            return
        root = ET.fromstring(xml)
        abstract = {}
        for a in root.iter(W + "abstractNum"):
            abstract[_val(a, "abstractNumId")] = {int(_val(l, "ilvl") or 0): (_val(l.find(W + "numFmt")) or "bullet") for l in a.iter(W + "lvl")}
        for n in root.iter(W + "num"):
            levels = abstract.get(_val(n.find(W + "abstractNumId")), {})
            for lvl, f in levels.items():
                self.fmt[(_val(n, "numId") or "", lvl)] = f

    def ordered(self, num_id: str, lvl: int) -> bool:
        return self.fmt.get((num_id, lvl), "bullet") not in ("bullet", "none")


def _cell_text(el: ET.Element) -> str:
    parts = []
    for p in el.iter(W + "p"):
        t = "".join(x.text or "" for x in p.iter() if x.tag == W + "t")
        if t.strip():
            parts.append(t.strip())
    return " ".join(parts).replace("|", "\\|")


def _table(tbl: ET.Element) -> str:
    rows = [[_cell_text(tc) for tc in tr.findall(W + "tc")] for tr in tbl.findall(W + "tr")]
    rows = [r for r in rows if any(c for c in r)]
    if not rows:
        return ""
    n = max(len(r) for r in rows)
    rows = [r + [""] * (n - len(r)) for r in rows]
    line = lambda r: "| " + " | ".join(c or " " for c in r) + " |"
    return "\n".join([line(rows[0]), "|" + "---|" * n] + [line(r) for r in rows[1:]])


class _Para:
    __slots__ = ("text", "plain", "size", "bold", "style_level", "num", "lvl")

    def __init__(self, text, plain, size, bold, style_level, num, lvl):
        self.text, self.plain, self.size, self.bold = text, plain, size, bold
        self.style_level, self.num, self.lvl = style_level, num, lvl


def _paragraph(p: ET.Element, styles: _Styles) -> Optional[_Para]:
    ppr = p.find(W + "pPr")
    sid = _val(ppr.find(W + "pStyle")) if ppr is not None else None
    level = styles.heading(sid)
    outline = ppr.find(W + "outlineLvl") if ppr is not None else None
    outline = outline if outline is not None else styles.find(sid, f"{W}pPr/{W}outlineLvl")
    if not level and _val(outline) and _val(outline).isdigit() and int(_val(outline)) < 6:
        level = int(_val(outline)) + 1
    num_pr = ppr.find(W + "numPr") if ppr is not None else None
    num_pr = num_pr if num_pr is not None else styles.find(sid, f"{W}pPr/{W}numPr")
    num = _val(num_pr.find(W + "numId")) if num_pr is not None else None
    lvl = int(_val(num_pr.find(W + "ilvl")) or 0) if num_pr is not None and num_pr.find(W + "ilvl") is not None else 0
    if num == "0":                                     # numId 0 — нумерация снята
        num = None
    if num and not lvl and styles.list_level(sid):
        lvl = styles.list_level(sid) or 0

    style_bold = _on(styles.find(sid, f"{W}rPr/{W}b"))
    style_sz = _val(styles.find(sid, f"{W}rPr/{W}sz"))
    segs: list[tuple[str, bool, float]] = []
    for r in p.iter(W + "r"):
        rpr = r.find(W + "rPr")
        b = rpr.find(W + "b") if rpr is not None else None
        bold = _on(b) if b is not None else style_bold
        sz = _val(rpr.find(W + "sz")) if rpr is not None else None
        size = float(sz or style_sz or styles.default_sz)
        txt = []
        for ch in r:
            if ch.tag == W + "t":
                txt.append(ch.text or "")
            elif ch.tag == W + "tab":
                txt.append("\t")
            elif ch.tag in (W + "br", W + "cr"):
                txt.append(" ")
        if txt:
            segs.append(("".join(txt), bold, size))
    raw = "".join(t for t, *_ in segs)
    plain = re.sub(r"\s+", " ", raw).strip()
    if not plain:
        return None
    # Номер, отбитый табуляцией («1⇥Открыть» — так пишут конвертеры без списков Word), — пункт нумерованного списка.
    tab_num = re.match(r"^\s*(\d{1,2})[.)]?\t\s*", raw)
    weight: dict[float, int] = {}
    letters = bold_n = 0
    for t, b, sz in segs:
        n = sum(1 for c in t if not c.isspace())
        weight[sz] = weight.get(sz, 0) + n
        letters += n
        bold_n += n if b else 0
    whole_bold = bool(letters) and bold_n == letters
    # Жирное внутри абзаца — **…** (пробелы по краям — снаружи звёздочек, иначе разметка не сработает).
    out, buf, buf_b = [], "", None
    for t, b, _ in segs + [("", None, 0.0)]:
        if b != buf_b and buf:
            if buf_b and not whole_bold and buf.strip():
                lead, core, tail = re.match(r"^(\s*)(.*?)(\s*)$", buf, re.S).groups()
                out.append(f"{lead}**{core}**{tail}")
            else:
                out.append(buf)
            buf = ""
        buf_b = b
        buf += t
    text = re.sub(r"\s+", " ", "".join(out)).strip()
    if tab_num and not num:
        text = tab_num.group(1) + ". " + re.sub(r"^\s*\d{1,2}[.)]?\s*", "", text)
        plain = text
    return _Para(text, plain, max(weight, key=weight.get), whole_bold, level, num, lvl)


def _blocks(parent: ET.Element, styles: _Styles, out: list) -> None:
    for el in parent:
        if el.tag == W + "p":
            p = _paragraph(el, styles)
            if p:
                out.append(p)
        elif el.tag == W + "tbl":
            t = _table(el)
            if t:
                out.append(t)
        elif el.tag == W + "sdt":
            content = el.find(W + "sdtContent")
            if content is not None:
                _blocks(content, styles, out)


def docx_markdown(data: bytes) -> str:
    """DOCX → Markdown. Не DOCX (старый .doc, битый архив) — ValueError."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        doc_xml = z.read("word/document.xml")
    except (zipfile.BadZipFile, KeyError):
        raise ValueError("это не DOCX")
    read = lambda name: z.read(name) if name in z.namelist() else None
    styles, numbering = _Styles(read("word/styles.xml")), _Numbering(read("word/numbering.xml"))
    body = ET.fromstring(doc_xml).find(W + "body")
    items: list = []
    if body is not None:
        _blocks(body, styles, items)
    paras = [x for x in items if isinstance(x, _Para)]
    if not items:
        return ""

    # Заголовки по кеглю — только если в документе нет заголовков стилями (оформлен вручную).
    styled = any(p.style_level for p in paras)
    weight: dict[float, int] = {}
    for p in paras:
        if not p.style_level:
            weight[p.size] = weight.get(p.size, 0) + len(p.plain)
    body_sz = max(weight, key=weight.get) if weight else 0.0
    big = [] if styled else sorted({p.size for p in paras if body_sz and p.size >= body_sz * 1.12 and len(p.plain) <= 150 and not p.num}, reverse=True)[:3]
    by_size = {sz: i + 1 for i, sz in enumerate(big)}
    bold_level = min((max((p.style_level for p in paras), default=0) if styled else len(big)) + 1, 4)

    blocks: list[str] = []
    counters: dict[tuple[str, int], int] = {}
    for it in items:
        if isinstance(it, str):
            blocks.append(it)
            continue
        p = it
        level = p.style_level or by_size.get(p.size, 0)
        if level:
            blocks.append("#" * level + " " + p.plain)
            continue
        if p.num:
            if numbering.ordered(p.num, p.lvl):
                k = (p.num, p.lvl)
                counters[k] = counters.get(k, 0) + 1
                for (n, l) in list(counters):              # более глубокие уровни после пункта начинаются заново
                    if n == p.num and l > p.lvl:
                        del counters[(n, l)]
                blocks.append("  " * p.lvl + f"{counters[k]}. " + p.text)
            else:
                blocks.append("  " * p.lvl + "- " + p.text)
            continue
        bullet, num = _BULLET_RE.match(p.text), _NUM_RE_MD.match(p.text)
        if bullet:
            blocks.append("- " + p.text[bullet.end():])
        elif num:
            blocks.append(num.group(1) + ". " + p.text[num.end():])
        elif p.bold and len(p.plain) <= 100 and not re.search(r"[.;,]$", p.plain) and re.search(r"[^\W\d_]", p.plain):
            blocks.append("**" + p.plain + "**" if p.plain.endswith(":") else "#" * bold_level + " " + p.plain)
        else:
            blocks.append(p.text)

    is_item = lambda b: bool(re.match(r"\s*(?:- |\d+\. )", b))
    out: list[str] = []
    for b in blocks:
        if out and not (is_item(b) and is_item(out[-1])):
            out.append("")
        out.append(b)
    return "\n".join(out).strip()
