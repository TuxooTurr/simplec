"""
График стендов — кто, когда и какие микросервисы ставит на Major-Check и Major-GO.

Устройство (решения Стефана):
  • у каждого стенда своя страница Confluence; оригинал графика — свойство страницы (content property `simpletest-stand`,
    JSON с версией: одновременная запись двух SimpleTest не затирает друг друга — вторая получит 409 и повторит);
  • окно планирования — даты, которые выбирают сами (к спринтам не привязано), плюс отметки дат релизов;
    посмотреть можно и другой период — например, последние 3 месяца (GET ?start=&end=, до 200 дней);
  • строка графика — команда; бронь — микросервис (с 22.10.2026 вместо КЭ), день или период «с — по» (одна запись,
    стоит в каждый рабочий день) и необязательное время установки «с — до» (каждый день; без времени — весь день);
  • конфликт — один и тот же микросервис у двух команд в один день и в пересекающееся время: бронь не блокируется,
    а красится; общего лимита на стенд по умолчанию нет — его можно включить;
  • у брони — фича (номер и название): на графике при наведении, в Confluence — отдельным столбцом;
  • заявки коллеги оставляют комментариями к странице по шаблону («Сервис / Дата / Время / Команда / Фичи / Задача»);
    «Забрать заявки» разбирает новые комментарии, проверяет правила — прошла: бронь, нет или не разобралась:
    «На рассмотрении»; на комментарий уходит ответ с итогом (и предупреждением о конфликте, если он есть).

Локально (metrics_settings, ключ stands_config) хранится привязка стенд → страница: она у каждого SimpleTest своя.
Справочник микросервисов для выпадающего списка — файл на сервере (db/ms_store.py → data/ms_catalog.json), один на оба
стенда. Справочник КЭ (db/ke_store.py → data/ke_catalog.json, 83 КЭ платформы) остаётся для переиспользования.

Эндпоинты:
  GET  /api/stands/config                 — привязка страниц
  PUT  /api/stands/config                 — сохранить привязку (ссылка или id страницы)
  POST /api/stands/{stand}/create-page    — создать страницу стенда в пространстве из настроек Confluence
  GET  /api/stands/{stand}[?start&end]    — график: дни окна (или периода), брони с конфликтами, заморозки, релизы
  PUT  /api/stands/{stand}/settings       — окно планирования, релизы, команды, лимит (0 — без лимита)
  POST /api/stands/{stand}/bookings       — бронь
  POST /api/stands/{stand}/bookings/bulk  — пачка броней одной записью (форма: фичи × микросервисы, день или период)
  DELETE /api/stands/{stand}/bookings/{id}
  POST /api/stands/{stand}/freezes        — заморозка
  DELETE /api/stands/{stand}/freezes/{id}
  POST /api/stands/{stand}/pull           — забрать заявки из комментариев
  POST /api/stands/{stand}/pending/{cid}  — решить заявку «на рассмотрении»: принять (с правкой) или отклонить
  GET/POST/PUT /api/ms-catalog            — справочник микросервисов: прочитать / создать / сохранить целиком
  GET/POST/PUT /api/ke-catalog            — справочник КЭ (сейчас графиком не используется)
"""

from __future__ import annotations

import copy
import html
import json
import re
import time
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Callable, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.api.confluence import _load_cfg, _request, page_ref
from backend.api.jira_defects import _get, _set
from db import ke_store, ms_store
from db.postgres import get_db

router = APIRouter()

STANDS = ("Major-Check", "Major-GO")
PROPERTY = "simpletest-stand"
_K_CONFIG = "stands_config"
DEFAULT_TEAMS = ["Базовые сервисы", "Агенты", "B2C", "SC"]
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def _stand(stand: str) -> str:
    hit = next((s for s in STANDS if s.lower() == stand.strip().lower()), None)
    if not hit:
        raise HTTPException(404, f"Неизвестный стенд: {stand}. Есть: {', '.join(STANDS)}")
    return hit


def today() -> date:
    return date.today()


# ── Привязка страниц (локально) ──────────────────────────────────────────────

def _config(db: Session) -> dict:
    try:
        data = json.loads(_get(db, _K_CONFIG, "") or "{}")
    except ValueError:
        data = {}
    pages = data.get("pages") if isinstance(data.get("pages"), dict) else {}
    return {"pages": {s: str(pages.get(s) or "") for s in STANDS}}


class ConfigBody(BaseModel):
    pages: dict[str, str] = Field(default_factory=dict)   # стенд → ссылка или id страницы


@router.get("/api/stands/config")
def get_config(db: Session = Depends(get_db)) -> dict:
    cfg = _load_cfg(db)
    pages = _config(db)["pages"]
    return {"stands": list(STANDS), "pages": pages,
            "urls": {s: f"{cfg['base_url']}/pages/viewpage.action?pageId={pid}" if pid else "" for s, pid in pages.items()}}


@router.put("/api/stands/config")
def put_config(body: ConfigBody, db: Session = Depends(get_db)) -> dict:
    pages = _config(db)["pages"]
    for stand, ref in body.pages.items():
        stand = _stand(stand)
        if not ref.strip():
            pages[stand] = ""
            continue
        kind, val = page_ref(ref)
        if kind != "id":
            raise HTTPException(422, f"{stand}: нужна ссылка на страницу или её id (…pageId=123456)")
        pages[stand] = val
    _set(db, _K_CONFIG, json.dumps({"pages": pages}, ensure_ascii=False), "График стендов: страницы Confluence")
    db.commit()
    return get_config(db)


def _page_id(db: Session, stand: str) -> str:
    pid = _config(db)["pages"][stand]
    if not pid:
        raise HTTPException(409, f"Для стенда {stand} не выбрана страница Confluence — привяжите или создайте её")
    return pid


# ── Данные стенда в свойстве страницы ────────────────────────────────────────

