"""Общее для моков: ответ, детерминированный случай, люди, даты."""
from __future__ import annotations

import hashlib
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

MSK = timezone(timedelta(hours=3))


@dataclass
class Reply:
    """Ответ заглушки: тело — dict/list (JSON), str (текст) или bytes."""
    status: int = 200
    body: Any = None
    headers: dict[str, str] = field(default_factory=dict)
    content_type: str = ""


def ok(body: Any = None, **headers: str) -> Reply:
    return Reply(200, {} if body is None else body, dict(headers))


def not_found(what: str) -> Reply:
    return Reply(404, {"message": f"Мок: {what} не найдено", "errorMessages": [f"Мок: {what} не найдено"]})


def rng(*parts: Any) -> random.Random:
    """Один и тот же ключ — одни и те же данные при каждом запросе и перезапуске."""
    seed = hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()
    return random.Random(int(seed[:12], 16))


def now() -> datetime:
    return datetime.now(MSK)


def jira_dt(dt: datetime) -> str:
    """Дата-время в формате Jira: 2026-11-05T10:12:00.000+0300."""
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000%z")


def ms(dt: datetime) -> int:
    return int(dt.timestamp() * 1000)


PEOPLE = [
    {"name": "ivanov_aa", "displayName": "Иванов Алексей Андреевич", "email": "ivanov_aa@sber.ru"},
    {"name": "petrova_ms", "displayName": "Петрова Мария Сергеевна", "email": "petrova_ms@sber.ru"},
    {"name": "smirnov_dv", "displayName": "Смирнов Дмитрий Викторович", "email": "smirnov_dv@sber.ru"},
    {"name": "kuznetsova_ei", "displayName": "Кузнецова Елена Игоревна", "email": "kuznetsova_ei@sber.ru"},
    {"name": "volkov_pn", "displayName": "Волков Павел Николаевич", "email": "volkov_pn@sber.ru"},
    {"name": "sokolova_ao", "displayName": "Соколова Анна Олеговна", "email": "sokolova_ao@sber.ru"},
    {"name": "morozov_ik", "displayName": "Морозов Илья Константинович", "email": "morozov_ik@sber.ru"},
    {"name": "lebedeva_tv", "displayName": "Лебедева Татьяна Васильевна", "email": "lebedeva_tv@sber.ru"},
]

ME = {"name": "mock_user", "key": "mock_user", "displayName": "Тестовый Пользователь", "emailAddress": "mock_user@sber.ru",
      "active": True}


def jira_user(p: dict) -> dict:
    return {"name": p["name"], "key": p["name"], "displayName": p["displayName"], "emailAddress": p["email"],
            "active": True, "avatarUrls": {}}
