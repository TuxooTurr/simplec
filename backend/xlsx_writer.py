"""
Простой генератор .xlsx на стандартной библиотеке (zipfile + XML) — без openpyxl.

Зачем свой: в проекте нет библиотеки для Excel, а ставить новую зависимость на корпоративную машину — лишний
риск при переустановке. Нужна одна таблица: шапка с цветом и фильтром, закреплённая первая строка, ширины колонок,
ссылки, заливка отдельных ячеек. Строки пишутся inline (t="inlineStr") — без общей таблицы строк.
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional
from xml.sax.saxutils import escape

_BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
_HEX = re.compile(r"^[0-9A-Fa-f]{6}$")


@dataclass
class Cell:
    v: str = ""
    link: str = ""            # гиперссылка (http/https)
    fill: str = ""            # заливка RRGGBB


@dataclass
class Column:
    title: str
    width: float = 14


@dataclass
class Sheet:
    name: str
    columns: list[Column]
    rows: list[list[Cell]] = field(default_factory=list)
    header_fill: str = "1F3864"     # тёмно-синяя шапка, как в бэклоге платформы


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


def _styles(fills: list[str], header_fill: str) -> tuple[str, dict[str, int]]:
    """styles.xml и номер стиля ячейки по заливке. Стили: 0 обычный, 1 шапка, 2 тело, 3 ссылка, 4.. тело с заливкой."""
    fill_idx = {f: 3 + i for i, f in enumerate(fills)}          # 0 none, 1 gray125 (обязательные), 2 шапка
    style_of_fill = {f: 4 + i for i, f in enumerate(fills)}
    fills_xml = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
                 f'<fill><patternFill patternType="solid"><fgColor rgb="FF{header_fill}"/><bgColor indexed="64"/></patternFill></fill>']
    fills_xml += [f'<fill><patternFill patternType="solid"><fgColor rgb="FF{f}"/><bgColor indexed="64"/></patternFill></fill>' for f in fills]
    body_align = '<alignment vertical="center" wrapText="1"/>'
    xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
           '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">'
           '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
           f'<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">{body_align}</xf>',
           f'<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1">{body_align}</xf>']
    xfs += [f'<xf numFmtId="0" fontId="0" fillId="{fill_idx[f]}" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1">'
            f'{body_align}</xf>' for f in fills]
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="3">'
        '<font><sz val="10"/><name val="Arial"/><family val="2"/></font>'
        '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>'
        '<font><u/><sz val="10"/><color rgb="FF0563C1"/><name val="Arial"/><family val="2"/></font>'
        '</fonts>'
        f'<fills count="{len(fills_xml)}">{"".join(fills_xml)}</fills>'
        '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>'
        '<border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right>'
        '<top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        f'<cellXfs count="{len(xfs)}">{"".join(xfs)}</cellXfs>'
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        '</styleSheet>'
    )
    return styles, style_of_fill


def _sheet_xml(sheet: Sheet, style_of_fill: dict[str, int], selected: bool) -> tuple[str, list[tuple[str, str]], str]:
    """XML листа, его ссылки [(ячейка, url)] и диапазон фильтра."""
    ncol = len(sheet.columns)
    last = _col(max(ncol, 1) - 1)
    nrows = len(sheet.rows) + 1
    links: list[tuple[str, str]] = []
    rows_xml = ['<row r="1" ht="30" customHeight="1">' + "".join(
        f'<c r="{_col(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">{_text(c.title)}</t></is></c>'
        for i, c in enumerate(sheet.columns)) + "</row>"]
    for r, row in enumerate(sheet.rows, start=2):
        cells = []
        for i, c in enumerate(row[:ncol]):
            ref = f"{_col(i)}{r}"
            link = c.link if c.link.startswith(("http://", "https://")) else ""
            s_ = 3 if link else style_of_fill.get(c.fill.upper(), 2) if c.fill else 2
            if link:
                links.append((ref, link))
            if c.v == "":
                cells.append(f'<c r="{ref}" s="{s_}"/>')
            else:
                cells.append(f'<c r="{ref}" s="{s_}" t="inlineStr"><is><t xml:space="preserve">{_text(c.v)}</t></is></c>')
        rows_xml.append(f'<row r="{r}">{"".join(cells)}</row>')
    cols = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{max(3.0, float(c.width)):.1f}" customWidth="1"/>'
                   for i, c in enumerate(sheet.columns))
    hyperlinks = ("<hyperlinks>" + "".join(f'<hyperlink ref="{ref}" r:id="rId{n + 1}"/>' for n, (ref, _) in enumerate(links))
                  + "</hyperlinks>") if links else ""
    area = f"A1:{last}{nrows}"
    tab = ' tabSelected="1"' if selected else ""      # без «\\» внутри {…} f-строки: Python 3.10/3.11 так не умеют
    xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<dimension ref="{area}"/>'
        f'<sheetViews><sheetView{tab} workbookViewId="0">'
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        '<sheetFormatPr defaultRowHeight="15"/>'
        f'<cols>{cols}</cols>'
        f'<sheetData>{"".join(rows_xml)}</sheetData>'
        f'<autoFilter ref="{area}"/>'
        f'{hyperlinks}'
        '</worksheet>'
    )
    return xml, links, f"${_col(0)}$1:${last}${nrows}"


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
    fills = sorted({c.fill.upper() for sh in sheets for row in sh.rows for c in row if c.fill and _HEX.match(c.fill)})
    styles, style_of_fill = _styles(fills, sheets[0].header_fill)

    used: set[str] = set()
    names: list[str] = []
    for sh in sheets:                                   # имена листов уникальны (без учёта регистра)
        base = _sheet_name(sh.name)
        name, n = base, 2
        while name.lower() in used:
            name = f"{base[:28]} {n}"
            n += 1
        used.add(name.lower())
        names.append(name)

    files: dict[str, str] = {}
    defined = []
    for k, sh in enumerate(sheets):
        xml, links, area = _sheet_xml(sh, style_of_fill, k == 0)
        files[f"xl/worksheets/sheet{k + 1}.xml"] = xml
        if links:
            files[f"xl/worksheets/_rels/sheet{k + 1}.xml.rels"] = _rels(
                [(f"rId{n + 1}", _REL + "hyperlink", url) for n, (_, url) in enumerate(links)], external=True)
        defined.append(f'<definedName name="_xlnm._FilterDatabase" localSheetId="{k}" hidden="1">\'{_text(names[k])}\'!{area}</definedName>')

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


def sheet_from_payload(name: str, columns: list[dict], rows: list[list[dict]], header_fill: Optional[str] = None) -> Sheet:
    return Sheet(
        name=name,
        columns=[Column(str(c.get("title", "")), float(c.get("width") or 14)) for c in columns],
        rows=[[Cell(str(x.get("v", "") or ""), str(x.get("link", "") or ""), str(x.get("fill", "") or "")) for x in r] for r in rows],
        header_fill=header_fill if header_fill and _HEX.match(header_fill) else "1F3864",
    )