def default_data(stand: str) -> dict:
    now = today()
    return {"format": "simpletest.stand-schedule", "version": 2, "stand": stand, "limit": 0,
            "window": {"from": now.isoformat(), "to": (now + timedelta(days=27)).isoformat()}, "releases": [],
            "teams": list(DEFAULT_TEAMS), "bookings": [], "freezes": [], "pending": [], "processed": []}


def _norm_data(stand: str, raw: Any) -> dict:
    d = default_data(stand)
    if isinstance(raw, dict):
        for k in d:
            if k in raw and raw[k] is not None:
                d[k] = raw[k]
        if "window" not in raw and raw.get("sprintStart"):   # первая версия: окно — два спринта от начала спринта
            start = date.fromisoformat(raw["sprintStart"])
            d["window"] = {"from": start.isoformat(), "to": (start + timedelta(days=2 * int(raw.get("sprintDays") or 14) - 1)).isoformat()}
            if raw.get("limit") == 3:      # 3 стояло по умолчанию, а не выбрано — общего лимита больше нет
                d["limit"] = 0
    for b in d["bookings"]:
        b.setdefault("features", "")
    d["stand"] = stand
    return d


def _read(cfg: dict, pid: str, stand: str) -> tuple[dict, int]:
    """(данные, версия свойства); свойства ещё нет — данные по умолчанию и версия 0."""
    try:
        prop = _request(cfg, "GET", f"/rest/api/content/{pid}/property/{PROPERTY}")
    except HTTPException as e:
        if e.status_code == 404:
            return default_data(stand), 0
        raise
    return _norm_data(stand, prop.get("value")), int(((prop.get("version") or {}).get("number")) or 0)


def _write(cfg: dict, pid: str, data: dict, version: int) -> None:
    if version == 0:
        _request(cfg, "POST", f"/rest/api/content/{pid}/property", json_body={"key": PROPERTY, "value": data})
    else:
        _request(cfg, "PUT", f"/rest/api/content/{pid}/property/{PROPERTY}",
                 json_body={"key": PROPERTY, "value": data, "version": {"number": version + 1}})


def mutate(cfg: dict, pid: str, stand: str, fn: Callable[[dict], Any], retries: int = 3) -> tuple[dict, Any]:
    """
    Прочитать → изменить → записать со следующей версией. Кто-то записал раньше нас (409) — перечитываем и применяем
    изменение заново к свежим данным: брони коллег не теряются. fn меняет данные на месте и возвращает итог действия.
    """
    for attempt in range(retries):
        data, version = _read(cfg, pid, stand)
        work = copy.deepcopy(data)
        result = fn(work)
        try:
            _write(cfg, pid, work, version)
            return work, result
        except HTTPException as e:
            if e.status_code != 409 or attempt == retries - 1:
                raise
    raise HTTPException(409, "График меняли одновременно — повторите")


# ── Календарь и правила ──────────────────────────────────────────────────────

def window_days(data: dict) -> list[date]:
    """Все дни окна планирования (с выходными — на графике они серые)."""
    a, b = date.fromisoformat(data["window"]["from"]), date.fromisoformat(data["window"]["to"])
    return [a + timedelta(days=i) for i in range((b - a).days + 1)] if b >= a else []


def freeze_on(data: dict, d: date) -> Optional[dict]:
    iso = d.isoformat()
    return next((f for f in data["freezes"] if f["from"] <= iso <= f["to"]), None)


def bookings_on(data: dict, d: date) -> list[dict]:
    """Брони дня. Бронь на диапазон (date — dateTo) стоит в каждый его рабочий день; в выходные броней нет."""
    iso = d.isoformat()
    if d.weekday() >= 5:
        return [b for b in data["bookings"] if b["date"] == iso]
    return [b for b in data["bookings"] if b["date"] <= iso <= (b.get("dateTo") or b["date"])]


def range_days(a: date, b: date) -> list[date]:
    """Рабочие дни диапазона (выходные пропускаются)."""
    return [d for d in (a + timedelta(days=i) for i in range((b - a).days + 1)) if d.weekday() < 5]


def check_range(data: dict, a: date, b: date, hotfix: bool = False) -> Optional[str]:
    """Почему нельзя поставить на диапазон; None — можно. Проверяется каждый рабочий день."""
    if b < a:
        return "конец диапазона раньше начала"
    if (b - a).days > 62:
        return "диапазон — не больше двух месяцев"
    days = range_days(a, b)
    if not days:
        return "в диапазоне одни выходные"
    for d in days:
        why = check(data, d, hotfix)
        if why:
            return why if a == b else f"{d.strftime('%d.%m')}: {why}"
    return None


def installs_on(data: dict, d: date) -> int:
    """Установок за день: команда + микросервис — одна установка, сколько бы фич в неё ни входило."""
    return len({(b["team"], _ke(b["service"])) for b in bookings_on(data, d)})


def _ke(s_: str) -> str:
    """Ключ сервиса для конфликтов и группировки: название без регистра и лишних пробелов (код CI, если он есть)."""
    return ke_store.ke_key(s_)


_TIME_RE = re.compile(r"^([01]?\d|2[0-3])[:.]([0-5]\d)$")
DAY_MIN = 24 * 60


def time_min(t: str) -> Optional[int]:
    """«10:30» → 630; пусто или не время — None."""
    m = _TIME_RE.match((t or "").strip())
    return int(m[1]) * 60 + int(m[2]) if m else None


def norm_time(t: str) -> str:
    m = time_min(t)
    return f"{m // 60:02d}:{m % 60:02d}" if m is not None else ""


def interval(b: dict) -> tuple[int, int]:
    """Время установки брони в минутах от начала дня; без времени — весь день."""
    a, z = time_min(b.get("timeFrom", "")), time_min(b.get("timeTo", ""))
    return (a, z) if a is not None and z is not None and a < z else (0, DAY_MIN)


