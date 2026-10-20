"""
График стендов — кто, когда и какие сервисы (КЭ) ставит на Major-Check и Major-GO, на 2 спринта вперёд.

Устройство (решения Стефана):
  • у каждого стенда своя страница Confluence; оригинал графика — свойство страницы (content property `simpletest-stand`,
    JSON с версией: одновременная запись двух SimpleTest не затирает друг друга — вторая получит 409 и повторит);
  • текст страницы SimpleTest собирает сам: памятка, «сегодня», таблица всех рабочих дней двух спринтов;
  • заявки коллеги оставляют комментариями к странице по шаблону («Сервис: … / Дата: … / Команда: …»);
    «Забрать заявки» разбирает новые комментарии, проверяет правила (заморозка, лимит дня, команда) — прошла: бронь
    в графике, нет или не разобралась: «На рассмотрении»; на комментарий уходит ответ с итогом.

Локально (metrics_settings, ключ stands_config) хранится только привязка стенд → страница: она у каждого SimpleTest своя.
Лимиты, спринты, команды, брони, заморозки, обработанные комментарии — в свойстве страницы, общие для всех.

Эндпоинты:
  GET  /api/stands/config                 — привязка страниц
  PUT  /api/stands/config                 — сохранить привязку (ссылка или id страницы)
  POST /api/stands/{stand}/create-page    — создать страницу стенда в пространстве из настроек Confluence
  GET  /api/stands/{stand}                — график: дни, брони, заморозки, «на рассмотрении», настройки стенда
  PUT  /api/stands/{stand}/settings       — лимит в день, начало и длина спринта, команды
  POST /api/stands/{stand}/bookings       — бронь
  DELETE /api/stands/{stand}/bookings/{id}
  POST /api/stands/{stand}/freezes        — заморозка
  DELETE /api/stands/{stand}/freezes/{id}
  POST /api/stands/{stand}/pull           — забрать заявки из комментариев
  POST /api/stands/{stand}/pending/{cid}  — решить заявку «на рассмотрении»: принять (с правкой) или отклонить
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

def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def default_data(stand: str) -> dict:
    return {"format": "simpletest.stand-schedule", "version": 1, "stand": stand, "limit": 3,
            "sprintStart": _monday(today()).isoformat(), "sprintDays": 14, "teams": list(DEFAULT_TEAMS),
            "bookings": [], "freezes": [], "pending": [], "processed": []}


def _norm_data(stand: str, raw: Any) -> dict:
    d = default_data(stand)
    if isinstance(raw, dict):
        for k in d:
            if k in raw and raw[k] is not None:
                d[k] = raw[k]
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

def horizon(data: dict, now: Optional[date] = None) -> list[date]:
    """Рабочие дни текущего и следующего спринта (спринты идут подряд от sprintStart с шагом sprintDays)."""
    now = now or today()
    start = date.fromisoformat(data["sprintStart"])
    step = max(1, int(data.get("sprintDays") or 14))
    while start + timedelta(days=step) <= now:
        start += timedelta(days=step)
    while start > now:
        start -= timedelta(days=step)
    days = [start + timedelta(days=i) for i in range(step * 2)]
    return [d for d in days if d.weekday() < 5]


def sprint_of(data: dict, d: date) -> int:
    """Номер спринта дня от sprintStart (0, 1, 2…) — для подписи границ спринтов."""
    start = date.fromisoformat(data["sprintStart"])
    return (d - start).days // max(1, int(data.get("sprintDays") or 14))


def freeze_on(data: dict, d: date) -> Optional[dict]:
    iso = d.isoformat()
    return next((f for f in data["freezes"] if f["from"] <= iso <= f["to"]), None)


def bookings_on(data: dict, d: date) -> list[dict]:
    return [b for b in data["bookings"] if b["date"] == d.isoformat()]


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
    """Почему нельзя поставить в этот день; None — можно."""
    now = now or today()
    if d.weekday() >= 5:
        return "выходной"
    if d < now:
        return "день уже прошёл"
    if d not in horizon(data, now):
        return "дальше двух спринтов"
    fz = freeze_on(data, d)
    if fz and not hotfix:
        return f"заморозка до {date.fromisoformat(fz['to']).strftime('%d.%m')}" + (f" ({fz['reason']})" if fz.get("reason") else "")
    if len(bookings_on(data, d)) >= int(data["limit"]):
        return f"лимит {data['limit']}/{data['limit']} на {d.strftime('%d.%m')}"
    return None


def nearest_free(data: dict, after: date, now: Optional[date] = None) -> Optional[date]:
    return next((d for d in horizon(data, now) if d >= after and check(data, d, now=now) is None), None)


def _new_booking(d: date, team: str, service: str, task: str, by: str, source: str, comment: str = "") -> dict:
    return {"id": "bk-" + uuid.uuid4().hex[:8], "date": d.isoformat(), "team": team, "service": service.strip(),
            "task": task.strip().upper(), "by": by, "source": source, "comment": comment,
            "createdAt": datetime.now().strftime("%Y-%m-%d %H:%M")}


# ── Заявки из комментариев ───────────────────────────────────────────────────

_KEYS = {"сервис": "service", "кэ": "service", "микросервис": "service", "дата": "date", "день": "date",
         "команда": "team", "задача": "task", "хотфикс": "hotfix"}


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


def parse_request(text: str, now: Optional[date] = None) -> dict:
    """Текст заявки → {service, date, team, task, hotfix, error}. error — что не так, если не разобралось."""
    got: dict[str, str] = {}
    for line in text.splitlines():
        m = re.match(r"\s*([А-Яа-яЁёA-Za-z ]+?)\s*[:\-—]\s*(.+?)\s*$", line)
        if m and m[1].strip().lower() in _KEYS:
            got[_KEYS[m[1].strip().lower()]] = m[2]
    out: dict[str, Any] = {"service": got.get("service", "").strip(), "team": got.get("team", "").strip(),
                           "task": got.get("task", "").strip().upper(), "date": None,
                           "hotfix": got.get("hotfix", "").strip().lower() in ("да", "yes", "1", "+")}
    missing = [n for k, n in (("service", "Сервис"), ("date", "Дата"), ("team", "Команда")) if not got.get(k, "").strip()]
    if missing:
        out["error"] = "не указано: " + ", ".join(missing)
        return out
    d = parse_date(got["date"], now)
    if not d:
        out["error"] = f"не понял дату «{got['date']}» — пример: 23.10 или 23.10.2026"
        return out
    out["date"] = d
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
            why = check(data, req["date"], req["hotfix"], now)
            if why:
                free = nearest_free(data, req["date"], now)
                why += f"; ближайший свободный день — {free.strftime('%d.%m')}" if free else ""
        if why:
            data["pending"].append({"cid": c["id"], "text": c["text"], "author": c["author"], "reason": why,
                                    "service": req["service"], "team": team or req["team"], "task": req["task"],
                                    "date": req["date"].isoformat() if req.get("date") else ""})
            decisions.append({"cid": c["id"], "ok": False, "text": f"На рассмотрении: {why}"})
            continue
        data["bookings"].append(_new_booking(req["date"], team, req["service"], req["task"], c["author"], "comment", c["id"]))
        decisions.append({"cid": c["id"], "ok": True,
                          "text": f"Принято: {req['service']}, {req['date'].strftime('%d.%m')}, {team}"})
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
    if freeze_on(data, d):
        return "ЗАМОРОЗКА", "Red"
    if len(bookings_on(data, d)) >= int(data["limit"]):
        return "ЛИМИТ", "Red"
    return "МОЖНО", "Green"


def render_page(data: dict, now: Optional[date] = None) -> str:
    """Текст страницы (storage format): памятка, сегодня, таблица всех рабочих дней двух спринтов."""
    now = now or today()
    e = html.escape
    days = horizon(data, now)
    title, colour = day_status(data, now, now) if now.weekday() < 5 else ("ВЫХОДНОЙ", "Grey")
    parts = [
        '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>Страница собирается из SimpleTest — таблицу руками '
        f'не правьте. Обновлено {datetime.now().strftime("%d.%m.%Y %H:%M")}.</p></ac:rich-text-body></ac:structured-macro>',
        f"<h2>Сегодня, {now.strftime('%d.%m')}</h2><p>{e(data['stand'])}: {_status_macro(title, colour)} "
        f"установок {len(bookings_on(data, now))}/{data['limit']}</p>",
        "<h2>Как подать заявку</h2><p>Оставьте комментарий к этой странице — каждая строка «Название: значение»:</p>"
        "<p><code>Сервис: notify</code><br/><code>Дата: 23.10</code><br/>"
        f"<code>Команда: {e(' / '.join(data['teams']))}</code><br/><code>Задача: SBER911-12345</code> (необязательно)<br/>"
        "<code>Хотфикс: да</code> (только для установки в заморозку)</p>"
        f"<p>Лимит — {data['limit']} установки в день. Ответ с итогом придёт на ваш комментарий.</p>",
    ]
    fz_list = [f for f in data["freezes"] if f["to"] >= now.isoformat()]
    if fz_list:
        parts.append("<h2>Заморозки</h2><ul>" + "".join(
            f"<li>{date.fromisoformat(f['from']).strftime('%d.%m')}–{date.fromisoformat(f['to']).strftime('%d.%m')}"
            f"{': ' + e(f['reason']) if f.get('reason') else ''}</li>" for f in fz_list) + "</ul>")
    current = None
    for d in days:
        sp = sprint_of(data, d)
        if sp != current:
            if current is not None:
                parts.append("</tbody></table>")
            current = sp
            first = days[[sprint_of(data, x) for x in days].index(sp)]
            parts.append(f"<h2>Спринт с {first.strftime('%d.%m')}</h2><table><tbody>"
                         "<tr><th>День</th><th>Статус</th><th>Установок</th><th>Брони: команда · сервис · задача</th></tr>")
        label, col = day_status(data, d, now)
        fz = freeze_on(data, d)
        items = [f"{e(b['team'])} · {e(b['service'])}" + (f" · {e(b['task'])}" if b.get("task") else "") for b in bookings_on(data, d)]
        if fz and fz.get("reason"):
            items.insert(0, f"<em>заморозка: {e(fz['reason'])}</em>")
        day = f"{WEEKDAYS[d.weekday()]} {d.strftime('%d.%m')}"
        parts.append(f"<tr><td>{'<strong>' + day + '</strong>' if d == now else day}</td><td>{_status_macro(label, col)}</td>"
                     f"<td>{len(bookings_on(data, d))}/{data['limit']}</td><td>{'<br/>'.join(items) or '—'}</td></tr>")
    if current is not None:
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

def view(data: dict, cfg: dict, pid: str, now: Optional[date] = None) -> dict:
    now = now or today()
    days = []
    for d in horizon(data, now):
        label, colour = day_status(data, d, now)
        fz = freeze_on(data, d)
        days.append({"date": d.isoformat(), "weekday": WEEKDAYS[d.weekday()], "sprint": sprint_of(data, d), "today": d == now,
                     "status": label, "colour": colour, "freeze": fz, "bookings": bookings_on(data, d)})
    t_label, t_colour = day_status(data, now, now) if now.weekday() < 5 else ("ВЫХОДНОЙ", "Grey")
    return {"stand": data["stand"], "pageId": pid, "url": f"{cfg['base_url']}/pages/viewpage.action?pageId={pid}",
            "limit": data["limit"], "sprintStart": data["sprintStart"], "sprintDays": data["sprintDays"], "teams": data["teams"],
            "today": {"date": now.isoformat(), "status": t_label, "colour": t_colour, "count": len(bookings_on(data, now))},
            "days": days, "freezes": data["freezes"], "pending": data["pending"]}


def _ctx(db: Session, stand: str) -> tuple[dict, str, str]:
    stand = _stand(stand)
    return _load_cfg(db), _page_id(db, stand), stand


@router.get("/api/stands/{stand}")
def get_stand(stand: str, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    data, _ = _read(cfg, pid, stand)
    return view(data, cfg, pid)


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


class SettingsBody(BaseModel):
    limit: int = Field(3, ge=1, le=50)
    sprintStart: str
    sprintDays: int = Field(14, ge=1, le=60)
    teams: list[str] = Field(default_factory=lambda: list(DEFAULT_TEAMS))


@router.put("/api/stands/{stand}/settings")
def put_settings(stand: str, body: SettingsBody, db: Session = Depends(get_db)) -> dict:
    cfg, pid, stand = _ctx(db, stand)
    try:
        date.fromisoformat(body.sprintStart)
    except ValueError:
        raise HTTPException(422, "Начало спринта — дата ГГГГ-ММ-ДД")
    teams = [t.strip() for t in body.teams if t.strip()]
    if not teams:
        raise HTTPException(422, "Нужна хотя бы одна команда")

    def fn(d: dict) -> None:
        d.update(limit=body.limit, sprintStart=body.sprintStart, sprintDays=body.sprintDays, teams=teams)
    data, _ = mutate(cfg, pid, stand, fn)
    return _done(cfg, pid, data)


class BookingBody(BaseModel):
    date: str
    team: str = Field(..., min_length=1)
    service: str = Field(..., min_length=1)
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
        why = check(data, d, body.hotfix)
        if why:
            free = nearest_free(data, d)
            raise HTTPException(409, f"Нельзя: {why}" + (f". Ближайший свободный день — {free.strftime('%d.%m')}" if free else ""))
        data["bookings"].append(_new_booking(d, team, body.service, body.task, "SimpleTest", "simpletest"))
    data, _ = mutate(cfg, pid, stand, fn)
    return _done(cfg, pid, data)


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
    team: str = ""
    service: str = ""
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
            except ValueError:
                raise HTTPException(422, "Укажите дату заявки")
            team = match_team(data, body.team or item["team"])
            service = (body.service or item["service"]).strip()
            if not team or not service:
                raise HTTPException(422, "Укажите команду из списка и сервис")
            # Решение руками — правила не блокируют (например, осознанно сверх лимита), но день должен быть рабочим.
            if d.weekday() >= 5:
                raise HTTPException(422, "Это выходной")
            data["bookings"].append(_new_booking(d, team, service, body.task or item["task"], item["author"], "comment", cid))
            reply["text"] = f"Принято: {service}, {d.strftime('%d.%m')}, {team}"
        else:
            reply["text"] = "Отклонено" + (f": {body.note.strip()}" if body.note.strip() else "")
        data["pending"] = [p for p in data["pending"] if p["cid"] != cid]
    data, _ = mutate(cfg, pid, stand, fn)
    err = _reply(cfg, pid, cid, reply["text"])
    return _done(cfg, pid, data, {"replyErrors": [err] if err else []})
