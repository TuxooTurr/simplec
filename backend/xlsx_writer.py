"""
Простой генератор .xlsx на стандартной библиотеке (zipfile + XML) — без openpyxl.

Зачем свой: в проекте нет библиотеки для Excel, а ставить новую зависимость на корпоративную машину — лишний
риск при переустановке. Нужна одна таблица: шапка с цветом и фильтром, закреплённая первая строка, ширины колонок,
ссылки, заливка отдельных ячеек. Строки пишутся inline (t="inlineStr") — без общей таблицы строк.
"""

from __future__ import annotations

import io
import math
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional
from xml.sax.saxutils import escape

_BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_HEX = re.compile(r"^[0-9A-Fa-f]{6}$")


@dataclass
class Cell:
    v: str | int | float = ""
    link: str = ""            # гиперссылка (http/https)
    fill: str = ""            # заливка RRGGBB
    ink: str = ""             # цвет текста RRGGBB
    format: str = ""
    runs: list[tuple[str, str]] = field(default_factory=list)   # текст и цвет каждой метки в одной ячейке
    bold: bool = False
    row_span: int = 1
    sheet_id: str = ""


@dataclass
class Column:
    title: str
    width: float = 14
    group: str = ""


@dataclass
class Sheet:
    name: str
    columns: list[Column]
    rows: list[list[Cell]] = field(default_factory=list)
    header_fill: str = "1F3864"     # тёмно-синяя шапка, как в бэклоге платформы
    header_ink: str = "FFFFFF"
    frozen_cols: int = 0
    section_rows: set[int] = field(default_factory=set)
    id: str = ""


def _col(n: int) -> str:
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def _text(v: str) -> str:
    return escape(_BAD_XML.sub("", str(v)), {'"': "&quot;"})


def _sheet_name(name: str) -> str:
    """Имя листа Excel: до 31 символа, без []:*?/\\."""
    return re.sub(r"[\[\]:*?/\\]", " ", name).strip()[:31] or "Лист1"


_FORMATS = {
    "duration": (164, '[h]" ч "mm" мин"'),
    "date": (165, "dd.mm.yyyy"),
    "datetime": (166, "dd.mm.yyyy hh:mm"),
    "bug": (167, '"↗ "0'),
}
Style = tuple[str, str, str, bool, bool]


def _colour(value: str) -> str:
    return value.upper() if _HEX.fullmatch(value) else ""


def _link(cell: Cell) -> str:
    return cell.link if cell.link.startswith(("http://", "https://")) else ""


def _style(cell: Cell) -> Style:
    link = bool(_link(cell) or cell.sheet_id)
    return _colour(cell.fill), _colour(cell.ink) or ("0563C1" if link else ""), cell.format, link, cell.bold


def _header_style(sheet: Sheet) -> Style:
    return _colour(sheet.header_fill) or "1F3864", _colour(sheet.header_ink) or "FFFFFF", "header", False, True


def _styles(sheets: list[Sheet]) -> tuple[str, dict[Style, int]]:
    """Один стиль на сочетание заливки, шрифта и формата числа, общее для всех листов."""
    fill_idx = {"": 0}
    font_ids = {("", False, False): 0}
    fonts = ['<font><sz val="10"/><name val="Arial"/><family val="2"/></font>']
    fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>']
    xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>']

    def add_style(key: Style, header: bool = False) -> int:
        fill, ink, fmt, link, bold = key
        if fill not in fill_idx:
            fill_idx[fill] = len(fills)
            fills.append(f'<fill><patternFill patternType="solid"><fgColor rgb="FF{fill}"/><bgColor indexed="64"/></patternFill></fill>')
        font = (ink, link, bold)
        if font not in font_ids:
            font_ids[font] = len(fonts)
            colour = f'<color rgb="FF{ink}"/>' if ink else ""
            fonts.append(f'<font>{"<b/>" if bold else ""}{"<u/>" if link else ""}<sz val="10"/>{colour}<name val="Arial"/><family val="2"/></font>')
        num = _FORMATS.get(fmt, (0, ""))[0]
        horizontal = ' horizontal="center"' if header else ""
        xfs.append(f'<xf numFmtId="{num}" fontId="{font_ids[font]}" fillId="{fill_idx[fill]}" borderId="1" xfId="0" '
                   'applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1">'
                   f'<alignment{horizontal} vertical="center" wrapText="1"/></xf>')
        return len(xfs) - 1

    style_ids: dict[Style, int] = {}
    for sh in sheets:
        key = _header_style(sh)
        if key not in style_ids:
            style_ids[key] = add_style(key, header=True)
        for row in sh.rows:
            for cell in row:
                key = _style(cell)
                if key not in style_ids:
                    style_ids[key] = add_style(key)
    numfmts = "".join(f'<numFmt numFmtId="{n}" formatCode="{_text(fmt)}"/>' for n, fmt in _FORMATS.values())
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<numFmts count="{len(_FORMATS)}">{numfmts}</numFmts>'
        f'<fonts count="{len(fonts)}">{"".join(fonts)}</fonts>'
        f'<fills count="{len(fills)}">{"".join(fills)}</fills>'
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right>'
        '<top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        f'<cellXfs count="{len(xfs)}">{"".join(xfs)}</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>'
    )
    return styles, style_ids