def check_times(t_from: str, t_to: str) -> Optional[str]:
    """Время «с — до» корректно (или не указано вовсе); иначе — что не так."""
    if not (t_from or "").strip() and not (t_to or "").strip():
        return None
    a, z = time_min(t_from), time_min(t_to)
    if a is None or z is None:
        return "время — ЧЧ:ММ, укажите начало и конец"
    if a >= z:
        return "время окончания раньше начала"
    return None


def conflict_ids(data: dict, d: date) -> set[str]:
    """Брони дня в конфликте: тот же сервис у другой команды, и время установки пересекается (без времени — весь день)."""
    by: dict[str, list[dict]] = {}
    for b in bookings_on(data, d):
        by.setdefault(_ke(b["service"]), []).append(b)
    out: set[str] = set()
    for items in by.values():
        for i, a in enumerate(items):
            for b in items[i + 1:]:
                if a["team"] != b["team"]:
                    (x1, y1), (x2, y2) = interval(a), interval(b)
                    if x1 < y2 and x2 < y1:
                        out.update((a["id"], b["id"]))
    return out


def conflicts_on(data: dict, d: date) -> dict[str, list[str]]:
    """Сервисы дня в конфликте: сервис → команды (у которых время установки пересекается)."""
    ids = conflict_ids(data, d)
    teams: dict[str, set] = {}
    for b in bookings_on(data, d):
        if b["id"] in ids:
            teams.setdefault(_ke(b["service"]), set()).add(b["team"])
    return {k: sorted(v) for k, v in teams.items()}


def match_team(data: dict, text: str) -> Optional[str]:
    """Команда по тексту заявки: точное название без регистра, иначе единственная, с которой оно начинается."""
    t = text.strip().lower()
    if not t:
        return None
    exact = next((x for x in data["teams"] if x.lower() == t), None)
    if exact:
        return exact
    starts = [x for x in data["teams"] if x.lower().startswith(t) or t.startswith(x.lower())]
    return starts[0] if len(starts) == 1 else None


def check(data: dict, d: date, hotfix: bool = False, now: Optional[date] = None) -> Optional[str]:
    """Почему нельзя поставить в этот день; None — можно. Конфликт по КЭ не запрещает — он красится."""
    now = now or today()
    if d.weekday() >= 5:
        return "выходной"
    if d < now:
        return "день уже прошёл"
    if d not in window_days(data):
        w = data["window"]
        return f"вне окна планирования {date.fromisoformat(w['from']).strftime('%d.%m')}–{date.fromisoformat(w['to']).strftime('%d.%m')}"
    fz = freeze_on(data, d)
    if fz and not hotfix:
        return f"заморозка до {date.fromisoformat(fz['to']).strftime('%d.%m')}" + (f" ({fz['reason']})" if fz.get("reason") else "")
    limit = int(data.get("limit") or 0)
    if limit and installs_on(data, d) >= limit:
        return f"лимит {limit}/{limit} на {d.strftime('%d.%m')}"
    return None


def nearest_free(data: dict, after: date, now: Optional[date] = None) -> Optional[date]:
    return next((d for d in window_days(data) if d >= after and check(data, d, now=now) is None), None)


def conflict_note(data: dict, d: date, service: str, team: str, t_from: str = "", t_to: str = "") -> str:
    """Предупреждение о конфликте для ответа на заявку: этот сервис в это время ставит другая команда."""
    x1, y1 = interval({"timeFrom": t_from, "timeTo": t_to})
    others = sorted({b["team"] for b in bookings_on(data, d) if _ke(b["service"]) == _ke(service) and b["team"] != team
                     and interval(b)[0] < y1 and x1 < interval(b)[1]})
    when = "в это время" if (t_from or t_to) else "в этот день"
    return f" — КОНФЛИКТ: {service} {when} ставит также {', '.join(others)}" if others else ""


