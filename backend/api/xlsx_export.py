"""
Выгрузка таблицы в Excel (.xlsx): фронт присылает колонки и строки, бэкенд собирает файл (backend/xlsx_writer.py).

Эндпоинт:
  POST /api/export/xlsx  {filename, sheets: [{name, columns: [{title, width}], rows: [[{v, link?, fill?}]]}]} → .xlsx
                         (один лист можно и без sheets: {filename, sheet, columns, rows})
"""

from __future__ import annotations

import re
from urllib.parse import quote

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.xlsx_writer import build_xlsx, sheet_from_payload

router = APIRouter()

XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class XlsxSheet(BaseModel):
    name: str = "Лист1"
    columns: list[dict] = Field(..., min_length=1, max_length=100)
    rows: list[list[dict]] = Field(default_factory=list, max_length=20000)


class XlsxBody(BaseModel):
    filename: str = "SimpleTest.xlsx"
    sheets: list[XlsxSheet] = Field(default_factory=list, max_length=20)
    # один лист — без sheets
    sheet: str = "Лист1"
    columns: list[dict] = Field(default_factory=list, max_length=100)
    rows: list[list[dict]] = Field(default_factory=list, max_length=20000)


@router.post("/api/export/xlsx")
def export_xlsx(body: XlsxBody) -> Response:
    sheets = body.sheets or ([XlsxSheet(name=body.sheet, columns=body.columns, rows=body.rows)] if body.columns else [])
    if not sheets:
        raise HTTPException(422, "Нет колонок")
    data = build_xlsx([sheet_from_payload(s.name, s.columns, s.rows) for s in sheets])
    name = re.sub(r'[\\/:*?"<>|]+', "_", body.filename).strip() or "SimpleTest.xlsx"
    if not name.lower().endswith(".xlsx"):
        name += ".xlsx"
    return Response(content=data, media_type=XLSX_TYPE,
                    headers={"Content-Disposition": f"attachment; filename=\"export.xlsx\"; filename*=UTF-8''{quote(name)}"})