def _sheet_xml(sheet: Sheet, style_ids: dict[Style, int], selected: bool, sheet_names: dict[str, str]) -> tuple[str, list[tuple[str, str]], str]:
    """XML листа, его ссылки [(ячейка, url)] и диапазон фильтра."""
    ncol = len(sheet.columns)
    last = _col(max(ncol, 1) - 1)
    grouped = any(c.group for c in sheet.columns)
    header_rows = 2 if grouped else 1
    nrows = len(sheet.rows) + header_rows
    links: list[tuple[str, str]] = []
    merges: list[str] = []
    local_links: list[tuple[str, str]] = []
    header_style = style_ids[_header_style(sheet)]

    def header_row(r: int, labels: list[str], height: int) -> str:
        return f'<row r="{r}" ht="{height}" customHeight="1">' + "".join(
            f'<c r="{_col(i)}{r}" s="{header_style}" t="inlineStr"><is><t xml:space="preserve">{_text(label)}</t></is></c>'
            for i, label in enumerate(labels)) + "</row>"

    rows_xml = []
    if grouped:
        groups = [""] * ncol
        i = 0
        while i < ncol:
            group = sheet.columns[i].group
            j = i + 1
            if group:
                groups[i] = group
                while j < ncol and sheet.columns[j].group == group:
                    j += 1
                if j > i + 1:
                    merges.append(f"{_col(i)}1:{_col(j - 1)}1")
            i = j
        rows_xml.append(header_row(1, groups, 21))
    rows_xml.append(header_row(header_rows, [c.title for c in sheet.columns], 27))
    for r, row in enumerate(sheet.rows, start=header_rows + 1):
        section = r - header_rows - 1 in sheet.section_rows and row and ncol > 1
        if section:
            merges.append(f"A{r}:{last}{r}")
        cells = []
        for i, c in enumerate([row[0]] * ncol if section else row[:ncol]):
            ref = f"{_col(i)}{r}"
            if not section and c.row_span > 1:
                end = min(r + c.row_span - 1, nrows)
                if end > r:
                    merges.append(f"{ref}:{_col(i)}{end}")
            val = "" if section and i else c.v
            link = _link(c) if not section else ""
            s_ = style_ids[_style(c)]
            if not section and c.sheet_id and c.sheet_id in sheet_names:
                target = sheet_names[c.sheet_id].replace("'", "''")
                local_links.append((ref, f"'{target}'!A1"))
            elif link:
                links.append((ref, link))
            if val == "":
                cells.append(f'<c r="{ref}" s="{s_}"/>')
            elif isinstance(val, (int, float)) and math.isfinite(val):
                cells.append(f'<c r="{ref}" s="{s_}"><v>{val}</v></c>')
            elif c.runs:
                runs = []
                for txt, ink in c.runs:
                    ink = _colour(ink)
                    props = f'<rPr><rFont val="Arial"/><color rgb="FF{ink}"/><sz val="10"/></rPr>' if ink else ""
                    runs.append(f'<r>{props}<t xml:space="preserve">{_text(txt)}</t></r>')
                cells.append(f'<c r="{ref}" s="{s_}" t="inlineStr"><is>{"".join(runs)}</is></c>')
            else:
                cells.append(f'<c r="{ref}" s="{s_}" t="inlineStr"><is><t xml:space="preserve">{_text(str(val))}</t></is></c>')
        rows_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{max(3.0, float(c.width)):.1f}" customWidth="1"/>'
                   for i, c in enumerate(sheet.columns))
    external = [f'<hyperlink ref="{ref}" r:id="rId{n + 1}"/>' for n, (ref, _) in enumerate(links)]
    internal = [f'<hyperlink ref="{ref}" location="{_text(target)}"/>' for ref, target in local_links]
    hyperlinks = "<hyperlinks>" + "".join(external + internal) + "</hyperlinks>" if external or internal else ""
    area = f"A1:{last}{nrows}"
    filter_area = f"A{header_rows}:{last}{nrows}"
    frozen = max(0, min(sheet.frozen_cols, ncol))
    split = f' xSplit="{frozen}"' if frozen else ""
    pane = "bottomRight" if frozen else "bottomLeft"
    merge_xml = (f'<mergeCells count="{len(merges)}">' + "".join(f'<mergeCell ref="{m}"/>' for m in merges) + '</mergeCells>') if merges else ""
    tab = ' tabSelected="1"' if selected else ""      # без «\\» внутри {…} f-строки: Python 3.10/3.11 так не умеют
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{area}"/>'
        f'<sheetViews><sheetView{tab} workbookViewId="0">'
        f'<pane{split} ySplit="{header_rows}" topLeftCell="{_col(frozen)}{header_rows + 1}" activePane="{pane}" state="frozen"/></sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        f'<cols>{cols}</cols>'
        f'<sheetData>{"".join(rows_xml)}</sheetData>'
        f'<autoFilter ref="{filter_area}"/>'
        f'{merge_xml}'
        f'{hyperlinks}'
        '</worksheet>'
    )
    return xml, links, f"$A${header_rows}:${last}${nrows}"


