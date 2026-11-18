"""Генератор .xlsx без openpyxl: корректный zip с XML, шапка, ссылки, заливки, фильтр, закреплённая строка."""

import io
import zipfile
from xml.dom import minidom
from xml.etree import ElementTree as ET

from backend.api import xlsx_export
from backend.xlsx_writer import Cell, Column, Sheet, build_xlsx


def _sheet():
    return Sheet("Бэклог: [тест]", [Column("Релиз", 10), Column("Jira", 16), Column("Название", 60), Column("Аналитика готова", 14)], [
        [Cell("30 окт."), Cell("SBER911-1", link="https://jira.example/browse/SBER911-1"), Cell("Кавычки \"<&>\" и\x01 мусор"), Cell("в работе", fill="FFE699")],
        [Cell(""), Cell("SBER911-2", link="javascript:alert(1)"), Cell("Вторая"), Cell("готова", fill="c6e0b4")],
    ])


def test_файл_собирается_и_xml_корректный():
    data = build_xlsx(_sheet())
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    assert {"[Content_Types].xml", "xl/workbook.xml", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/_rels/sheet1.xml.rels"} <= names
    for n in names:
        minidom.parseString(z.read(n))                                   # каждый XML разбирается
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    assert '<autoFilter ref="A1:D3"/>' in sheet and 'state="frozen"' in sheet
    assert sheet.count("<hyperlink ") == 1                               # javascript: не становится ссылкой
    assert "\x01" not in sheet and "&lt;&amp;&gt;" in sheet
    wb = z.read("xl/workbook.xml").decode()
    assert 'name="Бэклог   тест"' in wb                                  # []: в имени листа запрещены


def test_эндпоинт_отдаёт_xlsx():
    r = xlsx_export.export_xlsx(xlsx_export.XlsxBody(filename="Бэклог.xlsx", sheet="Бэклог", columns=[{"title": "Jira", "width": 16}],
                                                     rows=[[{"v": "SBER911-1", "link": "https://j/browse/SBER911-1"}]]))
    assert r.media_type.endswith("spreadsheetml.sheet") and r.body[:2] == b"PK"
    assert "filename*=UTF-8''%D0%91" in r.headers["content-disposition"]


def test_выгрузка_видимой_таблицы_с_двухуровневой_шапкой_и_числовыми_часами():
    result = xlsx_export.export_xlsx(xlsx_export.XlsxBody(sheets=[xlsx_export.XlsxSheet(
        name="Представление Jira", frozenCols=1, sectionRows=[0],
        columns=[{"title": "Ключ"}, {"title": "ФИО", "group": "Analytics"},
                 {"title": "Часы", "group": "Analytics"}, {"title": "Дефекты"}, {"title": "Метки"}],
        rows=[[{"v": "Команда", "bold": True}], [
            {"v": "SBER911-1", "link": "https://jira.example/browse/SBER911-1", "fill": "020304", "ink": "FAFBFC"},
            {"v": "Ирина Иванова", "fill": "FCD34D", "ink": "451A03"},
            {"v": 90 / 1440, "format": "duration", "fill": "FCD34D", "ink": "451A03"},
            {"v": 0},
            {"v": "API, UI", "runs": [{"text": "API", "ink": "991B1B"}, {"text": ", UI", "ink": "1E40AF"}]},
        ]],
    )]))
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(result.body)) as z:
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        styles = ET.fromstring(z.read("xl/styles.xml"))
    assert [el.get("ref") for el in sheet.findall("s:mergeCells/s:mergeCell", ns)] == ["B1:C1", "A3:E3"]
    assert sheet.find("s:autoFilter", ns).get("ref") == "A2:E4"
    assert sheet.find("s:sheetViews/s:sheetView/s:pane", ns).get("topLeftCell") == "B3"
    cells = {el.get("r"): el for el in sheet.findall("s:sheetData/s:row/s:c", ns)}
    assert [cells[ref].find("s:is/s:t", ns).text for ref in ["A2", "B2", "C2"]] == ["Ключ", "ФИО", "Часы"]
    assert cells["C4"].find("s:v", ns).text == "0.0625" and cells["D4"].find("s:v", ns).text == "0"
    xfs = styles.findall("s:cellXfs/s:xf", ns)
    a, b, c = [xfs[int(cells[ref].get("s"))] for ref in ["A4", "B4", "C4"]]
    fmt = styles.find(f"s:numFmts/s:numFmt[@numFmtId='{c.get('numFmtId')}']", ns)
    assert fmt.get("formatCode").startswith("[h]") and b.get("fillId") == c.get("fillId")
    assert int(a.get("fillId")) > 1 and sheet.find("s:hyperlinks/s:hyperlink", ns).get("ref") == "A4"
    assert [el.get("rgb") for el in cells["E4"].findall("s:is/s:r/s:rPr/s:color", ns)] == ["FF991B1B", "FF1E40AF"]


def test_несколько_листов():
    a, b = _sheet(), _sheet()
    a.name, b.name = "Фамилии", "Нагрузка"
    z = zipfile.ZipFile(io.BytesIO(build_xlsx([a, b])))
    for n in z.namelist():
        minidom.parseString(z.read(n))
    wb = z.read("xl/workbook.xml").decode()
    assert 'name="Фамилии" sheetId="1"' in wb and 'name="Нагрузка" sheetId="2"' in wb and wb.count("_FilterDatabase") == 2
    assert "xl/worksheets/sheet2.xml" in z.namelist() and "xl/worksheets/_rels/sheet2.xml.rels" in z.namelist()
    same = build_xlsx([_sheet(), _sheet()])                       # одинаковые имена листов — второй переименован
    assert 'name="Бэклог   тест 2"' in zipfile.ZipFile(io.BytesIO(same)).read("xl/workbook.xml").decode()
    r = xlsx_export.export_xlsx(xlsx_export.XlsxBody(filename="x", sheets=[
        xlsx_export.XlsxSheet(name="Фамилии", columns=[{"title": "A"}], rows=[[{"v": "1"}]]),
        xlsx_export.XlsxSheet(name="Нагрузка", columns=[{"title": "A"}], rows=[[{"v": "2 ч"}]])]))
    assert r.body[:2] == b"PK"


def test_общие_ячейки_эпика_объединены_по_строкам_сторей():
    result = xlsx_export.export_xlsx(xlsx_export.XlsxBody(sheets=[xlsx_export.XlsxSheet(
        name="Story",
        columns=[{"title": "Ключ"}, {"title": "ФИО", "group": "Тестирование"}, {"title": "Часы", "group": "Тестирование"}],
        rows=[
            [{"v": "STORY-1"}, {"v": "Иван", "rowSpan": 3}, {"v": 0.25, "format": "duration", "rowSpan": 3}],
            [{"v": "STORY-2"}, {"v": ""}, {"v": ""}],
            [{"v": "STORY-3"}, {"v": ""}, {"v": ""}],
        ],
    )]))
    ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(io.BytesIO(result.body)) as z:
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    merged = [el.get("ref") for el in sheet.findall("s:mergeCells/s:mergeCell", ns)]
    assert merged == ["B1:C1", "B3:B5", "C3:C5"]
    assert sheet.find("s:sheetData/s:row/s:c[@r='C3']/s:v", ns).text == "0.25"
