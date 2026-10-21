"""Генератор .xlsx без openpyxl: корректный zip с XML, шапка, ссылки, заливки, фильтр, закреплённая строка."""

import io
import zipfile
from xml.dom import minidom

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