def _new_booking(d: date, team: str, service: str, task: str, by: str, source: str, comment: str = "", features: str = "",
                 to: Optional[date] = None, t_from: str = "", t_to: str = "") -> dict:
    extra: dict[str, str] = {"dateTo": to.isoformat()} if to and to > d else {}
    if norm_time(t_from) and norm_time(t_to):
        extra.update(timeFrom=norm_time(t_from), timeTo=norm_time(t_to))
    return {"id": "bk-" + uuid.uuid4().hex[:8], "date": d.isoformat(), **extra, "team": team, "service": service.strip(),
            "features": features.strip(), "task": task.strip().upper(), "by": by, "source": source, "comment": comment,
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M")}


# ── Заявки из комментариев ───────────────────────────────────────────────────

_KEYS = {"сервис": "service", "кэ": "service", "микросервис": "service", "микросервисы": "service",
         "дата": "date", "даты": "date", "день": "date", "период": "date", "время": "time",
         "команда": "team", "задача": "task", "хотфикс": "hotfix", "фичи": "features", "фича": "features"}


def comment_text(storage: str) -> str:
    """HTML комментария → текст строками (<br>, </p>, </li> — перенос)."""
    t = re.sub(r"<br\s*/?>|</p>|</li>|</div>", "\n", storage or "", flags=re.I)
    t = re.sub(r"<[^>]+>", "", t)
    return html.unescape(t).replace("\xa0", " ").strip()


def parse_date(text: str, now: Optional[date] = None) -> Optional[date]:
    """«23.10», «23.10.2026», «2026-10-23». Без года — ближайшая такая дата не раньше чем месяц назад."""
    now = now or today()
    t = text.strip()
    m = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    try:
        if m:
            return date(int(m[1]), int(m[2]), int(m[3]))
        m = re.fullmatch(r"(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?", t)
        if not m:
            return None
        y = int(m[3]) if m[3] else now.year
        if m[3] and y < 100:
            y += 2000
        d = date(y, int(m[2]), int(m[1]))
        if not m[3] and d < now - timedelta(days=31):
            d = date(y + 1, d.month, d.day)
        return d
    except ValueError:
        return None


def parse_date_range(text: str, now: Optional[date] = None) -> Optional[tuple[date, date]]:
    """«23.10» или период «23.10–28.10», «23.10 - 28.10.2026», «с 23.10 по 28.10» → (с, по)."""
    t = re.sub(r"^\s*с\s+", "", text.strip(), flags=re.I)
    parts = [x for x in re.split(r"\s*(?:—|–|-(?=\s*\d{1,2}[./])|\bпо\b)\s*", t) if x.strip()] if not re.fullmatch(r"\d{4}-\d{1,2}-\d{1,2}", t) else [t]
    if len(parts) == 1:
        d = parse_date(parts[0], now)
        return (d, d) if d else None
    if len(parts) != 2:
        return None
    a, b = parse_date(parts[0], now), parse_date(parts[1], now)
    if not a or not b:
        return None
    if b < a and b.year == a.year:        # «28.12–05.01» — через Новый год
        b = date(b.year + 1, b.month, b.day)
    return (a, b) if b >= a else None


def parse_time_range(text: str) -> Optional[tuple[str, str]]:
    """«10:00–12:00», «10.00 - 12.30», «с 10:00 до 12:00» → ("10:00", "12:00"); не разобралось — None."""
    m = re.fullmatch(r"\s*(?:с\s+)?(\d{1,2}[:.]\d{2})\s*(?:—|–|-|до)\s*(\d{1,2}[:.]\d{2})\s*", text or "", flags=re.I)
    if not m or check_times(m[1], m[2]):
        return None
    return norm_time(m[1]), norm_time(m[2])


def parse_request(text: str, now: Optional[date] = None) -> dict:
    """Текст заявки → {service, date, dateTo, timeFrom, timeTo, team, task, hotfix, error}. error — что не так."""
    got: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"\s*([А-Яа-яЁёA-Za-z ]+?)\s*[:\-—]\s*(.+?)\s*$", line)
        if m and m[1].strip().lower() in _KEYS:
            got[_KEYS[m[1].strip().lower()]] = m[2]
    out: dict[str, Any] = {"service": got.get("service", "").strip(), "team": got.get("team", "").strip(),
                           "features": got.get("features", "").strip(),
                           "task": got.get("task", "").strip().upper(), "date": None, "dateTo": None,
                           "timeFrom": "", "timeTo": "",
                           "hotfix": got.get("hotfix", "").strip().lower() in ("да", "yes", "1", "+")}
    missing = [n for k, n in (("service", "Сервис"), ("date", "Дата"), ("team", "Команда")) if not got.get(k, "").strip()]
    if missing:
        out["error"] = "не указано: " + ", ".join(missing)
        return out
    rng = parse_date_range(got["date"], now)
    if not rng:
        out["error"] = f"не понял дату «{got['date']}» — пример: 23.10, 23.10.2026 или период 23.10–28.10"
        return out
    out["date"], out["dateTo"] = rng
    if got.get("time", "").strip():
        tr = parse_time_range(got["time"])
        if not tr:
            out["error"] = f"не понял время «{got['time']}» — пример: 10:00–12:00"
            return out
        out["timeFrom"], out["timeTo"] = tr
    return out


def _comments(cfg: dict, pid: str) -> list[dict]:
    """Комментарии верхнего уровня (ответы SimpleTest — вложенные, их не берём)."""
    out, start = [], 0
    while True:
        page = _request(cfg, "GET", f"/rest/api/content/{pid}/child/comment",
                        {"expand": "body.storage,history", "limit": 100, "start": start})
        items = page.get("results") or []
        for c in items:
            out.append({"id": str(c.get("id")), "text": comment_text(((c.get("body") or {}).get("storage") or {}).get("value", "")),
                        "author": (((c.get("history") or {}).get("createdBy") or {}).get("displayName") or "")})
        if len(items) < 100:
            return out
        start += 100


def _reply(cfg: dict, pid: str, cid: str, text: str) -> Optional[str]:
    """Ответ на комментарий-заявку; не вышло — вернуть ошибку текстом (бронь от этого не отменяется)."""
    try:
        _request(cfg, "POST", "/rest/api/content", json_body={
            "type": "comment", "container": {"id": pid, "type": "page"}, "ancestors": [{"id": cid}],
            "body": {"storage": {"value": f"<p>{html.escape(text)}</p>", "representation": "storage"}}})
        return None
    except HTTPException as e:
        return str(e.detail)[:200]


def _when(a: date, b: Optional[date], t_from: str = "", t_to: str = "") -> str:
    """«23.10» / «23.10–28.10» и время, если есть."""
    s_ = a.strftime("%d.%m") + (f"–{b.strftime('%d.%m')}" if b and b != a else "")
    return s_ + (f" {t_from}–{t_to}" if t_from and t_to else "")


def split_ke(text: str) -> list[str]:
    """«notify, gateway; auth» → ["notify", "gateway", "auth"] без повторов."""
    out: list[str] = []
    for x in re.split(r"[,;\n]", text or ""):
        x = x.strip()
        if x and _ke(x) not in {_ke(y) for y in out}:
            out.append(x)
    return out