def _rels(items: list[tuple[str, str, str]], external: bool = False) -> str:
    mode = ' TargetMode="External"' if external else ""
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="{i}" Type="{t}" Target="{_text(target)}"{mode}/>'
                      for i, t, target in items)
            + '</Relationships>')


_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"


def build_xlsx(sheets: "Sheet | list[Sheet]") -> bytes:
    """Книга из одного или нескольких листов; стили общие на все листы."""
    sheets = [sheets] if isinstance(sheets, Sheet) else list(sheets)
    if not sheets:
        raise ValueError("Нет листов")
    styles, style_ids = _styles(sheets)

    used: set[str] = set()
    names: list[str] = []
    for sh in sheets:                                   # имена листов уникальны (без учёта регистра)
        base = _sheet_name(sh.name)
        name, n = base, 2
        while name.lower() in used:
            suffix = f" {n}"
            name = base[:31 - len(suffix)] + suffix
            n += 1
        used.add(name.lower())
        names.append(name)

    sheet_names = {s.id: name for s, name in zip(sheets, names) if s.id}
    files: dict[str, str] = {}
    defined = []
    for k, sh in enumerate(sheets):
        xml, links, area = _sheet_xml(sh, style_ids, k == 0, sheet_names)
        files[f"xl/worksheets/sheet{k + 1}.xml"] = xml
        if links:
            files[f"xl/worksheets/_rels/sheet{k + 1}.xml.rels"] = _rels(
                [(f"rId{n + 1}", _REL + "hyperlink", url) for n, (_, url) in enumerate(links)], external=True)
        name = _text(names[k].replace("'", "''"))
        defined.append(f'<definedName name="_xlnm._FilterDatabase" localSheetId="{k}" hidden="1">\'{name}\'!{area}</definedName>')

    files["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + "".join(f'<Override PartName="/xl/worksheets/sheet{k + 1}.xml" '
                  'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for k in range(len(sheets)))
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '</Types>')
    files["_rels/.rels"] = _rels([("rId1", _REL + "officeDocument", "xl/workbook.xml")])
    files["xl/workbook.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets>' + "".join(f'<sheet name="{_text(n)}" sheetId="{k + 1}" r:id="rId{k + 1}"/>' for k, n in enumerate(names)) + '</sheets>'
        f'<definedNames>{"".join(defined)}</definedNames>'
        '</workbook>')
    files["xl/_rels/workbook.xml.rels"] = _rels(
        [(f"rId{k + 1}", _REL + "worksheet", f"worksheets/sheet{k + 1}.xml") for k in range(len(sheets))]
        + [(f"rId{len(sheets) + 1}", _REL + "styles", "styles.xml")])
    files["xl/styles.xml"] = styles

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for path, xml in files.items():
            z.writestr(path, xml)
    return buf.getvalue()


def _payload_cell(raw: dict) -> Cell:
    value = raw.get("v")
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        value = "" if value is None else str(value)
    fmt = raw.get("format")
    runs = raw.get("runs")
    return Cell(
        v=value, link=str(raw.get("link") or ""), fill=str(raw.get("fill") or ""), ink=str(raw.get("ink") or ""),
        format=fmt if isinstance(fmt, str) and fmt in _FORMATS else "",
        runs=[(str(r.get("text") or ""), str(r.get("ink") or "")) for r in runs if isinstance(r, dict)] if isinstance(runs, list) else [],
        bold=raw.get("bold") is True,
        sheet_id=str(raw.get("sheetId") or ""),
        row_span=max(1, min(20000, raw["rowSpan"])) if type(raw.get("rowSpan")) is int else 1,
    )


def sheet_from_payload(name: str, columns: list[dict], rows: list[list[dict]], header_fill: Optional[str] = None,
                       header_ink: str = "FFFFFF", frozen_cols: int = 0, section_rows: Optional[list[int]] = None, sheet_id: str = "") -> Sheet:
    return Sheet(
        name=name,
        id=sheet_id,
        columns=[Column(str(c.get("title", "")), float(c.get("width") or 14), str(c.get("group") or "")) for c in columns],
        rows=[[_payload_cell(x) for x in r] for r in rows],
        header_fill=header_fill if header_fill and _HEX.match(header_fill) else "1F3864",
        header_ink=header_ink,
        frozen_cols=frozen_cols,
        section_rows=set(section_rows or []),
    )
