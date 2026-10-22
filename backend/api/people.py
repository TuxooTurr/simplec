"""
Справочник людей Jira tool (db/people_store.py → data/people.json).

Человек: ФИО, метка (до 3 символов: QA, BE, BA…), цвет и направления, в которых он работает.
Из справочника берутся тестировщики (направление «testing») и люди направлений; по нему считается нагрузка.
У человека может быть имя в Jira (логин jiraName + отображаемое jiraDisplay): его Jira tool пишет в поле Jira
направления, когда человека назначают в списке. В списках оно не показывается — только в справочнике.

Эндпоинты:
  GET /api/people              — справочник и поля Jira направлений
  PUT /api/people              — сохранить людей целиком (поля Jira направлений не трогает)
  PUT /api/people/jira-fields  — направление → id поля Jira («Тестировщик», «Аналитик»…)
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from db import people_store

router = APIRouter()

# Те же id, что во фронте (DIRECTIONS в lib/jiraTool.ts): testing — команда тестирования, остальные — поля направлений.
DIRECTIONS = ("testing", "analytics", "design", "back", "front", "mobile", "dev", "sup")


class Person(BaseModel):
    id: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=200)
    role: str = Field("", max_length=3)            # метка у ФИО (как у участников раньше)
    color: str = Field("#64748b", max_length=16)
    directions: list[str] = Field(default_factory=list)
    jiraName: str = Field("", max_length=200)      # логин в Jira — его пишем в поле пользователя
    jiraDisplay: str = Field("", max_length=200)   # как Jira показывает человека (для справочника)

    @field_validator("jiraName", "jiraDisplay")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Пустое имя")
        return v

    @field_validator("directions")
    @classmethod
    def _directions(cls, v: list[str]) -> list[str]:
        bad = [d for d in v if d not in DIRECTIONS]
        if bad:
            raise ValueError(f"Неизвестные направления: {', '.join(bad)}")
        return list(dict.fromkeys(v))


class PeopleBody(BaseModel):
    people: list[Person] = Field(default_factory=list)


class JiraFieldsBody(BaseModel):
    fields: dict[str, str] = Field(default_factory=dict)

    @field_validator("fields")
    @classmethod
    def _fields(cls, v: dict[str, str]) -> dict[str, str]:
        bad = [d for d in v if d not in DIRECTIONS]
        if bad:
            raise ValueError(f"Неизвестные направления: {', '.join(bad)}")
        if any(len(f) > 100 for f in v.values()):
            raise ValueError("Слишком длинный id поля Jira")
        return {d: f.strip() for d, f in v.items() if f.strip()}


@router.get("/api/people")
def get_people() -> dict:
    return people_store.load()


@router.put("/api/people")
def put_people(body: PeopleBody) -> dict:
    ids = [p.id for p in body.people]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, "В справочнике повторяются id людей")
    return people_store.save([p.model_dump() for p in body.people], datetime.now(timezone.utc).isoformat())


@router.put("/api/people/jira-fields")
def put_jira_fields(body: JiraFieldsBody) -> dict:
    return people_store.save_jira_fields(body.fields, datetime.now(timezone.utc).isoformat())