def apply_requests(data: dict, comments: list[dict], now: Optional[date] = None) -> list[dict]:
    """Новые комментарии → брони или «на рассмотрении». Возвращает решения [{cid, ok, text}] для ответов."""
    now = now or today()
    decisions = []
    for c in comments:
        if c["id"] in data["processed"] or not c["text"].strip():
            continue
        data["processed"].append(c["id"])
        req = parse_request(c["text"], now)
        team = match_team(data, req["team"]) if not req.get("error") else None
        why = req.get("error") or (None if team else f"не знаю команду «{req['team']}» — есть: {', '.join(data['teams'])}")
        if not why:
            single = req["dateTo"] == req["date"]
            why = check(data, req["date"], req["hotfix"], now) if single else check_range(data, req["date"], req["dateTo"], req["hotfix"])
            if why and single:
                free = nearest_free(data, req["date"], now)
                why += f"; ближайший свободный день — {free.strftime('%d.%m')}" if free else ""
        if why:
            data["pending"].append({"cid": c["id"], "text": c["text"], "author": c["author"], "reason": why,
                                    "service": req["service"], "team": team or req["team"], "task": req["task"],
                                    "features": req["features"],
                                    "date": req["date"].isoformat() if req.get("date") else "",
                                    "dateTo": req["dateTo"].isoformat() if req.get("dateTo") and req["dateTo"] != req["date"] else "",
                                    "timeFrom": req.get("timeFrom", ""), "timeTo": req.get("timeTo", "")})
            decisions.append({"cid": c["id"], "ok": False, "text": f"На рассмотрении: {why}"})
            continue
        # «Сервис: notify, gateway» — бронь на каждый сервис (одна фича трогает несколько сервисов).
        kes = split_ke(req["service"])
        days = range_days(req["date"], req["dateTo"]) or [req["date"]]
        notes = "".join(dict.fromkeys(conflict_note(data, d, k, team, req["timeFrom"], req["timeTo"]) for d in days for k in kes))
        for k in kes:
            data["bookings"].append(_new_booking(req["date"], team, k, req["task"], c["author"], "comment", c["id"], req["features"],
                                                 req["dateTo"], req["timeFrom"], req["timeTo"]))
        decisions.append({"cid": c["id"], "ok": True,
                          "text": f"Принято: {', '.join(kes)}, {_when(req['date'], req['dateTo'], req['timeFrom'], req['timeTo'])}, {team}{notes}"})
    return decisions


# ── Страница стенда ──────────────────────────────────────────────────────────

def _status_macro(title: str, colour: str) -> str:
    return (f'<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">{colour}</ac:parameter>'
            f'<ac:parameter ac:name="title">{html.escape(title)}</ac:parameter></ac:structured-macro>')


def day_status(data: dict, d: date, now: Optional[date] = None) -> tuple[str, str]:
    """(подпись, цвет Confluence) дня."""
    now = now or today()
    if d < now:
        return "ПРОШЁЛ", "Grey"
    if d.weekday() >= 5:
        return "ВЫХОДНОЙ", "Grey"
    if freeze_on(data, d):
        return "ЗАМОРОЗКА", "Yellow"
    if conflicts_on(data, d):
        return "КОНФЛИКТ", "Red"
    limit = int(data.get("limit") or 0)
    if limit and installs_on(data, d) >= limit:
        return "ЛИМИТ", "Red"
    return "МОЖНО", "Green"


def render_page(data: dict, now: Optional[date] = None) -> str:
    """Текст страницы (storage format): памятка, сегодня, шаблон заявки, релизы, заморозки, таблица рабочих дней окна."""
    now = now or today()
    e = html.escape
    w = data["window"]
    title, colour = day_status(data, now, now)
    rels = sorted(data["releases"], key=lambda r: r["date"])
    parts = [
        '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Страница собирается из SimpleTest — таблицу руками '
        f'не правьте. Обновлено {datetime.now().strftime("%d.%m.%Y %H:%M")}.</p></ac:rich-text-body></ac:structured-macro>',
        f"<h2>Сегодня, {now.strftime('%d.%m')}</h2><p>{e(data['stand'])}: {_status_macro(title, colour)} "
        f"установок {installs_on(data, now)}</p>",
        "<h2>Как подать заявку</h2><p>Оставьте комментарий к этой странице — каждая строка «Название: значение»:</p>"
        "<p><code>Сервис: notify, gateway</code> (несколько микросервисов — через запятую)<br/>"
        "<code>Дата: 23.10</code> или период <code>Дата: 23.10–28.10</code><br/>"
        "<code>Время: 10:00–12:00</code> (необязательно; без него — весь день)<br/>"
        f"<code>Команда: {e(' / '.join(data['teams']))}</code><br/><code>Фичи: тема инцидента на карточке; фильтр по статусу</code><br/>"
        "<code>Задача: SBER911-12345</code> (необязательно)<br/><code>Хотфикс: да</code> (только для установки в заморозку)</p>"
        "<p>Если один и тот же микросервис в одно время ставят две команды — это конфликт: строка отмечается красным, договоритесь между собой. "
        "Ответ с итогом придёт на ваш комментарий.</p>",
        f"<h2>Окно планирования: {date.fromisoformat(w['from']).strftime('%d.%m.%Y')} — {date.fromisoformat(w['to']).strftime('%d.%m.%Y')}</h2>",
    ]
    if rels:
        parts.append("<p>Релизы: " + "; ".join(f"<strong>{e(r['name'])}</strong> — {date.fromisoformat(r['date']).strftime('%d.%m')}" for r in rels) + "</p>")
    fz_list = [f for f in data["freezes"] if f["to"] >= now.isoformat()]
    if fz_list:
        parts.append("<p>Заморозки: " + "; ".join(
            f"{date.fromisoformat(f['from']).strftime('%d.%m')}–{date.fromisoformat(f['to']).strftime('%d.%m')}"
            f"{' (' + e(f['reason']) + ')' if f.get('reason') else ''}" for f in fz_list) + "</p>")
    parts.append("<table><tbody><tr><th>День</th><th>Статус</th><th>Микросервис (команда)</th><th>Фичи</th></tr>")
    rel_on = {r["date"]: r["name"] for r in rels}
    for d in window_days(data):
        if d.weekday() >= 5:
            continue
        label, col = day_status(data, d, now)
        conf = conflicts_on(data, d)
        day = f"{WEEKDAYS[d.weekday()]} {d.strftime('%d.%m')}"
        day = f"<strong>{day}</strong>" if d == now else day
        if d.isoformat() in rel_on:
            day += f"<br/>{_status_macro('РЕЛИЗ ' + rel_on[d.isoformat()], 'Blue')}"
        fz = freeze_on(data, d)
        if fz and fz.get("reason"):
            day += f"<br/><em>заморозка: {e(fz['reason'])}</em>"
        # Строка — команда + микросервис (одна установка), в «Фичи» — все фичи, ради которых его ставят:
        # номер — название (время установки).
        groups: dict[tuple, list[dict]] = {}
        for b in sorted(bookings_on(data, d), key=lambda b: (b["team"], b["service"].lower(), b.get("task") or "")):
            groups.setdefault((b["team"], _ke(b["service"])), []).append(b)
        if not groups:
            parts.append(f"<tr><td>{day}</td><td>{_status_macro(label, col)}</td><td>—</td><td></td></tr>")
            continue
        ids = conflict_ids(data, d)
        for n, ((team, kek), items) in enumerate(groups.items()):
            ke = f"{e(items[0]['service'])} ({e(team)})"
            if any(b["id"] in ids for b in items):
                ke = f"{ke} {_status_macro('КОНФЛИКТ', 'Red')}"
            feats = "<br/>".join(
                " ".join(x for x in (
                    e(" — ".join(x for x in (b.get("task") or "", (b.get("features") or "").strip()) if x)),
                    f"({b['timeFrom']}–{b['timeTo']})" if b.get("timeFrom") and b.get("timeTo") else "") if x) or "—"
                for b in items)
            lead = f"<td rowspan=\"{len(groups)}\">{day}</td><td rowspan=\"{len(groups)}\">{_status_macro(label, col)}</td>" if n == 0 else ""
            parts.append(f"<tr>{lead}<td>{ke}</td><td>{feats}</td></tr>")
    parts.append("</tbody></table>")
    return "".join(parts)


