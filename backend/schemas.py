"""
Pydantic схемы для FastAPI эндпоинтов.
"""
from __future__ import annotations
from typing import List, Optional, Any
from pydantic import BaseModel, Field


class GenerationStartRequest(BaseModel):
    requirement: str
    feature: str = "Feature"
    depth: str = "smoke"          # smoke|regression|full|atomary
    provider: str = "gigachat"


class Step(BaseModel):
    action: str
    test_data: str = "-"
    ui: str = "-"
    api: str = "-"
    db: str = "-"


class CaseData(BaseModel):
    name: str
    priority: str = "Normal"
    case_type: str = "positive"
    steps: List[dict] = Field(default_factory=list)


class ExportRequest(BaseModel):
    cases: List[CaseData]
    qa_doc: str = ""
    project: str = "SBER911"
    system: str = ""
    team: str = ""
    domain: str = ""
    folder: str = "Новая ТМ"
    use_llm: bool = False
    provider: str = "gigachat"


class EtalonAddRequest(BaseModel):
    req_text: str
    tc_text: str
    platform: str = ""
    feature: str = ""


class BugFormatRequest(BaseModel):
    platform: str
    feature: str
    description: str
    provider: str = "gigachat"


class BugFormatResponse(BaseModel):
    report: str


class ExportResponse(BaseModel):
    xml: str
    csv: str
    md: str