def publish(cfg: dict, pid: str, data: dict) -> Optional[str]:
    """Пересобрать текст страницы. Не вышло — ошибка текстом (данные уже сохранены в свойстве)."""
    for _ in range(2):
        try:
            page = _request(cfg, "GET", f"/rest/api/content/{pid}", {"expand": "version"})
            _request(cfg, "PUT", f"/rest/api/content/{pid}", json_body={
                "id": pid, "type": "page", "title": page.get("title") or f"График стенда {data['stand']}",
                "version": {"number": int((page.get("version") or {}).get("number") or 0) + 1},
                "body": {"storage": {"value": render_page(data), "representation": "storage"}}})
            return None
        except HTTPException as e:
            if e.status_code != 409:
                return str(e.detail)[:200]
    return "страницу одновременно правили — нажмите «Обновить страницу»"


# ── Ответ API ────────────────────────────────────────────────────────────────

MAX_VIEW_DAYS = 200


def view_days(data: dict, rng: Optional[tuple[date, date]] = None) -> list[date]:
    """Дни графика: окно планирования или выбранный период (например, последние 3 месяца) — не длиннее MAX_VIEW_DAYS."""
    if not rng:
        return window_days(data)
    a, b = rng
    if b < a:
        a, b = b, a
    b = min(b, a + timedelta(days=MAX_VIEW_DAYS - 1))
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def view(data: dict, cfg: dict, pid: str, now: Optional[date] = None, rng: Optional[tuple[date, date]] = None) -> dict:
    now = now or today()
    win = set(window_days(data))
    days = []
    for d in view_days(data, rng):
        label, colour = day_status(data, d, now)
        conf = conflicts_on(data, d)
        ids = conflict_ids(data, d)
        days.append({"date": d.isoformat(), "weekday": WEEKDAYS[d.weekday()], "weekend": d.weekday() >= 5, "today": d == now,
                     "inWindow": d in win,
                     "status": label, "colour": colour, "freeze": freeze_on(data, d),
                     "bookings": [{**b, "conflict": b["id"] in ids} for b in bookings_on(data, d)],
                     "conflicts": [{"service": k, "teams": v} for k, v in conf.items()]})
    t_label, t_colour = day_status(data, now, now)
    return {"stand": data["stand"], "pageId": pid, "url": f"{cfg['base_url']}/pages/viewpage.action?pageId={pid}",
            "limit": int(data.get("limit") or 0), "window": data["window"], "releases": sorted(data["releases"], key=lambda r: r["date"]),
            "teams": data["teams"], "msCatalog": ms_store.load(), "msInfo": ms_store.info(),
            "range": {"from": days[0]["date"], "to": days[-1]["date"]} if days else data["window"],
            "today": {"date": now.isoformat(), "status": t_label, "colour": t_colour, "count": installs_on(data, now)},
            "days": days, "freezes": data["freezes"], "pending": data["pending"]}


def _ctx(db: Session, stand: str) -> tuple[dict, str, str]:
    stand = _stand(stand)
    return _load_cfg(db), _page_id(db, stand), stand


@router.get("/api/stands/{stand}")
def get_stand(stand: str, start: str = "", end: str = "", db: Session = Depends(get_db)) -> dict:
    """График стенда; start/end (ГГГГ-ММ-ДД) — другой период вместо окна планирования (например, последние 3 месяца)."""
    cfg, pid, stand = _ctx(db, stand)
    rng = None
    if start or end:
        try:
            rng = (date.fromisoformat(start or end), date.fromisoformat(end or start))
        except ValueError:
            raise HTTPException(422, "Период — ГГГГ-ММ-ДД")
    data, _ = _read(cfg, pid, stand)
    return view(data, cfg, pid, rng=rng)


def _done(cfg: dict, pid: str, data: dict, extra: Optional[dict] = None) -> dict:
    err = publish(cfg, pid, data)
    return {**view(data, cfg, pid), **(extra or {}), **({"publishError": err} if err else {})}


class CreatePage(BaseModel):
    parent: str = ""   # страница-родитель (ссылка или id); пусто — в корень пространства


@router.post("/api/stands/{stand}/create-page")
def create_page(stand: str, body: CreatePage, db: Session = Depends(get_db)) -> dict:
    stand = _stand(stand)
    cfg = _load_cfg(db)
    if not cfg["space"]:
        raise HTTPException(409, "Укажите пространство Confluence в подключении")
    data = default_data(stand)
    new: dict[str, Any] = {"type": "page", "title": f"График стенда {stand}", "space": {"key": cfg["space"]},
                           "body": {"storage": {"value": render_page(data), "representation": "storage"}}}
    if body.parent.strip():
        kind, ref = page_ref(body.parent)
        if kind == "id":
            new["ancestors"] = [{"id": ref}]
    page = _request(cfg, "POST", "/rest/api/content", json_body=new)
    pid = str(page.get("id"))
    _write(cfg, pid, data, 0)
    put_config(ConfigBody(pages={stand: pid}), db=db)
    return view(data, cfg, pid)


class ReleaseMark(BaseModel):
    name: str = Field(..., min_length=1)
    date: str


class SettingsBody(BaseModel):
    windowFrom: str
    windowTo: str
    releases: list[ReleaseMark] = Field(default_factory=list)
    teams: list[str] = Field(default_factory=lambda: list(DEFAULT_TEAMS))
    limit: int = Field(0, ge=0, le=500)      # 0 — без общего лимита на стенд


@router.put("/api/stands/{stand}/settings")
def put_settings(stand: str, body: SettingsBody, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    try:
        a, b = date.fromisoformat(body.windowFrom), date.fromisoformat(body.windowTo)
        rels = [{"id": "rl-" + uuid.uuid5(uuid.NAMESPACE_URL, f"{r.name}|{r.date}").hex[:8], "name": r.name.strip(),
                 "date": date.fromisoformat(r.date).isoformat()} for r in body.releases]
    except ValueError:
        raise HTTPException(422, "Даты — ГГГГ-ММ-ДД")
    if b < a:
        raise HTTPException(422, "Конец окна раньше начала")
    if (b - a).days > 366:
        raise HTTPException(422, "Окно планирования — не больше года")
    teams = [t.strip() for t in body.teams if t.strip()]
    if not teams:
        raise HTTPException(422, "Нужна хотя бы одна команда")

    def fn(d: dict) -> None:
        d.update(window={"from": a.isoformat(), "to": b.isoformat()}, releases=rels, teams=teams, limit=body.limit)
    data, _ = mutate(cfg, pid, stand, fn)
    return _done(cfg, pid, data)


# ── Справочник КЭ (файл на сервере, один на оба стенда) ─────────────────────

class KeNames(BaseModel):
    ke: list[str] = Field(default_factory=list, max_length=5000)


@router.get("/api/ke-catalog")
def get_ke_catalog() -> dict:
    return {"ke": ke_store.load()}


@router.post("/api/ke-catalog")
def add_ke(body: KeNames) -> dict:
    """Создать КЭ (из формы брони): дописываются только новые, повторы без учёта регистра пропускаются."""
    if not ke_store.clean(body.ke):
        raise HTTPException(422, "Пустое название КЭ")
    return {"ke": ke_store.add(body.ke)}


@router.put("/api/ke-catalog")
def put_ke_catalog(body: KeNames) -> dict:
    """Справочник целиком (правка списком в настройках стенда)."""
    return {"ke": ke_store.replace(body.ke)}


# ── Справочник микросервисов (что бронируют на графике с 22.10.2026; справочник КЭ — выше, остаётся для другого) ──

@router.get("/api/ms-catalog")
def get_ms_catalog() -> dict:
    """Справочник и описания (для подсказки и поиска в выпадающем списке: стенды, поле «Микросервисы» Jira tool)."""
    return {"ms": ms_store.load(), "info": ms_store.info()}


@router.post("/api/ms-catalog")
def add_ms(body: KeNames) -> dict:
    """Создать микросервис (из формы брони): дописываются только новые, повторы без учёта регистра пропускаются."""
    if not ms_store.clean(body.ke):
        raise HTTPException(422, "Пустое название микросервиса")
    return {"ms": ms_store.add(body.ke)}


@router.put("/api/ms-catalog")
def put_ms_catalog(body: KeNames) -> dict:
    """Справочник микросервисов целиком (правка списком в настройках стенда)."""
    return {"ms": ms_store.replace(body.ke)}


class BookingBody(BaseModel):
    date: str
    dateTo: str = ""          # конец диапазона (включительно); пусто — один день
    timeFrom: str = ""        # время установки «ЧЧ:ММ» — каждый день диапазона; пусто — весь день
    timeTo: str = ""
    team: str = Field(..., min_length=1)
    service: str = Field(..., min_length=1)
    features: str = ""
    task: str = ""
    hotfix: bool = False


@router.post("/api/stands/{stand}/bookings")
def add_booking(stand: str, body: BookingBody, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    try:
        d = date.fromisoformat(body.date)
    except ValueError:
        raise HTTPException(422, "Дата — ГГГГ-ММ-ДД")

    def fn(data: dict) -> None:
        team = match_team(data, body.team)
        if not team:
            raise HTTPException(422, f"Нет команды «{body.team}»")
        why = check_times(body.timeFrom, body.timeTo) or check(data, d, body.hotfix)
        if why:
            free = nearest_free(data, d)
            raise HTTPException(409, f"Нельзя: {why}" + (f". Ближайший свободный день — {free.strftime('%d.%m')}" if free else ""))
        data["bookings"].append(_new_booking(d, team, body.service, body.task, "SimpleTest", "simpletest", features=body.features,
                                             t_from=body.timeFrom, t_to=body.timeTo))
    data, _ = mutate(cfg, pid, stand, fn)
    return _done(cfg, pid, data)


class BulkBookings(BaseModel):
    items: list[BookingBody] = Field(default_factory=list)


@router.post("/api/stands/{stand}/bookings/bulk")
def add_bookings(stand: str, body: BulkBookings, db: Session = Depends(get_db)) -> dict:
    """
    Пачка броней одной записью (форма брони: фичи × КЭ, на день или диапазон). Бронь на диапазон — одна запись
    с dateTo, проверяется каждый рабочий день. Не прошедшие возвращаются с причиной, остальные встают.
    Страница пересобирается один раз.
    """
    cfg, pid, stand = _ctx(db, stand)
    if not body.items:
        raise HTTPException(422, "Нечего добавлять")
    if len(body.items) > 500:
        raise HTTPException(422, "Не больше 500 броней за раз")

    def fn(data: dict) -> list[dict]:
        rejected = []
        for it in body.items:
            try:
                d = date.fromisoformat(it.date)
                to = date.fromisoformat(it.dateTo) if it.dateTo else d
            except ValueError:
                rejected.append({"service": it.service, "task": it.task, "reason": "дата не ГГГГ-ММ-ДД"})
                continue
            team = match_team(data, it.team)
            why = None if team else f"нет команды «{it.team}»"
            why = why or check_times(it.timeFrom, it.timeTo)
            why = why or (check(data, d, it.hotfix) if to == d else check_range(data, d, to, it.hotfix))
            if why:
                rejected.append({"service": it.service, "task": it.task, "reason": why})
                continue
            data["bookings"].append(_new_booking(d, team, it.service, it.task, "SimpleTest", "simpletest", features=it.features, to=to,
                                                 t_from=it.timeFrom, t_to=it.timeTo))
        return rejected
    data, rejected = mutate(cfg, pid, stand, fn)
    return _done(cfg, pid, data, {"added": len(body.items) - len(rejected), "rejected": rejected})


@router.delete("/api/stands/{stand}/bookings/{bid}")
def delete_booking(stand: str, bid: str, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    data, _ = mutate(cfg, pid, stand, lambda d: d.update(bookings=[b for b in d["bookings"] if b["id"] != bid]))
    return _done(cfg, pid, data)


class FreezeBody(BaseModel):
    start: str
    end: str
    reason: str = ""


@router.post("/api/stands/{stand}/freezes")
def add_freeze(stand: str, body: FreezeBody, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    try:
        a, b = date.fromisoformat(body.start), date.fromisoformat(body.end)
    except ValueError:
        raise HTTPException(422, "Даты заморозки — ГГГГ-ММ-ДД")
    if b < a:
        raise HTTPException(422, "Конец заморозки раньше начала")
    fz = {"id": "fz-" + uuid.uuid4().hex[:8], "from": a.isoformat(), "to": b.isoformat(), "reason": body.reason.strip()}
    data, _ = mutate(cfg, pid, stand, lambda d: d["freezes"].append(fz))
    return _done(cfg, pid, data)


@router.delete("/api/stands/{stand}/freezes/{fid}")
def delete_freeze(stand: str, fid: str, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    data, _ = mutate(cfg, pid, stand, lambda d: d.update(freezes=[f for f in d["freezes"] if f["id"] != fid]))
    return _done(cfg, pid, data)


@router.post("/api/stands/{stand}/pull")
def pull(stand: str, db: Session = Depends(get_db)) -> dict:
    """Забрать заявки из комментариев: решения считаются под защитой версии, ответы уходят после записи."""
    cfg, pid, stand = _ctx(db, stand)
    comments = _comments(cfg, pid)
    data, decisions = mutate(cfg, pid, stand, lambda d: apply_requests(d, comments))
    failed = [f"{x['cid']}: {err}" for x in decisions if (err := _reply(cfg, pid, x["cid"], x["text"]))]
    return _done(cfg, pid, data, {"pulled": {"accepted": sum(1 for x in decisions if x["ok"]),
                                             "pending": sum(1 for x in decisions if not x["ok"]), "replyErrors": failed}})


class PendingDecision(BaseModel):
    accept: bool
    date: str = ""        # можно поправить при принятии
    dateTo: str = ""      # конец периода; пусто — как в заявке
    timeFrom: str = ""    # время установки; пусто — как в заявке
    timeTo: str = ""
    team: str = ""
    service: str = ""
    features: str = ""
    task: str = ""
    note: str = ""        # причина отказа — уйдёт в ответ


@router.post("/api/stands/{stand}/pending/{cid}")
def decide(stand: str, cid: str, body: PendingDecision, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    reply: dict[str, str] = {}

    def fn(data: dict) -> None:
        item = next((p for p in data["pending"] if p["cid"] == cid), None)
        if not item:
            raise HTTPException(404, "Заявки уже нет в «На рассмотрении»")
        if body.accept:
            try:
                d = date.fromisoformat(body.date or item["date"])
                to_raw = body.dateTo or item.get("dateTo") or ""
                to = date.fromisoformat(to_raw) if to_raw else d
            except ValueError:
                raise HTTPException(422, "Укажите дату заявки")
            t_from, t_to = (body.timeFrom, body.timeTo) if body.timeFrom or body.timeTo else (item.get("timeFrom", ""), item.get("timeTo", ""))
            bad = check_times(t_from, t_to) or ("конец периода раньше начала" if to < d else None)
            if bad:
                raise HTTPException(422, bad)
            team = match_team(data, body.team or item["team"])
            kes = split_ke(body.service or item["service"])
            if not team or not kes:
                raise HTTPException(422, "Укажите команду из списка и сервис")
            # Решение руками — правила не блокируют (например, осознанно сверх лимита), но день должен быть рабочим.
            days = range_days(d, to)
            if not days:
                raise HTTPException(422, "Это выходной")
            notes = "".join(dict.fromkeys(conflict_note(data, x, ke, team, t_from, t_to) for x in days for ke in kes))
            for ke in kes:
                data["bookings"].append(_new_booking(d, team, ke, body.task or item["task"], item["author"], "comment", cid,
                                                     body.features or item.get("features", ""), to, t_from, t_to))
            reply["text"] = f"Принято: {', '.join(kes)}, {_when(d, to, norm_time(t_from), norm_time(t_to))}, {team}{notes}"
        else:
            reply["text"] = "Отклонено" + (f": {body.note.strip()}" if body.note.strip() else "")
        data["pending"] = [p for p in data["pending"] if p["cid"] != cid]
    data, _ = mutate(cfg, pid, stand, fn)
    err = _reply(cfg, pid, cid, reply["text"])
    return _done(cfg, pid, data, {"replyErrors": [err] if err else []})
